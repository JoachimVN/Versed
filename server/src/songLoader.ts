import fs from 'node:fs';
import path from 'node:path';
import { Song } from './types';

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // "" inside a quoted field is an escaped literal quote (e.g. the title
      // «"Thank U, Next"»), not a field boundary.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// The artist column separates genuinely distinct collaborators with ';', but
// a handful of single-artist stage names that contain a comma (e.g. "Tyler,
// The Creator") got encoded with that same ';' upstream — indistinguishable
// from a real collaborator split without a lookup like this one.
const KNOWN_COMMA_ARTISTS = ['Tyler;The Creator'];

function fixKnownCommaArtists(rawArtist: string): string {
  let fixed = rawArtist;
  for (const name of KNOWN_COMMA_ARTISTS) {
    fixed = fixed.split(name).join(name.replace(';', ', '));
  }
  return fixed;
}

function num(s: string): number | null {
  const n = Number.parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function extractTrackId(url: string): string | null {
  const match = /\/track\/([A-Za-z0-9]+)/.exec(url);
  return match ? match[1] : null;
}

// Columns are looked up by header name, not fixed position — the pipeline
// that produces this CSV (Music Popularity Index) has inserted new columns
// before (e.g. "tempo" landing before bb_peak, shifting everything after it),
// and a fixed-index parser would silently misread every field from that point
// on instead of failing loudly.
const REQUIRED_COLUMNS = ['rank', 'title', 'artist', 'year', 'decade', 'duration_ms', 'bb_peak', 'bb_chart_weeks', 'spotify_streams', 'youtube_views', 'final_score', 'spotify_url'] as const;

function headerIndex(header: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  header.forEach((name, i) => { index[name.trim()] = i; });
  const missing = REQUIRED_COLUMNS.filter(c => !(c in index));
  if (missing.length > 0) {
    throw new Error(`music_index_full.csv is missing expected column(s): ${missing.join(', ')}`);
  }
  return index;
}

export function loadSongs(): Song[] {
  const csvPath = path.join(__dirname, 'data', 'music_index_full.csv');
  const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];

  const header = parseCSVLine(lines[0]);
  const col = headerIndex(header);
  // tempo and album_art_url are newer, optional columns — absent on an older
  // CSV, in which case both fields just come through as null.
  const tempoIdx = col.tempo;
  const artIdx = col.album_art_url;

  const songs: Song[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCSVLine(lines[i]);
    if (f.length < header.length) continue;

    const trackId = extractTrackId(f[col.spotify_url] ?? '');
    if (!trackId) continue;

    const rawArtist = fixKnownCommaArtists(f[col.artist].replace(/^"|"$/g, ''));
    songs.push({
      rank: num(f[col.rank]) ?? i,
      title: f[col.title].replace(/^"|"$/g, '').trim(),
      artist: (rawArtist.split(';')[0] ?? '').trim(),
      featuredArtists: rawArtist.includes(';')
        ? rawArtist.split(';').slice(1).join(', ').trim()
        : undefined,
      year: num(f[col.year]),
      decade: num(f[col.decade]),
      bbPeak: num(f[col.bb_peak]),
      bbChartWeeks: num(f[col.bb_chart_weeks]),
      durationMs: num(f[col.duration_ms]),
      tempo: tempoIdx === undefined ? null : num(f[tempoIdx]),
      spotifyStreams: num(f[col.spotify_streams]),
      youtubeViews: num(f[col.youtube_views]),
      spotifyTrackId: trackId,
      finalScore: num(f[col.final_score]) ?? 0,
      albumArtUrl: (artIdx === undefined ? '' : f[artIdx]?.trim()) || null,
    });
  }

  return songs.sort((a, b) => a.rank - b.rank);
}
