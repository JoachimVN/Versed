import type { RoundResultEvent } from '../types';

// Shared tail of the screen-reader phase narration used by both Host and
// Play — the phases before reveal differ (host drives betting/playback,
// players bid/guess), but reveal/leaderboard/finished read identically to
// both audiences. Returns null when the phase isn't one of these shared
// ones, so callers can fall through to their own phase-specific switch.
export function commonPhaseAnnouncement(phase: string, result: RoundResultEvent | null): string | null {
  switch (phase) {
    case 'reveal': return result?.correct ? 'Round result: someone got it.' : 'Round result: no one got it.';
    case 'leaderboard': return 'Leaderboard updated.';
    case 'finished': return 'Final scores are in.';
    default: return null;
  }
}
