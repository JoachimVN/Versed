import * as gm from '../gameManager';
import { Game, PartyEvent, PartyRoundType, PlaylistTrackInput } from '../types';

export interface StartGameSettings {
  bettingTime?: number; guessingTime?: number; totalRounds?: number; mode?: string;
  raceTime?: number; raceWinnerOnly?: boolean; artistOnly?: boolean; yearOnly?: boolean; multipleChoice?: boolean;
  difficulty?: string; songSource?: string;
  enabledEvents?: string[]; enabledRoundTypes?: string[]; chaosLevel?: number;
  customPlaylist?: { id?: string; tracks?: PlaylistTrackInput[] };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampRounded(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function applyTimingSettings(game: Game, s: StartGameSettings | undefined) {
  if (s?.bettingTime) game.bettingTime = clampRounded(s.bettingTime, 5, 999);
  if (s?.guessingTime) game.guessingTime = clampRounded(s.guessingTime, 5, 999);
  if (s?.totalRounds) game.totalRounds = clampRounded(s.totalRounds, 1, 999);
  if (s?.raceTime) game.raceTime = clampRounded(s.raceTime, 10, 999);
}

function applyModeSettings(game: Game, s: StartGameSettings | undefined) {
  if (s?.mode === 'race') game.mode = 'race';
  else if (s?.mode === 'party') game.mode = 'party';
  else game.mode = 'classic';

  // Party picks its own guess target per round, so these game-wide toggles
  // are Classic/Race only — leaving them set under Party would otherwise
  // leak a stale 'year' accent/target into party rounds client-side.
  const isParty = game.mode === 'party';
  game.yearOnly = !isParty && s?.yearOnly === true;
  // The client only ever shows this toggle in Race mode, and its one
  // useState persists across mode switches in the lobby — gate it here too,
  // or a stale `true` left over from a previous Race game would silently
  // force winner-take-all scoring onto Party's race-format rounds.
  game.raceWinnerOnly = game.mode === 'race' && s?.raceWinnerOnly === true;
  // Artist-only and Year-only can now both be on at once — each round then
  // independently rolls one of the two (see resolveClassicRaceTarget).
  game.artistOnly = !isParty && s?.artistOnly === true;
  // Party has its own 'choice' round type instead of this toggle.
  game.multipleChoice = !isParty && s?.multipleChoice === true;
}

function applyDifficultySettings(game: Game, s: StartGameSettings | undefined) {
  game.difficulty = s?.difficulty === 'easy' || s?.difficulty === 'medium' ? s.difficulty : 'hard';
}

function applyChaosSettings(game: Game, s: StartGameSettings | undefined) {
  game.chaosLevel = typeof s?.chaosLevel === 'number' && Number.isFinite(s.chaosLevel)
    ? clamp(s.chaosLevel, 0, 100)
    : 50;
}

function enabledPartyItems<T extends string>(settings: string[] | undefined, allowed: readonly T[]): Set<T> {
  if (!Array.isArray(settings)) return new Set(allowed);
  return new Set(settings.filter((value): value is T => (allowed as readonly string[]).includes(value)));
}

function applyPartyPoolSettings(game: Game, s: StartGameSettings | undefined) {
  // A missing/non-array setting (never sent, or malformed) falls back to
  // "everything enabled". An explicit array — even filtered down to empty,
  // meaning the host unchecked every event — is respected as-is; the party
  // event picker already treats an empty pool as "always play plain".
  game.enabledEvents = enabledPartyItems<PartyEvent>(s?.enabledEvents, gm.ALL_PARTY_EVENTS);
  game.enabledRoundTypes = enabledPartyItems<PartyRoundType>(s?.enabledRoundTypes, gm.ALL_PARTY_ROUND_TYPES);
}

export function applyStartGameSettings(game: Game, s: StartGameSettings | undefined) {
  applyTimingSettings(game, s);
  applyModeSettings(game, s);
  applyDifficultySettings(game, s);
  applyChaosSettings(game, s);
  applyPartyPoolSettings(game, s);
}

export function applySongSource(game: Game, s: StartGameSettings | undefined): { ok: true } | { ok: false; error: string } {
  if (s?.songSource !== 'playlist') {
    game.songSource = 'library';
    game.songPool = undefined;
    game.playlistId = undefined;
    return { ok: true };
  }
  const tracks = s.customPlaylist?.tracks;
  if (!Array.isArray(tracks)) return { ok: false, error: 'No playlist selected' };
  return gm.setCustomSongPool(game, s.customPlaylist?.id, tracks);
}
