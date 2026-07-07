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
export type PlaylistFetchError = 'unauthorized' | 'not_found' | 'too_few' | 'error';

// Mirrors gameManager.ts's MIN_PLAYLIST_TRACKS — kept in sync manually, same
// as every other client/server type mirror in this codebase.
export const MIN_PLAYLIST_TRACKS = 10;
// Not a real product limit — Spotify's API just has no bulk endpoint, so a
// huge playlist means many sequential page requests. This bounds worst case.
const MAX_PLAYLIST_TRACKS = 2000;

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
  id: string | null;
  name: string;
  duration_ms: number | null;
  is_local?: boolean;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
}
interface SpotifyPlaylistTracksResponse {
  items: { track: SpotifyTrack | null }[];
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

// Centralizes the status-code handling shared by every Spotify Web API call
// below, so each call site is just one branch instead of three. Retries
// transient failures (429 with Retry-After, 5xx, timeouts, network errors)
// with backoff; 401/403/404/other 4xx fail immediately since retrying won't
// help.
async function fetchSpotify<T>(
  url: string, accessToken: string, notFoundIsPlaylist = false,
): Promise<SpotifyFetchResult<T>> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
    } catch (err) {
      if (attempt < MAX_RETRIES) { await delay(500 * 2 ** attempt); continue; }
      console.error('[Spotify] request threw after retries', { url: url.replace(/[\r\n]/g, ''), err });
      return { ok: false, error: 'error' };
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.status === 401 || res.status === 403) return { ok: false, error: 'unauthorized' };
    if (notFoundIsPlaylist && res.status === 404) return { ok: false, error: 'not_found' };

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfterSec = Number(res.headers.get('Retry-After'));
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(retryAfterSec * 1000, 8000)
        : 500 * 2 ** attempt;
      await delay(waitMs);
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
  if (!t || t.is_local || !t.id || !t.artists?.length) return null;
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
    { ok: true; name: string; tracks: PlaylistTrackInput[] } | { ok: false; error: PlaylistFetchError; count?: number }
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
      let url: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=`
        + encodeURIComponent('next,items(track(id,name,duration_ms,is_local,artists(name),album(images,release_date)))');
      while (url && tracks.length < MAX_PLAYLIST_TRACKS) {
        const result: SpotifyFetchResult<SpotifyPlaylistTracksResponse> = await fetchSpotify(url, accessToken);
        if (!result.ok) return result;
        for (const item of result.data.items) {
          const track = toPlaylistTrackInput(item.track);
          if (!track || seen.has(track.spotifyTrackId)) continue;
          seen.add(track.spotifyTrackId);
          tracks.push(track);
        }
        url = result.data.next;
        onProgress?.(tracks.length);
      }

      if (tracks.length < MIN_PLAYLIST_TRACKS) return { ok: false, error: 'too_few', count: tracks.length };
      return { ok: true, name: metaResult.data.name, tracks };
    } catch (err) {
      console.error('[Spotify] fetch playlist tracks threw:', err);
      return { ok: false, error: 'error' };
    }
  }, [accessToken]);

  return { playlists, loadingPlaylists, playlistsError, fetchPlaylists, fetchPlaylistTracks };
}
