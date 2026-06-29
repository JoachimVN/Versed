import fs from 'node:fs';
import path from 'node:path';
import { Song } from './types';

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
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
//  0  title
//  1  artist
//  2  year
//  3  decade
//  4  bb_peak
//  5  bb_chart_weeks
//  6  bb_score
//  7  spotify_streams
//  8  sp_score
//  9  youtube_views
// 10  yt_score
// 11  itunes_total
// 12  itunes_score
// 13  apple_total
// 14  apple_score
// 15  final_score
// 16  spotify_url
export function loadSongs(): Song[] {
  const csvPath = path.join(__dirname, 'data', 'music_index_full.csv');
  const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());

  const songs: Song[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCSVLine(lines[i]);
    if (f.length < 17) continue;

    const trackId = extractTrackId(f[16] ?? '');
    if (!trackId) continue;

    songs.push({
      rank: i,
      title: f[0].replace(/^"|"$/g, '').trim(),
      artist: f[1].replace(/^"|"$/g, '').trim(),
      year: num(f[2]),
      decade: num(f[3]),
      bbPeak: num(f[4]),
      bbChartWeeks: num(f[5]),
      spotifyStreams: num(f[7]),
      youtubeViews: num(f[9]),
      spotifyTrackId: trackId,
      finalScore: num(f[15]) ?? 0,
    });
  }

  return songs.sort((a, b) => a.rank - b.rank);
}
