import { useCallback, useState } from 'react';
import { PlaylistTrackInput } from '../types';

export interface PlaylistSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
}

// 'unauthorized' = token lacks the playlist-read scopes (old session, needs
// re-consent) — distinct from useSpotify's `unauthorized` (Dev-Mode account
// allowlisting), which has a different cause and a different fix.
// 'empty' = zero playable tracks, the only per-playlist count that still
// blocks — anything else is allowed through with a warning (see Host.tsx).
export type PlaylistFetchError = 'unauthorized' | 'not_found' | 'empty' | 'error';

// Mirrors gameManager.ts's MIN_PLAYLIST_TRACKS — kept in sync manually, same
// as every other client/server type mirror in this codebase. Below this the
// combined pool triggers a "songs may repeat" warning, not a hard block.
export const MIN_PLAYLIST_TRACKS = 10;
// Not a real product limit — Spotify's API just has no bulk endpoint, so a
// huge playlist means many sequential page requests. This bounds worst case.
// Mirrors Host.tsx's MAX_POOL_TRACKS (the combined-pool cap across all
// selected playlists) — kept equal so a single playlist can't individually
// exceed what the combined pool would allow anyway.
export const MAX_PLAYLIST_TRACKS = 5000;

interface SpotifyImage { url: string }
interface SpotifyPlaylistItem {
  id: string;
  name: string;
  images: SpotifyImage[] | null;
  // Documented as `tracks`, but Spotify now sends this same {href,total} shape
  // under `items` for at least some accounts — accept either.
  tracks?: { total: number } | null;
  items?: { total: number } | null;
}
interface SpotifyPlaylistsResponse {
  items: SpotifyPlaylistItem[];
  next: string | null;
}
interface SpotifyArtist { name: string }
interface SpotifyAlbum { images: SpotifyImage[] | null; release_date?: string }
interface SpotifyTrack {
  // Present on /items responses to distinguish tracks from podcast episodes
  // (episodes lack `artists`, which already filters them out below, but the
  // type check makes that intentional rather than incidental).
  type?: string;
  id: string | null;
  name: string;
  duration_ms: number | null;
  is_local?: boolean;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
}
interface SpotifyPlaylistTracksResponse {
  // Spotify's Feb 2026 migration renamed each entry's `track` field to `item`
  // (a track/episode union) when the endpoint itself moved from /tracks to
  // /items.
  items: { item: SpotifyTrack | null }[];
  next: string | null;
}

function parseYear(releaseDate: string | undefined): number | null {
  const match = /^(\d{4})/.exec(releaseDate ?? '');
  return match ? Number(match[1]) : null;
}

// Spotify playlist IDs are base62 (alphanumeric). Both resolvePlaylistInput
// below and the playlist grid (Spotify's own API response) should already
// only ever produce IDs matching this, but every ID is re-checked again
// immediately before it's used to build a request URL — never trust that
// validation done elsewhere still holds by the time it reaches a fetch call.
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9]{1,50}$/;

// Accepts a full share URL (open.spotify.com/playlist/<id>), a URI
// (spotify:playlist:<id>), or a bare ID pasted directly.
export function resolvePlaylistInput(raw: string): string | null {
  const trimmed = raw.trim();
  const urlMatch = /open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/.exec(trimmed);
  if (urlMatch) return urlMatch[1];
  const uriMatch = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(trimmed);
  if (uriMatch) return uriMatch[1];
  return PLAYLIST_ID_PATTERN.test(trimmed) ? trimmed : null;
}

type SpotifyFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: PlaylistFetchError };

// A playlist import can walk many pages; without a per-request cap a single
// hung connection would stall the whole import indefinitely.
const REQUEST_TIMEOUT_MS = 12000;
// Total attempts = MAX_RETRIES + 1. Covers a transient 429/5xx/network blip
// without turning a real outage into a long hang.
const MAX_RETRIES = 3;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

// Wraps fetch with a timeout, surfacing a thrown error (network failure or
// abort) as data instead of a rejection, so the retry loop in fetchSpotify
// doesn't need its own try/catch.
async function fetchWithTimeout(
  url: string, accessToken: string,
): Promise<{ res: Response } | { err: unknown }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
    return { res };
  } catch (err) {
    return { err };
  } finally {
    clearTimeout(timeoutId);
  }
}

// How long to wait before retrying a 429/5xx response — honors Retry-After
// when Spotify sends one, otherwise falls back to exponential backoff.
function retryDelayMs(res: Response, attempt: number): number {
  const retryAfterSec = Number(res.headers.get('Retry-After'));
  return Number.isFinite(retryAfterSec) && retryAfterSec > 0
    ? Math.min(retryAfterSec * 1000, 8000)
    : backoffMs(attempt);
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isPlaylistNotFound(notFoundIsPlaylist: boolean, status: number): boolean {
  return notFoundIsPlaylist && status === 404;
}

function isAuthError(status: number): boolean {
  return status === 401 || status === 403;
}

// Centralizes the status-code handling shared by every Spotify Web API call
// below, so each call site is just one branch instead of three. Retries
// transient failures (429 with Retry-After, 5xx, timeouts, network errors)
// with backoff; 401/403/404/other 4xx fail immediately since retrying won't
// help.
async function fetchSpotify<T>(
  url: string, accessToken: string, notFoundIsPlaylist = false,
): Promise<SpotifyFetchResult<T>> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const canRetry = attempt < MAX_RETRIES;
    const attemptResult = await fetchWithTimeout(url, accessToken);
    if ('err' in attemptResult) {
      if (canRetry) { await delay(backoffMs(attempt)); continue; }
      console.error('[Spotify] request threw after retries', { url: url.replace(/[\r\n]/g, ''), err: attemptResult.err });
      return { ok: false, error: 'error' };
    }

    const { res } = attemptResult;
    if (isAuthError(res.status)) return { ok: false, error: 'unauthorized' };
    if (isPlaylistNotFound(notFoundIsPlaylist, res.status)) return { ok: false, error: 'not_found' };

    if (isTransientStatus(res.status) && canRetry) {
      await delay(retryDelayMs(res, attempt));
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      console.error('[Spotify] request failed', {
        url: url.replace(/[\r\n]/g, ''),
        status: res.status,
        body: body.replace(/[\r\n]/g, ''),
      });
      return { ok: false, error: 'error' };
    }
    return { ok: true, data: await res.json() as T };
  }
  return { ok: false, error: 'error' };
}

