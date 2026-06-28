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

export function loadSongs(): Song[] {
  const csvPath = path.join(__dirname, 'data', 'music_index_full.csv');
  const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());

  const songs: Song[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCSVLine(lines[i]);
    if (f.length < 12) continue;

    const trackId = extractTrackId(f[11] ?? '');
    if (!trackId) continue;

    songs.push({
      rank: Number.parseInt(f[0]) || i,
      title: f[1].replace(/^"|"$/g, '').trim(),
      artist: f[2].replace(/^"|"$/g, '').trim(),
      year: num(f[3]),
      decade: num(f[4]),
      bbPeak: num(f[5]),
      bbChartWeeks: num(f[6]),
      spotifyStreams: num(f[7]),
      spotifyTrackId: trackId,
      finalScore: num(f[10]) ?? 0,
    });
  }

  return songs.sort((a, b) => a.rank - b.rank);
}
