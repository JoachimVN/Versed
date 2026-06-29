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
//  0  rank
//  1  title
//  2  artist
//  3  year
//  4  decade
//  5  bb_peak
//  6  bb_chart_weeks
//  7  bb_score
//  8  spotify_streams
//  9  sp_score
// 10  youtube_views
// 11  yt_score
// 12  itunes_total
// 13  itunes_score
// 14  apple_total
// 15  apple_score
// 16  final_score
// 17  spotify_url
export function loadSongs(): Song[] {
  const csvPath = path.join(__dirname, 'data', 'music_index_full.csv');
  const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());

  const songs: Song[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCSVLine(lines[i]);
    if (f.length < 18) continue;

    const trackId = extractTrackId(f[17] ?? '');
    if (!trackId) continue;

    songs.push({
      rank: num(f[0]) ?? i,
      title: f[1].replace(/^"|"$/g, '').trim(),
      artist: f[2].replace(/^"|"$/g, '').trim(),
      year: num(f[3]),
      decade: num(f[4]),
      bbPeak: num(f[5]),
      bbChartWeeks: num(f[6]),
      spotifyStreams: num(f[8]),
      youtubeViews: num(f[10]),
      spotifyTrackId: trackId,
      finalScore: num(f[16]) ?? 0,
    });
  }

  return songs.sort((a, b) => a.rank - b.rank);
}