// Filters out removed tracks, local files (unplayable via the Web Playback
// SDK), and episodes/non-track items (no artists array).
function toPlaylistTrackInput(t: SpotifyTrack | null): PlaylistTrackInput | null {
  if (!t || t.type === 'episode' || t.is_local || !t.id || !t.artists?.length) return null;
  return {
    spotifyTrackId: t.id,
    title: t.name,
    artist: t.artists[0].name,
    featuredArtists: t.artists.length > 1
      ? t.artists.slice(1).map(a => a.name).join(', ')
      : undefined,
    durationMs: t.duration_ms ?? null,
    year: parseYear(t.album?.release_date),
    albumArtUrl: t.album?.images?.[0]?.url ?? null,
  };
}

export function usePlaylistPicker(accessToken: string | null) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<PlaylistFetchError | null>(null);

  const fetchPlaylists = useCallback(async () => {
    if (!accessToken) return;
    setLoadingPlaylists(true);
    setPlaylistsError(null);
    try {
      const all: PlaylistSummary[] = [];
      let url: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50';
      while (url) {
        const result: SpotifyFetchResult<SpotifyPlaylistsResponse> = await fetchSpotify(url, accessToken);
        if (!result.ok) { setPlaylistsError(result.error); return; }
        for (const item of result.data.items) {
          const trackCount = item?.tracks?.total ?? item?.items?.total;
          // Playlist folders (and the occasional null/unavailable entry) show up
          // here too but have neither field — they aren't real playlists.
          if (trackCount === undefined) continue;
          all.push({ id: item.id, name: item.name, imageUrl: item.images?.[0]?.url ?? null, trackCount });
        }
        url = result.data.next;
      }
      setPlaylists(all);
    } catch (err) {
      console.error('[Spotify] fetch playlists threw:', err);
      setPlaylistsError('error');
    } finally {
      setLoadingPlaylists(false);
    }
  }, [accessToken]);

  const fetchPlaylistTracks = useCallback(async (
    playlistId: string,
    // Called after each page lands so the caller can render live progress —
    // pagination on a large playlist can take several round-trips.
    onProgress?: (count: number) => void,
  ): Promise<
    { ok: true; name: string; tracks: PlaylistTrackInput[]; truncated: boolean }
    | { ok: false; error: PlaylistFetchError; count?: number }
  > => {
    if (!accessToken) return { ok: false, error: 'error' };
    // Re-validated here (not just trusted from the caller) immediately before
    // it's used to build a request URL — see PLAYLIST_ID_PATTERN.
    if (!PLAYLIST_ID_PATTERN.test(playlistId)) return { ok: false, error: 'not_found' };
    try {
      const metaResult = await fetchSpotify<{ name: string }>(
        `https://api.spotify.com/v1/playlists/${playlistId}?fields=name`, accessToken, true,
      );
      if (!metaResult.ok) return metaResult;

      const seen = new Set<string>();
      const tracks: PlaylistTrackInput[] = [];
      // Spotify's Feb 2026 API migration removed `/tracks` — `/items` is its
      // replacement, with each entry's `track` field renamed to `item`.
      let url: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100&fields=`
        + encodeURIComponent('next,items(item(type,id,name,duration_ms,is_local,artists(name),album(images,release_date)))');
      while (url && tracks.length < MAX_PLAYLIST_TRACKS) {
        const result: SpotifyFetchResult<SpotifyPlaylistTracksResponse> = await fetchSpotify(url, accessToken);
        if (!result.ok) return result;
        for (const item of result.data.items) {
          const track = toPlaylistTrackInput(item.item);
          if (!track || seen.has(track.spotifyTrackId)) continue;
          seen.add(track.spotifyTrackId);
          tracks.push(track);
        }
        url = result.data.next;
        onProgress?.(tracks.length);
      }

      if (tracks.length === 0) return { ok: false, error: 'empty', count: 0 };
      // `url` still non-null here means the loop stopped because it hit the
      // cap, not because it ran out of pages — i.e. the playlist has more
      // tracks than we imported.
      const truncated = tracks.length >= MAX_PLAYLIST_TRACKS && url !== null;
      return { ok: true, name: metaResult.data.name, tracks, truncated };
    } catch (err) {
      console.error('[Spotify] fetch playlist tracks threw:', err);
      return { ok: false, error: 'error' };
    }
  }, [accessToken]);

  return { playlists, loadingPlaylists, playlistsError, fetchPlaylists, fetchPlaylistTracks };
}
