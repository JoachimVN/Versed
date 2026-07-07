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

// Accepts a full share URL (open.spotify.com/playlist/<id>), a URI
// (spotify:playlist:<id>), or a bare ID pasted directly.
export function resolvePlaylistInput(raw: string): string | null {
  const trimmed = raw.trim();
  const urlMatch = /open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/.exec(trimmed);
  if (urlMatch) return urlMatch[1];
  const uriMatch = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(trimmed);
  if (uriMatch) return uriMatch[1];
  return /^[A-Za-z0-9]{15,30}$/.test(trimmed) ? trimmed : null;
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
        const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.status === 401 || res.status === 403) { setPlaylistsError('unauthorized'); return; }
        if (!res.ok) {
          console.error(`[Spotify] fetch playlists failed ${res.status}:`, await res.text());
          setPlaylistsError('error');
          return;
        }
        const data = await res.json() as SpotifyPlaylistsResponse;
        for (const item of data.items) {
          const trackCount = item?.tracks?.total ?? item?.items?.total;
          // Playlist folders (and the occasional null/unavailable entry) show up
          // here too but have neither field — they aren't real playlists.
          if (trackCount === undefined) continue;
          all.push({ id: item.id, name: item.name, imageUrl: item.images?.[0]?.url ?? null, trackCount });
        }
        url = data.next;
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
  ): Promise<
    { ok: true; name: string; tracks: PlaylistTrackInput[] } | { ok: false; error: PlaylistFetchError; count?: number }
  > => {
    if (!accessToken) return { ok: false, error: 'error' };
    try {
      const metaRes = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}?fields=name`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (metaRes.status === 401 || metaRes.status === 403) return { ok: false, error: 'unauthorized' };
      if (metaRes.status === 404) return { ok: false, error: 'not_found' };
      if (!metaRes.ok) {
        console.error(`[Spotify] fetch playlist meta failed ${metaRes.status}:`, await metaRes.text());
        return { ok: false, error: 'error' };
      }
      const meta = await metaRes.json() as { name: string };

      const seen = new Set<string>();
      const tracks: PlaylistTrackInput[] = [];
      let url: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=`
        + encodeURIComponent('next,items(track(id,name,duration_ms,is_local,artists(name),album(images,release_date)))');
      while (url && tracks.length < MAX_PLAYLIST_TRACKS) {
        const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.status === 401 || res.status === 403) return { ok: false, error: 'unauthorized' };
        if (!res.ok) {
          console.error(`[Spotify] fetch playlist tracks failed ${res.status}:`, await res.text());
          return { ok: false, error: 'error' };
        }
        const data = await res.json() as SpotifyPlaylistTracksResponse;
        for (const item of data.items) {
          const t = item.track;
          // Skip removed tracks, local files (unplayable via the Web Playback
          // SDK), and episodes/non-track items (no artists array).
          if (!t || t.is_local || !t.id || !t.artists?.length) continue;
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          tracks.push({
            spotifyTrackId: t.id,
            title: t.name,
            artist: t.artists[0].name,
            featuredArtists: t.artists.length > 1
              ? t.artists.slice(1).map(a => a.name).join(', ')
              : undefined,
            durationMs: t.duration_ms ?? null,
            year: parseYear(t.album?.release_date),
            albumArtUrl: t.album?.images?.[0]?.url ?? null,
          });
        }
        url = data.next;
      }

      if (tracks.length < MIN_PLAYLIST_TRACKS) return { ok: false, error: 'too_few', count: tracks.length };
      return { ok: true, name: meta.name, tracks };
    } catch (err) {
      console.error('[Spotify] fetch playlist tracks threw:', err);
      return { ok: false, error: 'error' };
    }
  }, [accessToken]);

  return { playlists, loadingPlaylists, playlistsError, fetchPlaylists, fetchPlaylistTracks };
}
