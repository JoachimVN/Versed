import { PlaylistTrackInput, Song } from './types';

const MIN_YEAR = 1900;
const MAX_PLAYLIST_TRACKS = 5000;
const TRACK_ID_PATTERN = /^[A-Za-z0-9]{1,50}$/;
const MAX_TRACK_TEXT_LENGTH = 300;
const MAX_ART_URL_LENGTH = 2048;

function sanitizeText(value: unknown, maxLength = MAX_TRACK_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function sanitizeAlbumArtUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_ART_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function sanitizeYear(year: number | null): number | null {
  if (year === null || !Number.isFinite(year)) return null;
  const maxYear = new Date().getFullYear() + 1;
  return year >= MIN_YEAR && year <= maxYear ? Math.trunc(year) : null;
}

function sanitizeDurationMs(durationMs: number | null): number | null {
  return durationMs !== null && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
}

// Adapts a host-picked playlist's tracks into the Song shape the rest of
// gameManager already knows how to play, hint on, and score. `rank` here is
// only a structural placeholder (Song.rank is non-optional) — playlist songs
// never go through the CSV pool's popularity-based difficulty math; see
// FLAT_DIFFICULTY_BONUS in gameManager.ts. `csvByTrackId` (keyed by Spotify
// track ID) is an exact-match lookup only — no fuzzy title/artist matching —
// so tempo/streams enrich a track when it happens to also be in the CSV
// catalog, but a miss just leaves those fields null like before.
export function adaptPlaylistTracks(tracks: PlaylistTrackInput[], csvByTrackId: ReadonlyMap<string, Song> = new Map()): Song[] {
  const seen = new Set<string>();
  const songs: Song[] = [];

  for (const t of tracks.slice(0, MAX_PLAYLIST_TRACKS)) {
    const spotifyTrackId = sanitizeText(t?.spotifyTrackId, 50);
    const title = sanitizeText(t?.title);
    const artist = sanitizeText(t?.artist);
    if (!spotifyTrackId || !TRACK_ID_PATTERN.test(spotifyTrackId) || !title || !artist) continue;
    if (seen.has(spotifyTrackId)) continue;
    seen.add(spotifyTrackId);

    const year = sanitizeYear(t.year);
    const csvMatch = csvByTrackId.get(spotifyTrackId);
    songs.push({
      rank: songs.length + 1,
      title,
      artist,
      featuredArtists: sanitizeText(t.featuredArtists) ?? undefined,
      year,
      decade: year ? Math.floor(year / 10) * 10 : null,
      bbPeak: null,
      bbChartWeeks: null,
      durationMs: sanitizeDurationMs(t.durationMs),
      tempo: csvMatch?.tempo ?? null,
      spotifyStreams: csvMatch?.spotifyStreams ?? null,
      youtubeViews: null,
      spotifyTrackId,
      finalScore: 0,
      albumArtUrl: sanitizeAlbumArtUrl(t.albumArtUrl),
    });
  }

  return songs;
}
