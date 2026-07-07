import { useCallback, useState } from 'react';
import { PlaylistTrackInput } from '../types';
import { BACKEND_URL } from '../config';
import { sanitizeToken } from './useSpotify';

export interface PlaylistSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
  // False when the current user neither owns nor collaborates on this
  // playlist — Spotify's playlist-items endpoint 403s on those regardless of
  // visibility (see 'forbidden' below), so the picker greys these out rather
  // than letting them be picked and fail.
  importable: boolean;
}

// 'unauthorized' = token lacks the playlist-read scopes (old session, needs
// re-consent) — distinct from useSpotify's `unauthorized` (Dev-Mode account
// allowlisting), which has a different cause and a different fix.
// 'empty' = zero playable tracks, the only per-playlist count that still
// blocks — anything else is allowed through with a warning (see Host.tsx).
// 'forbidden' = token is valid but Spotify's playlist-items endpoint only
// serves playlists the current user owns or collaborates on — being public
// isn't enough (https://developer.spotify.com/documentation/web-api/reference/get-playlists-items).
// Distinct from 'unauthorized': reconnecting Spotify won't fix this.
export type PlaylistFetchError = 'unauthorized' | 'forbidden' | 'not_found' | 'empty' | 'error';

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
    // Route through backend to ensure token is always fresh
    const res = await fetch(`${BACKEND_URL}/api/auth/fetch-playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken, url }),
      signal: controller.signal,
    });
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
  return status === 401;
}

type ResponseOutcome<T> =
  | { retry: false; result: SpotifyFetchResult<T> }
  | { retry: true; delayMs: number };

// Turns a landed HTTP response into either a final result or a "retry after
// this long" signal, so the retry loop in fetchSpotify only has to act on
// that decision instead of branching on status codes itself.
async function classifyResponse<T>(
  res: Response, url: string, notFoundIsPlaylist: boolean, attempt: number, canRetry: boolean,
): Promise<ResponseOutcome<T>> {
  if (isAuthError(res.status)) return { retry: false, result: { ok: false, error: 'unauthorized' } };
  if (res.status === 403) {
    const body = await res.text();
    console.error('[Spotify] 403 forbidden', {
      url: url.replace(/[\r\n]/g, ''),
      body: body.replace(/[\r\n]/g, ''),
    });
    return { retry: false, result: { ok: false, error: 'forbidden' } };
  }
  if (isPlaylistNotFound(notFoundIsPlaylist, res.status)) {
    return { retry: false, result: { ok: false, error: 'not_found' } };
  }
  if (isTransientStatus(res.status) && canRetry) return { retry: true, delayMs: retryDelayMs(res, attempt) };
  if (!res.ok) {
    const body = await res.text();
    console.error('[Spotify] request failed', {
      url: url.replace(/[\r\n]/g, ''),
      status: res.status,
      body: body.replace(/[\r\n]/g, ''),
    });
    return { retry: false, result: { ok: false, error: 'error' } };
  }
  return { retry: false, result: { ok: true, data: await res.json() as T } };
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

    const outcome = await classifyResponse<T>(attemptResult.res, url, notFoundIsPlaylist, attempt, canRetry);
    if (outcome.retry) { await delay(outcome.delayMs); continue; }
    return outcome.result;
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

// Spotify's `collaborative` flag on /me/playlists only reports true to the
// playlist's *owner* — a collaborator gets back the same `false` a person
// who merely follows a public playlist would, so metadata alone can't tell
// them apart. The only reliable signal is a live probe against the same
// endpoint the real import uses: a 403 there is the authoritative "can't
// import this", whatever the list metadata claims.
async function probeImportable(playlistId: string, accessToken: string): Promise<boolean> {
  // Goes through a dedicated backend route (rather than fetchWithTimeout's
  // generic proxy) that always replies 200 with the result in the body —
  // a real, expected-forbidden outcome here would otherwise show up as a
  // failed request in the browser's network console for every playlist the
  // user doesn't have access to, which reads as the app being broken.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/check-playlist-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken, playlist_id: playlistId }),
      signal: controller.signal,
    });
    if (!res.ok) return true; // fail open
    const data = await res.json() as { importable?: boolean };
    return data.importable ?? true;
  } catch {
    return true; // fail open on timeout/network error
  } finally {
    clearTimeout(timeoutId);
  }
}

// Runs the per-playlist probes with bounded parallelism instead of one big
// Promise.all — a large library (hundreds of playlists) firing all at once
// would trip Spotify's rate limit and make every probe look forbidden.
const IMPORTABILITY_PROBE_CONCURRENCY = 8;

async function probeImportability(ids: string[], accessToken: string): Promise<Map<string, boolean>> {
  const importableById = new Map<string, boolean>();
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      importableById.set(id, await probeImportable(id, accessToken));
    }
  }
  const workerCount = Math.min(IMPORTABILITY_PROBE_CONCURRENCY, ids.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return importableById;
}

// Walks every page of a playlist's tracks, dedupes, and filters out
// unplayable entries. Split out of fetchPlaylistTracks so the pagination
// loop's nesting doesn't add to that function's own branching.
async function collectPlaylistTracks(
  playlistId: string, token: string, onProgress?: (count: number) => void,
): Promise<
  { ok: true; tracks: PlaylistTrackInput[]; truncated: boolean }
  | { ok: false; error: PlaylistFetchError }
> {
  const seen = new Set<string>();
  const tracks: PlaylistTrackInput[] = [];
  // Spotify's Feb 2026 API migration removed `/tracks` — `/items` is its
  // replacement, with each entry's `track` field renamed to `item`.
  let url: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100&fields=`
    + encodeURIComponent('next,items(item(type,id,name,duration_ms,is_local,artists(name),album(images,release_date)))');
  while (url && tracks.length < MAX_PLAYLIST_TRACKS) {
    const result: SpotifyFetchResult<SpotifyPlaylistTracksResponse> = await fetchSpotify(url, token);
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
  // `url` still non-null here means the loop stopped because it hit the
  // cap, not because it ran out of pages — i.e. the playlist has more
  // tracks than we imported.
  const truncated = tracks.length >= MAX_PLAYLIST_TRACKS && url !== null;
  return { ok: true, tracks, truncated };
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = sessionStorage.getItem('spotify_rt');
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await res.json() as { access_token?: string };
    // Server response is attacker-influenceable (tainted) same as the token in
    // useSpotify's URL-fragment flow — never write it to storage unvalidated.
    const accessToken = sanitizeToken(data.access_token);
    if (accessToken) {
      sessionStorage.setItem('spotify_at', accessToken);
      return accessToken;
    }
  } catch (err) {
    console.error('[Spotify] Token refresh failed:', err);
  }
  return null;
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
      // Ensure token is fresh before fetching
      let token = accessToken;
      const freshToken = await refreshAccessToken();
      if (freshToken) token = freshToken;

      const all: Array<Omit<PlaylistSummary, 'importable'>> = [];
      let url: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50';
      while (url) {
        const result: SpotifyFetchResult<SpotifyPlaylistsResponse> = await fetchSpotify(url, token);
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
      const importableById = await probeImportability(all.map(p => p.id), token);
      setPlaylists(all.map(p => ({ ...p, importable: importableById.get(p.id) ?? true })));
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
    let token = accessToken;
    if (!token) return { ok: false, error: 'error' };

    // Ensure token is fresh before fetching
    const freshToken = await refreshAccessToken();
    if (freshToken) token = freshToken;

    // Re-validated here (not just trusted from the caller) immediately before
    // it's used to build a request URL — see PLAYLIST_ID_PATTERN.
    if (!PLAYLIST_ID_PATTERN.test(playlistId)) return { ok: false, error: 'not_found' };

    // Probed first (same 200-always endpoint the grid uses) so the common
    // "you don't have access" case never hits Spotify's API directly from
    // here — that would 403, which both fetchSpotify's own logging and the
    // browser's network console would report as a failed request even
    // though it's an expected, well-understood outcome.
    if (!(await probeImportable(playlistId, token))) return { ok: false, error: 'forbidden' };

    try {
      const metaResult = await fetchSpotify<{ name: string }>(
        `https://api.spotify.com/v1/playlists/${playlistId}?fields=name`, token, true,
      );
      if (!metaResult.ok) return metaResult;

      const collected = await collectPlaylistTracks(playlistId, token, onProgress);
      if (!collected.ok) return collected;
      if (collected.tracks.length === 0) return { ok: false, error: 'empty', count: 0 };
      return { ok: true, name: metaResult.data.name, tracks: collected.tracks, truncated: collected.truncated };
    } catch (err) {
      console.error('[Spotify] fetch playlist tracks threw:', err);
      return { ok: false, error: 'error' };
    }
  }, [accessToken]);

  return { playlists, loadingPlaylists, playlistsError, fetchPlaylists, fetchPlaylistTracks };
}
