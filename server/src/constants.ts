// Every tunable number the game logic reads. Kept in one leaf module so the
// rules can be adjusted without opening the modules that implement them.

// Below this, rounds start repeating tracks (TOTAL_ROUNDS below) — the client
// warns the host but still allows starting, so this isn't a hard floor here.
export const MIN_PLAYLIST_TRACKS = 10;

export const BID_OPTIONS = [0.1, 0.5, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 45, 60];
export const BETTING_TIME = 15;
export const GUESSING_TIME = 15;
export const TOTAL_ROUNDS = 10;
export const MAX_PLAYERS = 50;
export const MAX_ACTIVE_GAMES = 20;

export const RACE_TIME = 30;
export const RACE_DECAY_WINDOW = 12;
export const RACE_FLOOR = 200;
export const RACE_BASE = 1000;

// ─── Party mode tuning ────────────────────────────────────────────────────────
export const STEAL_PCT = 0.25;         // steal takes 25% of the victim's score…
export const STEAL_MIN = 400;          // …but never less than this (capped at their total)
// Finale: flat bonus for winning the best-of-3 duel outright (first to 2
// sub-round wins). Deliberately NOT scaled to the score gap between the
// duelists — "shouldn't be possible to flip a huge score gap based on 3
// rounds" — so it stays meaningful without ever guaranteeing a placement
// flip. Per-sub-round points still score normally on top of this.
export const DUEL_BONUS = 3000;
export const YEAR_MAX_POINTS = 1000;   // year round: exact answer
export const YEAR_POINTS_SLOPE = 120;  // …minus this per year off
export const YEAR_WINNER_BONUS = 500;  // closest answer bonus (split on ties)
export const PITY_GAP_THRESHOLD = 3000; // leader's lead must exceed this…
export const PITY_BONUS = 500;          // …for a scorer to get this catch-up bonus
export const YEAR_CHOICE_RADIUS = 10;
export const MIN_CHOICE_YEAR = 1900;

// The tiniest bids ask for so little audio that a clip can land entirely inside
// a song's near-silent lead-in and reveal nothing — pure bad luck the bidder
// couldn't foresee. We can't detect silence (Spotify's audio-analysis is gone
// and the SDK is DRM'd), so we instead always play at least this much audio.
// Bids are still shown and scored at face value, so the bid ladder stays
// monotonic (more audio ⇄ lower score) and there's no "always bid 0.1" exploit.
export const MIN_PLAY_MS = 200;

// Actual audible window for a winning bid: the bid itself, floored so the
// shortest clips still have a fighting chance of containing a real transient.
export function playMsFor(bid: number): number {
  return Math.max(bid * 1000, MIN_PLAY_MS);
}

// How many recent rounds' artists to avoid repeating, scaled to pool size:
// small pools (a 10-track playlist) get a short window so the constraint
// doesn't overreach and get dropped constantly; larger pools cap out at 5 —
// looking back further than that stops being about "feels repetitive" and
// just costs more comparisons for no real benefit.
export const ARTIST_WINDOW_MIN = 2;
export const ARTIST_WINDOW_MAX = 5;
export const ARTIST_WINDOW_DIVISOR = 4;
