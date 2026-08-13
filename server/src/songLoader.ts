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
  // tempo, album_art_url and release_year are newer, optional columns —
  // absent on an older CSV, in which case they come through as null/fall back.
  const tempoIdx = col.tempo;
  const artIdx = col.album_art_url;
  const releaseYearIdx = col.release_year;

  const songs: Song[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCSVLine(lines[i]);
    if (f.length < header.length) continue;

    const trackId = extractTrackId(f[col.spotify_url] ?? '');
    if (!trackId) continue;

    const rawArtist = f[col.artist].replace(/^"|"$/g, '');
    const year = (releaseYearIdx === undefined ? null : num(f[releaseYearIdx])) ?? num(f[col.year]);
    songs.push({
      rank: num(f[col.rank]) ?? i,
      title: f[col.title].replace(/^"|"$/g, '').trim(),
      artist: (rawArtist.split(';')[0] ?? '').trim(),
      // ';'-joined (not ', '): individual artist names can themselves contain
      // commas (e.g. "Tyler, The Creator", "Crosby, Stills & Nash"), so a
      // comma join would be ambiguous to split back apart downstream. See
      // fuzzyMatch.ts/songPool.ts, which split this on ';'; display sites
      // render it as ', ' for humans.
      featuredArtists: rawArtist.includes(';')
        ? rawArtist.split(';').slice(1).join(';').trim()
        : undefined,
      // Prefer the true Spotify release year over the pipeline's "year"
      // column, which is actually the song's first Billboard Hot 100 chart
      // year — those diverge for singles that chart late (e.g. a TikTok
      // resurgence), and this field is what the year-guessing game quizzes.
      year,
      // Derived from the same `year` above (not read from the CSV's "decade"
      // column) so the "Era" hint in hints.ts never contradicts it.
      decade: year === null ? null : Math.floor(year / 10) * 10,
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
