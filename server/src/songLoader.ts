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

// CSV columns (0-based):
//  0  rank
//  1  title
//  2  artist
//  3  year
//  4  release_year
//  5  decade
//  6  duration_ms
//  7  bb_peak
//  8  bb_chart_weeks
//  9  bb_score
// 10  spotify_streams
// 11  sp_score
// 12  youtube_views
// 13  yt_score
// 14  itunes_total
// 15  itunes_score
// 16  apple_total
// 17  apple_score
// 18  sales_peak
// 19  sales_chart_weeks
// 20  sales_score
// 21  riaa_units
// 22  riaa_score
// 23  radio_peak
// 24  radio_chart_weeks
// 25  radio_score
// 26  final_score
// 27  spotify_url
export function loadSongs(): Song[] {
  const csvPath = path.join(__dirname, 'data', 'music_index_full.csv');
  const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());

  const songs: Song[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCSVLine(lines[i]);
    if (f.length < 28) continue;

    const trackId = extractTrackId(f[27] ?? '');
    if (!trackId) continue;

    songs.push({
      rank: num(f[0]) ?? i,
      title: f[1].replace(/^"|"$/g, '').trim(),
      artist: (f[2].replace(/^"|"$/g, '').split(';')[0] ?? '').trim(),
      featuredArtists: f[2].replace(/^"|"$/g, '').includes(';')
        ? f[2].replace(/^"|"$/g, '').split(';').slice(1).join(', ').trim()
        : undefined,
      year: num(f[3]),
      decade: num(f[5]),
      bbPeak: num(f[7]),
      bbChartWeeks: num(f[8]),
      durationMs: num(f[6]),
      spotifyStreams: num(f[10]),
      youtubeViews: num(f[12]),
      spotifyTrackId: trackId,
      finalScore: num(f[26]) ?? 0,
    });
  }

  return songs.sort((a, b) => a.rank - b.rank);
}
