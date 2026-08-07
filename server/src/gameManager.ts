import { randomInt } from 'node:crypto';
import {
  Award, AwardMoment, Game, GuessTarget, Player, PlaylistTrackInput, PointsBreakdown, PointsBreakdownPart, Round, Song, YearResult,
} from './types';
import { isCorrectGuess, isCorrectArtistGuess } from './fuzzyMatch';
import {
  ARTIST_WINDOW_MAX, BETTING_TIME, BID_OPTIONS, DUEL_BONUS, GUESSING_TIME, MAX_PLAYERS, PITY_BONUS,
  RACE_TIME, STEAL_MIN, STEAL_PCT, TOTAL_ROUNDS, YEAR_MAX_POINTS, YEAR_POINTS_SLOPE, YEAR_WINNER_BONUS,
} from './constants';
import { pickWeighted } from './random';
import {
  ALL_PARTY_EVENTS, ALL_PARTY_ROUND_TYPES, buildPartyConfig, isRaceFlowRound, isWinnerOnlyRound,
  raceParticipants, restrictedParticipantIds, roundMultiplier,
} from './party';
import {
  buildCustomPool, classicChoiceOptions, computeSnippetPosition, maybeApplyPartyChoiceOptions,
  pickRoundSong, poolKey, poolSizeForCap, rememberRecentlyPlayed,
} from './songPool';
import { resolveRoundHints } from './hints';
import {
  bidScore, buildBreakdown, calcPoints, calcRacePoints, calcRaceWinnerPoints, currentScores,
  difficultyBonus, pityBonus,
} from './scoring';

// The game state machine: the in-memory registry of live games, and every
// transition a socket handler can trigger on one. The pure rules it composes
// live in ./party (what a round is), ./songPool (which song), ./hints (what's
// shown), ./scoring (what it pays) and ./constants (the numbers).

// Re-exported so the socket layer keeps a single `import * as gm` entry point
// for everything it needs, rather than reaching into each rules module.
export {
  ALL_PARTY_EVENTS, ALL_PARTY_ROUND_TYPES, isRaceFlowRound, partyView,
} from './party';
export { initSongs } from './songPool';
export { bidScoreTable } from './scoring';
export { BID_OPTIONS, MAX_ACTIVE_GAMES, PITY_BONUS, playMsFor } from './constants';

const games = new Map<string, Game>();
const socketToPin = new Map<string, string>();

function generatePin(): string {
  let pin: string;
  do { pin = (100 + randomInt(0, 900)).toString(); }
  while (games.has(pin));
  return pin;
}

// ─── Round construction ──────────────────────────────────────────────────────

// What this round's guess is checked against — resolved once per round (see
// resolveRoundTarget, called from buildRound) and stored on round.target, so
// every consumer — scoring, hints, reconnect resends — reads the same value
// for the round's whole lifetime instead of re-deriving it.
export function effectiveTarget(round: Round): GuessTarget | 'year' {
  return round.target;
}

// Classic/race's per-round target: both toggles alone are each a fixed
// target for the whole game, but the user's own framing for combining them
// is "the rounds switch between artist/year" — so with both on, each round
// independently rolls one of the two, rather than asking for both at once.
function resolveClassicRaceTarget(game: Game): GuessTarget | 'year' {
  if (game.yearOnly && game.artistOnly) return pickWeighted<'artist' | 'year'>([['artist', 50], ['year', 50]]);
  if (game.yearOnly) return 'year';
  if (game.artistOnly) return 'artist';
  return 'title';
}

// What's actually being guessed this round — decides which hints would give
// the answer away outright, which "other" fact is safe to surface instead,
// and (stored as round.target by the caller) what scoring checks the guess
// against for the round's whole lifetime. Party rounds carry their own
// per-round target/format; classic/race games roll from the game-wide
// toggles. Must be called after any Party downgrade block that can mutate
// party.format/party.target (see buildRound) — never resolved up front.
function resolveRoundTarget(game: Game, party: Round['party']): GuessTarget | 'year' {
  if (party) return party.target === 'year' || party.format === 'year' ? 'year' : party.target;
  return resolveClassicRaceTarget(game);
}

function checkGuess(
  target: GuessTarget, text: string, artistText: string | undefined, song: Song,
): { correct: boolean; artistBonus: boolean } {
  if (target === 'artist') {
    return { correct: isCorrectArtistGuess(text, song.artist, song.featuredArtists), artistBonus: false };
  }
  const correct = isCorrectGuess(text, song.title, song.artist, song.featuredArtists);
  const artistBonus = target === 'both' && correct && !!artistText
    && isCorrectArtistGuess(artistText, song.artist, song.featuredArtists);
  return { correct, artistBonus };
}

function buildRound(game: Game, party?: Round['party']): Round {
  const { song, pool } = pickRoundSong(game, party);

  maybeApplyPartyChoiceOptions(song, pool, party);
  const snippetMs = party ? computeSnippetPosition(song, party, game.raceTime) : undefined;
  // Resolved after the choice-downgrade block above (which can mutate
  // party.format/party.target) so this never reflects a stale pre-downgrade
  // value — see resolveRoundTarget's own comment.
  const target = resolveRoundTarget(game, party);
  const choiceOptions = classicChoiceOptions(game, party, song, pool, target);

  // Chaos Hints repurposes the normal `hints` transport to carry its own
  // 4-hint "spot the fake" set instead of the usual guess-along hints —
  // bypasses buildRoundHints entirely for this event.
  const { hints, chaosFakeIndex } = resolveRoundHints(song, pool, party, target);

  return {
    song,
    hints,
    target,
    choiceOptions,
    party,
    snippetMs,
    chaosFakeIndex,
    chaosTapped: new Map(),
    bids: new Map(),
    bidTiers: [],
    tierIndex: 0,
    guesserSocketIds: [],
    lowestBid: 0,
    answered: false,
    passed: new Set(),
    earlyGuessers: new Set(),
    guesses: new Map(),
    liveDrafts: new Map(),
    artistGuesses: new Map(),
    liveArtistDrafts: new Map(),
    scoredSocketIds: new Set(),
    pityAwardedTo: new Set(),
    pointsBreakdown: new Map(),
    playStartAt: null,
    firstCorrectAt: null,
    correctGuessers: new Set(),
    guessTimes: new Map(),
    tierStartAt: null,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function activeGameCount(): number {
  return games.size;
}

// `preferredPin` lets "New Game" reuse the previous game's PIN (once that game
// is cleaned up), so QR codes, deep links and players' saved sessions stay
// valid across a restart. Falls back to a fresh PIN if it's somehow taken.
export function createGame(hostSocketId: string, preferredPin?: string): Game {
  const pin = preferredPin && !games.has(preferredPin) ? preferredPin : generatePin();
  const game: Game = {
    pin,
    hostSocketId,
    players: new Map(),
    formerPlayers: new Map(),
    phase: 'lobby',
    roundIndex: 0,
    totalRounds: TOTAL_ROUNDS,
    bettingTime: BETTING_TIME,
    guessingTime: GUESSING_TIME,
    mode: 'classic',
    raceTime: RACE_TIME,
    raceWinnerOnly: false,
    artistOnly: false,
    yearOnly: false,
    multipleChoice: false,
    difficulty: 'hard',
    enabledEvents: new Set(ALL_PARTY_EVENTS),
    enabledRoundTypes: new Set(ALL_PARTY_ROUND_TYPES),
    chaosLevel: 50,
    finaleEnabled: false,
    duelChampion: null,
    duelActive: false,
    duelDuelistIds: [],
    duelWins: {},
    duelSubRoundIndex: 0,
    songSource: 'library',
    playlistId: undefined,
    currentRound: null,
    usedSongIds: new Set(),
    artistWindow: [],
    phaseTimer: null,
    phaseEndsAt: null,
    finishedAt: null,
  };
  games.set(pin, game);
  socketToPin.set(hostSocketId, pin);
  return game;
}

// Re-validates and applies a host-picked playlist as the game's song pool.
export function setCustomSongPool(
  game: Game, playlistId: string | undefined, tracks: PlaylistTrackInput[],
): { ok: true } | { ok: false; error: string } {
  const pool = buildCustomPool(tracks);
  if (pool.length === 0) {
    return { ok: false, error: 'That playlist has no playable tracks' };
  }
  game.songSource = 'playlist';
  game.songPool = pool;
  game.playlistId = playlistId;
  return { ok: true };
}

export function getGame(pin: string): Game | undefined {
  return games.get(pin);
}

export function getGameBySocket(socketId: string): Game | undefined {
  const pin = socketToPin.get(socketId);
  return pin ? games.get(pin) : undefined;
}

export function addPlayer(game: Game, socketId: string, name: string): Player | null {
  if (game.players.size >= MAX_PLAYERS) return null;
  const taken = Array.from(game.players.values()).some(
    p => p.name.toLowerCase() === name.trim().toLowerCase()
  );
  if (taken) return null;
  const former = game.formerPlayers.get(name.trim().toLowerCase());
  const player: Player = {
    socketId, name: name.trim(), score: former?.score ?? 0, streak: former?.streak ?? 0,
    totalCorrect: former?.totalCorrect ?? 0, totalPasses: former?.totalPasses ?? 0,
    fastestCorrectMs: former?.fastestCorrectMs ?? null, fastestClassicMs: former?.fastestClassicMs ?? null,
    fastestCorrectMoment: former?.fastestCorrectMoment ?? null,
    fastestClassicMoment: former?.fastestClassicMoment ?? null,
    biggestSwing: former?.biggestSwing ?? 0,
  };
  game.players.set(socketId, player);
  socketToPin.set(socketId, game.pin);
  return player;
}

// Re-attach an existing player to a fresh socket id after a reconnect (e.g. a
// dropped connection or a dev hot-reload). Without this the player's socket
// becomes a stranger to the game and every submit_bid / submit_guess is
// silently rejected. Migrates any in-flight round references too, so a round
// already under way keeps working for the reconnected player.
function migrateRoundSocketId(round: Round, oldId: string, newId: string): void {
  const bid = round.bids.get(oldId);
  if (bid !== undefined) { round.bids.set(newId, bid); round.bids.delete(oldId); }
  round.guesserSocketIds = round.guesserSocketIds.map(id => (id === oldId ? newId : id));
  round.bidTiers.forEach(t => { t.socketIds = t.socketIds.map(id => (id === oldId ? newId : id)); });
  if (round.passed.delete(oldId)) round.passed.add(newId);
  const guess = round.guesses.get(oldId);
  if (guess !== undefined) { round.guesses.set(newId, guess); round.guesses.delete(oldId); }
  if (round.correctGuessers.delete(oldId)) round.correctGuessers.add(newId);
  const guessTime = round.guessTimes.get(oldId);
  if (guessTime !== undefined) { round.guessTimes.set(newId, guessTime); round.guessTimes.delete(oldId); }
  const tapped = round.chaosTapped.get(oldId);
  if (tapped !== undefined) { round.chaosTapped.set(newId, tapped); round.chaosTapped.delete(oldId); }
  if (round.party) {
    round.party.duelistIds = round.party.duelistIds.map(id => (id === oldId ? newId : id));
    round.party.restrictedIds = round.party.restrictedIds.map(id => (id === oldId ? newId : id));
  }
  if (round.stealBy === oldId) round.stealBy = newId;
}

export function renamePlayer(game: Game, socketId: string, newName: string): Player | null {
  const player = game.players.get(socketId);
  if (!player) return null;
  const trimmed = newName.trim();
  if (!trimmed) return null;
  const taken = Array.from(game.players.values()).some(
    p => p.socketId !== socketId && p.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (taken) return null;
  player.name = trimmed;
  return player;
}

export function rejoinPlayer(game: Game, newSocketId: string, name: string): Player | null {
  const entry = Array.from(game.players.entries()).find(
    ([, p]) => p.name.toLowerCase() === name.trim().toLowerCase()
  );
  if (!entry) return null;
  const [oldId, player] = entry;

  if (oldId !== newSocketId) {
    game.players.delete(oldId);
    socketToPin.delete(oldId);
    player.socketId = newSocketId;
    game.players.set(newSocketId, player);
    if (game.currentRound) migrateRoundSocketId(game.currentRound, oldId, newSocketId);
    // Duel state lives on Game (not Round), since it must survive each
    // sub-round's fresh Round object — so it needs its own remap here,
    // separate from migrateRoundSocketId's round-scoped one.
    if (game.duelDuelistIds.includes(oldId)) {
      game.duelDuelistIds = game.duelDuelistIds.map(id => (id === oldId ? newSocketId : id));
      const wins = game.duelWins[oldId];
      if (wins !== undefined) { game.duelWins[newSocketId] = wins; delete game.duelWins[oldId]; }
      if (game.duelChampion === oldId) game.duelChampion = newSocketId;
    }
  }
  socketToPin.set(newSocketId, game.pin);
  return player;
}

export function removeSocket(socketId: string): { game: Game; wasHost: boolean } | null {
  const game = getGameBySocket(socketId);
  if (!game) return null;
  socketToPin.delete(socketId);
  const wasHost = game.hostSocketId === socketId;
  if (!wasHost) {
    const player = game.players.get(socketId);
    if (player) {
      game.formerPlayers.set(player.name.toLowerCase(), {
        name: player.name, score: player.score, streak: player.streak,
        totalCorrect: player.totalCorrect, totalPasses: player.totalPasses,
        fastestCorrectMs: player.fastestCorrectMs, fastestClassicMs: player.fastestClassicMs,
        fastestCorrectMoment: player.fastestCorrectMoment, fastestClassicMoment: player.fastestClassicMoment,
        biggestSwing: player.biggestSwing,
      });
    }
    game.players.delete(socketId);
  }
  return { game, wasHost };
}

export function startRound(game: Game): Round {
  if (game.phaseTimer) clearTimeout(game.phaseTimer);
  // Build the party recipe before replacing currentRound — it reads the
  // previous round's format/event to avoid repeats.
  const party = game.mode === 'party' ? buildPartyConfig(game) : undefined;
  const round = buildRound(game, party);
  game.usedSongIds.add(round.song.spotifyTrackId);
  rememberRecentlyPlayed(poolKey(game), round.song.spotifyTrackId, poolSizeForCap(game));
  game.artistWindow.push(round.song);
  if (game.artistWindow.length > ARTIST_WINDOW_MAX) game.artistWindow.shift();
  game.currentRound = round;
  game.phase = 'betting';
  return round;
}

export function recordBid(game: Game, socketId: string, seconds: number): boolean {
  if (game.phase !== 'betting') return false;
  if (!game.players.has(socketId)) return false;
  if (!BID_OPTIONS.includes(seconds)) return false;
  // A finale duel's classic sub-round is only for the two duelists — everyone
  // else just watches (mirrors the finale's existing race-flow restriction,
  // which classic never needed before the duel could ride this format).
  const party = game.currentRound?.party;
  if (party?.finale && !party.duelistIds.includes(socketId)) return false;
  game.currentRound!.bids.set(socketId, seconds);
  return true;
}

export interface TierTurn {
  lowestBid: number;
  guesserSocketIds: string[];
  guesserNames: string[];
}

// Point the round's guessers at the current tier and reset its guess attempts,
// then describe that turn (bid + who's up) for the clients.
function applyTier(game: Game, round: Round): TierTurn {
  const tier = round.bidTiers[round.tierIndex];
  round.lowestBid = tier.bid;
  round.guesserSocketIds = tier.socketIds;
  round.passed = new Set();
  round.earlyGuessers = new Set();
  // Cleared here (not just at round creation) so a later tier never inherits
  // an earlier tier's start time if this one's own song_started is delayed.
  round.tierStartAt = null;
  game.phase = 'playing';
  const guesserNames = tier.socketIds
    .map(id => game.players.get(id)?.name ?? '')
    .filter(Boolean);
  return { lowestBid: tier.bid, guesserSocketIds: tier.socketIds, guesserNames };
}

export function closeBetting(game: Game): TierTurn | null {
  const round = game.currentRound;
  if (!round || game.phase !== 'betting') return null;

  if (round.bids.size === 0) return null;

  const byBid = new Map<number, string[]>();
  for (const [id, bid] of round.bids.entries()) {
    const tier = byBid.get(bid);
    if (tier) tier.push(id);
    else byBid.set(bid, [id]);
  }
  round.bidTiers = Array.from(byBid.entries())
    .sort(([a], [b]) => a - b)
    .map(([bid, socketIds]) => ({ bid, socketIds }));
  round.tierIndex = 0;

  return applyTier(game, round);
}

// After a tier fails, hand off to the next-lowest bidders. Returns null when no
// tier is left (nobody got it) or the song's already been answered.
export function advanceTier(game: Game): TierTurn | null {
  const round = game.currentRound;
  if (!round || round.answered) return null;
  if (round.tierIndex + 1 >= round.bidTiers.length) return null;
  round.tierIndex += 1;
  return applyTier(game, round);
}

// A streak only continues for players who actually score points this round —
// anyone who wasn't reached (a later tier that never got a turn, a disconnect
// mid-round) or scored nothing has theirs cleared once the round is decided.
export function settleStreaks(game: Game, round: Round): void {
  for (const [id, player] of game.players) {
    if (!round.scoredSocketIds.has(id)) player.streak = 0;
  }
}

// One guess per guesser: a correct guess wins, a wrong guess ends that
// guesser's turn. `allDone` is true once every guesser in the tier has had
// their shot (guessed or passed), so the round can move on.
export function recordGuess(
  game: Game,
  socketId: string,
  text: string,
  artistText?: string,
): { correct: boolean; points: number; guesserName: string; allDone: boolean } | null {
  const round = game.currentRound;
  if (!round) return null;
  if (!round.guesserSocketIds.includes(socketId)) return null;
  if (game.phase === 'playing') {
    round.earlyGuessers.add(socketId);
  } else if (game.phase !== 'guessing') {
    return null;
  }
  if (round.answered || round.passed.has(socketId)) return null;

  round.guesses.set(socketId, text);
  const target = effectiveTarget(round);
  const trimmedArtist = artistText?.trim();
  if (target === 'both' && trimmedArtist) round.artistGuesses.set(socketId, trimmedArtist);
  const guesserName = game.players.get(socketId)?.name ?? '';

  const elapsedMs = Date.now() - (round.tierStartAt ?? Date.now());

  if (target === 'year') {
    const guess = parseYearGuess(text);
    const correct = guess !== null && guess === Math.floor(round.song.year ?? 0);
    if (!correct) return failGuess(round, socketId, guesserName);
    const parts: PointsBreakdownPart[] = [
      { label: 'Base', amount: 500 },
      { label: 'Bid bonus', amount: bidScore(round.lowestBid) },
      { label: 'Difficulty', amount: difficultyBonus(game, round.song.rank) },
    ];
    const mult = roundMultiplier(round);
    const pity = pityBonus(currentScores(game), socketId, round);
    const breakdown = buildBreakdown(parts, mult, pity);
    round.pointsBreakdown.set(socketId, breakdown);
    const points = breakdown.total;
    const result = applyClassicWin(game, round, socketId, guesserName, points, elapsedMs);
    // The year reveal UI reads exclusively from `yearResults` (never from
    // correct/guesserName/points), so an early exact-match win still needs a
    // results table — everyone else's guess is shown for context, but only
    // the winner scores.
    finalizeClassicYearWin(game, round, socketId, points);
    return result;
  }

  const { correct, artistBonus } = checkGuess(target, text, artistText, round.song);
  if (!correct) return failGuess(round, socketId, guesserName);

  const basePoints = calcPoints(game, round.lowestBid, round.song.rank);
  const parts: PointsBreakdownPart[] = [
    { label: 'Base', amount: 500 },
    { label: 'Bid bonus', amount: bidScore(round.lowestBid) },
    { label: 'Difficulty', amount: difficultyBonus(game, round.song.rank) },
  ];
  if (artistBonus) parts.push({ label: 'Title + artist bonus', amount: basePoints });
  const breakdown = buildBreakdown(parts, roundMultiplier(round), pityBonus(currentScores(game), socketId, round));
  round.pointsBreakdown.set(socketId, breakdown);
  return applyClassicWin(game, round, socketId, guesserName, breakdown.total, elapsedMs);
}

// A guesser's turn ends without a win — hand them off to "passed" and report
// whether the whole tier is now done (every guesser guessed or passed).
function failGuess(
  round: Round, socketId: string, guesserName: string,
): { correct: false; points: number; guesserName: string; allDone: boolean } {
  round.passed.add(socketId);
  const allDone = round.guesserSocketIds.every(id => round.passed.has(id));
  return { correct: false, points: 0, guesserName, allDone };
}

// Shared bookkeeping for a classic-flow round-winning guess (title, artist,
// or year target): marks the round answered, pays out, extends the streak,
// arms a pending steal if this round has one, and ends the round.
function applyClassicWin(
  game: Game, round: Round, socketId: string, guesserName: string, points: number, elapsedMs: number,
): { correct: true; points: number; guesserName: string; allDone: false } {
  round.answered = true;
  round.correctGuesserName = guesserName;
  const player = game.players.get(socketId)!;
  player.score += points;
  player.streak += 1;
  player.totalCorrect += 1;
  if (points > player.biggestSwing) player.biggestSwing = points;
  round.scoredSocketIds.add(socketId);
  round.guessTimes.set(socketId, elapsedMs);
  recordFastestMoment(player, 'classic', round, elapsedMs, round.guesses.get(socketId) ?? 'Correct guess');
  if (round.party?.event === 'steal') {
    round.stealBy = socketId;
    round.stealDone = false;
  }
  // Finale classic sub-round: record who took this game of the best-of-3 —
  // separate from (and on top of) the normal points above.
  if (round.party?.finale) {
    game.duelWins[socketId] = (game.duelWins[socketId] ?? 0) + 1;
    resolveDuelIfWon(game, socketId);
  }
  game.phase = 'reveal';
  settleStreaks(game, round);
  return { correct: true, points, guesserName, allDone: false };
}

function recordFastestMoment(
  player: Player, flow: 'classic' | 'race', round: Round, elapsedMs: number, guess: string,
): void {
  const timeKey = flow === 'classic' ? 'fastestClassicMs' : 'fastestCorrectMs';
  const momentKey = flow === 'classic' ? 'fastestClassicMoment' : 'fastestCorrectMoment';
  const current = player[timeKey];
  if (current !== null && elapsedMs > current) return;

  player[timeKey] = elapsedMs;
  const moment: AwardMoment = {
    playerName: player.name,
    guess,
    songTitle: round.song.title,
    artist: round.song.artist,
    coverUrl: round.coverUrl ?? round.song.albumArtUrl ?? undefined,
    timeMs: elapsedMs,
  };
  player[momentKey] = moment;
}

// A guesser forfeits their turn without guessing. Once every guesser in the
// tier is done, the round moves on (to the next tier or the reveal).
export function skipGuess(game: Game, socketId: string): { allDone: boolean } | null {
  const round = game.currentRound;
  if (!round) return null;
  if (!round.guesserSocketIds.includes(socketId)) return null;
  if (game.phase !== 'guessing' && game.phase !== 'playing') return null;
  if (round.answered || round.passed.has(socketId)) return null;

  round.guesses.set(socketId, null);
  round.passed.add(socketId);
  if (game.phase === 'playing') round.earlyGuessers.add(socketId);
  const player = game.players.get(socketId);
  if (player) player.totalPasses += 1;
  const allDone = round.guesserSocketIds.every(id => round.passed.has(id));
  return { allDone };
}

export function markRaceStarted(game: Game): void {
  const round = game.currentRound;
  if (!round) return;
  round.playStartAt = Date.now();
  game.phase = 'guessing';
}

// Classic-mode counterpart to markRaceStarted: records when the current
// tier's clip actually started playing, so recordGuess can measure elapsed
// time. Guarded so a late song_started after the fallback already fired
// can't clobber the fallback's own timestamp with a later one.
export function markTierStarted(game: Game): void {
  const round = game.currentRound;
  if (round?.tierStartAt !== null) return;
  round.tierStartAt = Date.now();
}

function applyRaceCorrectGuess(
  game: Game, round: Round, socketId: string, elapsedMs: number, artistBonus: boolean, guess: string,
): number {
  const isFirst = round.firstCorrectAt === null;
  if (isFirst) round.firstCorrectAt = Date.now();
  round.correctGuessers.add(socketId);
  round.guessTimes.set(socketId, elapsedMs);
  if (!isFirst && isWinnerOnlyRound(game, round)) return 0;
  // A finale duelist can never actually reach this function as a non-first
  // guesser — recordRaceGuess already rejects any guess attempt once the
  // round's first correct answer has landed, for any finale round — so
  // `isFirst` is always true here and this scores through the normal
  // first-correct race payout, same as any other race round.
  const base = isWinnerOnlyRound(game, round)
    ? calcRaceWinnerPoints(game, elapsedMs, game.raceTime, round.song.rank)
    : calcRacePoints(game, isFirst, elapsedMs, round.firstCorrectAt! - round.playStartAt!, round.song.rank);
  const diffBonus = difficultyBonus(game, round.song.rank);
  const parts: PointsBreakdownPart[] = [
    { label: 'Speed', amount: base - diffBonus },
    { label: 'Difficulty', amount: diffBonus },
  ];
  if (artistBonus) parts.push({ label: 'Title + artist bonus', amount: base });
  const preMultiplier = parts.reduce((sum, p) => sum + p.amount, 0); // === base + (artistBonus ? base : 0)
  const mult = roundMultiplier(round);
  let points = Math.round(preMultiplier * mult);
  let pity = 0;
  if (points > 0) { pity = pityBonus(currentScores(game), socketId, round); points += pity; }
  round.pointsBreakdown.set(socketId, buildBreakdown(parts, mult, pity));
  if (isFirst && round.party?.event === 'steal') {
    round.stealBy = socketId;
    round.stealDone = false;
  }
  applyRaceScoreToPlayer(game, round, socketId, elapsedMs, points, guess);
  recordFinaleRaceWin(game, round, socketId, isFirst);
  // The mystery multiplier stays hidden until everyone sees the shared
  // reveal, so the guesser's own immediate ack can't carry the true
  // (multiplied) total — that would let them back out ×2 vs ×10 right away.
  // Hand back the pre-multiplier amount instead; the real score still lands
  // via player.score, and score_update carries the true delta at reveal.
  return round.party?.event === 'mystery' ? preMultiplier : points;
}

function applyRaceScoreToPlayer(
  game: Game, round: Round, socketId: string, elapsedMs: number, points: number, guess: string,
): void {
  const player = game.players.get(socketId)!;
  player.score += points;
  if (points > 0) {
    player.streak += 1;
    player.totalCorrect += 1;
    if (points > player.biggestSwing) player.biggestSwing = points;
    recordFastestMoment(player, 'race', round, elapsedMs, guess);
    round.scoredSocketIds.add(socketId);
  }
}

function recordFinaleRaceWin(game: Game, round: Round, socketId: string, isFirst: boolean): void {
  // Finale race sub-round: record who took this game of the best-of-3 —
  // separate from (and on top of) the normal points above.
  if (isFirst && round.party?.finale) {
    game.duelWins[socketId] = (game.duelWins[socketId] ?? 0) + 1;
    resolveDuelIfWon(game, socketId);
  }
}

export function recordRaceGuess(
  game: Game,
  socketId: string,
  text: string,
  artistText?: string,
): { correct: boolean; points: number; elapsedMs: number; allDone: boolean } | null {
  const round = game.currentRound;
  if (!round) return null;
  if (!game.players.has(socketId)) return null;
  if (game.phase !== 'guessing') return null;
  if (round.passed.has(socketId)) return null;
  const restricted = restrictedParticipantIds(round);
  if (restricted && !restricted.includes(socketId)) return null;
  if ((isWinnerOnlyRound(game, round) || round.party?.finale) && round.firstCorrectAt !== null) return null;

  const elapsedMs = Date.now() - (round.playStartAt ?? Date.now());
  round.guesses.set(socketId, text);
  round.passed.add(socketId);
  const participants = raceParticipants(game, round);

  const target = effectiveTarget(round);
  if (target === 'year') {
    // Year answers are only scored once the round ends and every distance is
    // known — see finalizeYearRound.
    const allDone = participants.every(id => round.passed.has(id));
    return { correct: false, points: 0, elapsedMs, allDone };
  }

  const { correct, artistBonus } = checkGuess(target, text, artistText, round.song);
  const trimmedArtist = artistText?.trim();
  if (target === 'both' && trimmedArtist) round.artistGuesses.set(socketId, trimmedArtist);
  const points = correct ? applyRaceCorrectGuess(game, round, socketId, elapsedMs, artistBonus, text) : 0;

  const allDone = ((isWinnerOnlyRound(game, round) || round.party?.finale === true) && correct)
    || participants.every(id => round.passed.has(id));
  return { correct, points, elapsedMs, allDone };
}

export function skipRaceGuess(
  game: Game,
  socketId: string,
): { allDone: boolean } | null {
  const round = game.currentRound;
  if (!round) return null;
  if (!game.players.has(socketId)) return null;
  if (game.phase !== 'guessing') return null;
  if (round.passed.has(socketId)) return null;
  const restricted = restrictedParticipantIds(round);
  if (restricted && !restricted.includes(socketId)) return null;

  round.guesses.set(socketId, null);
  round.passed.add(socketId);
  game.players.get(socketId)!.totalPasses += 1;
  const allDone = raceParticipants(game, round).every(id => round.passed.has(id));
  return { allDone };
}

// Mirrors applyRaceCorrectGuess's decay-scoring math, but correctness is
// "did you tap the fabricated hint" rather than a fuzzy text match. A round
// only ever has one active event, so this never needs to combine with
// mystery's hide-until-reveal return trick — moot by construction.
function applyChaosHintTap(
  game: Game, round: Round, socketId: string, tappedIndex: number, elapsedMs: number,
): number {
  const isCorrect = tappedIndex === round.chaosFakeIndex;
  const isFirst = round.firstCorrectAt === null;
  if (isCorrect) {
    if (isFirst) round.firstCorrectAt = Date.now();
    round.correctGuessers.add(socketId);
    round.guessTimes.set(socketId, elapsedMs);
  }
  if (!isCorrect || (!isFirst && isWinnerOnlyRound(game, round))) return 0;
  const base = isWinnerOnlyRound(game, round)
    ? calcRaceWinnerPoints(game, elapsedMs, game.raceTime, round.song.rank)
    : calcRacePoints(game, isFirst, elapsedMs, round.firstCorrectAt! - round.playStartAt!, round.song.rank);
  const diffBonus = difficultyBonus(game, round.song.rank);
  const parts: PointsBreakdownPart[] = [
    { label: 'Speed', amount: base - diffBonus },
    { label: 'Difficulty', amount: diffBonus },
  ];
  const mult = roundMultiplier(round);
  let points = Math.round(base * mult);
  let pity = 0;
  if (points > 0) { pity = pityBonus(currentScores(game), socketId, round); points += pity; }
  round.pointsBreakdown.set(socketId, buildBreakdown(parts, mult, pity));
  const player = game.players.get(socketId)!;
  player.score += points;
  if (points > 0) {
    player.streak += 1;
    player.totalCorrect += 1;
    if (points > player.biggestSwing) player.biggestSwing = points;
    recordFastestMoment(player, 'race', round, elapsedMs, 'Found the fake hint');
    round.scoredSocketIds.add(socketId);
  }
  recordFinaleRaceWin(game, round, socketId, isFirst);
  return points;
}

export function recordChaosHintTap(
  game: Game, socketId: string, tappedIndex: number,
): { correct: boolean; points: number; elapsedMs: number; allDone: boolean } | null {
  const round = game.currentRound;
  if (!round || round.party?.event !== 'chaoshints') return null;
  if (!game.players.has(socketId)) return null;
  if (game.phase !== 'guessing') return null;
  if (round.passed.has(socketId)) return null;
  const restricted = restrictedParticipantIds(round);
  if (restricted && !restricted.includes(socketId)) return null;
  if ((isWinnerOnlyRound(game, round) || round.party?.finale) && round.firstCorrectAt !== null) return null;

  const elapsedMs = Date.now() - (round.playStartAt ?? Date.now());
  round.chaosTapped.set(socketId, tappedIndex);
  round.passed.add(socketId);
  const participants = raceParticipants(game, round);

  const correct = tappedIndex === round.chaosFakeIndex;
  const points = applyChaosHintTap(game, round, socketId, tappedIndex, elapsedMs);

  const allDone = ((isWinnerOnlyRound(game, round) || round.party?.finale === true) && correct)
    || participants.every(id => round.passed.has(id));
  return { correct, points, elapsedMs, allDone };
}

// ─── Year rounds ─────────────────────────────────────────────────────────────

// Parses a year guess (digits only, plausible range) or null if unusable.
function parseYearGuess(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw.replace(/\D/g, ''), 10);
  return Number.isFinite(parsed) && parsed >= 1000 && parsed <= 3000 ? parsed : null;
}

function yearGuessEntries(game: Game, round: Round, actual: number) {
  return Array.from(game.players.entries()).map(([id, player]) => {
    const guess = parseYearGuess(round.guesses.get(id));
    return { id, player, guess, diff: guess === null ? null : Math.abs(guess - actual) };
  });
}

// Shared "closest guess wins" scorer: exact answers pay the most, points fall
// off per year of distance, and the closest player(s) take a winner bonus on
// top. `winnerOnly` restricts scoring to just that closest guess — everyone
// else gets zero, same as winner-only does for title races.
function scoreYearGuesses(game: Game, round: Round, mult: number, winnerOnly: boolean): YearResult[] {
  const actual = Math.floor(round.song.year ?? 0);
  const preRoundScores = currentScores(game);

  const entries = yearGuessEntries(game, round, actual);
  const diffs = entries.filter(e => e.diff !== null).map(e => e.diff!);
  const best = diffs.length > 0 ? Math.min(...diffs) : null;
  const winners = best === null ? 0 : entries.filter(e => e.diff === best).length;

  const results: YearResult[] = entries.map(e => {
    let points = 0;
    let breakdown: PointsBreakdown | undefined;
    if (e.diff !== null && (!winnerOnly || e.diff === best)) {
      const parts: PointsBreakdownPart[] = [
        { label: 'Accuracy', amount: Math.max(0, YEAR_MAX_POINTS - YEAR_POINTS_SLOPE * e.diff) },
      ];
      if (e.diff === best) parts.push({ label: 'Closest guess bonus', amount: Math.round(YEAR_WINNER_BONUS / winners) });
      const preMultiplier = parts.reduce((sum, p) => sum + p.amount, 0);
      points = Math.round(preMultiplier * mult);
      let pity = 0;
      if (points > 0) { pity = pityBonus(preRoundScores, e.id, round); points += pity; }
      breakdown = buildBreakdown(parts, mult, pity);
      round.pointsBreakdown.set(e.id, breakdown);
    }
    if (points > 0) {
      e.player.score += points;
      e.player.streak += 1;
      e.player.totalCorrect += 1;
      if (points > e.player.biggestSwing) e.player.biggestSwing = points;
      round.scoredSocketIds.add(e.id);
    }
    const pity = round.pityAwardedTo.has(e.id);
    return { name: e.player.name, guess: e.guess, diff: e.diff, points, pity, pityAmount: pity ? PITY_BONUS : undefined, breakdown };
  });

  results.sort((a, b) => (a.diff ?? 9999) - (b.diff ?? 9999));
  round.yearResults = results;
  return round.yearResults;
}

// Race-flow year rounds are scored in one pass at the end, once every
// distance is known.
export function finalizeYearRound(game: Game): YearResult[] {
  const round = game.currentRound!;
  const results = scoreYearGuesses(game, round, roundMultiplier(round), isWinnerOnlyRound(game, round));
  if (round.party?.finale) recordDuelYearWin(game, round);
  return results;
}

// Finale year sub-round (the decider): whoever's strictly closest takes this
// game of the best-of-3. An exact tie between the two duelists — or neither
// answering at all — resolves nothing here; advanceDuelOrResolve will notice
// neither reached 2 wins and call for another year sub-round instead of
// ending the duel.
function recordDuelYearWin(game: Game, round: Round): void {
  const actual = Math.floor(round.song.year ?? 0);
  const duelistIds = round.party!.duelistIds;
  const entries = yearGuessEntries(game, round, actual)
    .filter(e => duelistIds.includes(e.id) && e.diff !== null);
  if (entries.length === 0) return;
  const best = Math.min(...entries.map(e => e.diff!));
  const winners = entries.filter(e => e.diff === best);
  if (winners.length === 1) {
    game.duelWins[winners[0].id] = (game.duelWins[winners[0].id] ?? 0) + 1;
    resolveDuelIfWon(game, winners[0].id);
  }
}

// Classic-flow year round that ended early on an exact guess — scored like
// any other classic round (bid + rank), not the distance formula above. The
// year reveal UI reads only `yearResults`, so this still builds one: every
// other player's guess is shown for context on the timeline, but only the
// winner scores.
function finalizeClassicYearWin(game: Game, round: Round, winnerId: string, winnerPoints: number): YearResult[] {
  const actual = Math.floor(round.song.year ?? 0);
  const entries = yearGuessEntries(game, round, actual);
  const results: YearResult[] = entries.map(e => {
    const pity = e.id === winnerId && round.pityAwardedTo.has(winnerId);
    return {
      name: e.player.name, guess: e.guess, diff: e.diff,
      points: e.id === winnerId ? winnerPoints : 0,
      pity, pityAmount: pity ? PITY_BONUS : undefined,
      breakdown: e.id === winnerId ? round.pointsBreakdown.get(winnerId) : undefined,
    };
  });
  results.sort((a, b) => (a.diff ?? 9999) - (b.diff ?? 9999));
  round.yearResults = results;
  return round.yearResults;
}

// Classic-flow year round where every tier had its turn and nobody guessed
// exactly right — falls back to closest-guess-wins across everyone who did
// guess. Classic has no "winner only" toggle and no party multiplier.
export function finalizeClassicYearRound(game: Game): YearResult[] {
  const round = game.currentRound!;
  return scoreYearGuesses(game, round, 1, false);
}

// ─── Steal round ─────────────────────────────────────────────────────────────

export function stealCandidates(game: Game, thiefId: string): { name: string; score: number }[] {
  return Array.from(game.players.values())
    .filter(p => p.socketId !== thiefId)
    .sort((a, b) => b.score - a.score)
    .map(p => ({ name: p.name, score: p.score }));
}

export function executeSteal(
  game: Game, thiefId: string, victimName: string,
): { thief: string; victim: string; amount: number } | null {
  const round = game.currentRound;
  if (!round || game.phase !== 'reveal') return null;
  if (round.stealBy !== thiefId || round.stealDone) return null;
  const thief = game.players.get(thiefId);
  const victim = Array.from(game.players.values()).find(p => p.name === victimName);
  if (!thief || !victim || victim.socketId === thiefId) return null;

  const amount = Math.min(victim.score, Math.max(STEAL_MIN, Math.round(victim.score * STEAL_PCT)));
  round.stealDone = true;
  victim.score -= amount;
  thief.score += amount;
  return { thief: thief.name, victim: victim.name, amount };
}

// Thief declines to steal from anyone. Marks the steal resolved (so
// stealPendingName stops reporting them as still deciding) without moving points.
export function skipSteal(game: Game, thiefId: string): { thief: string } | null {
  const round = game.currentRound;
  if (!round || game.phase !== 'reveal') return null;
  if (round.stealBy !== thiefId || round.stealDone) return null;
  const thief = game.players.get(thiefId);
  if (!thief) return null;
  round.stealDone = true;
  return { thief: thief.name };
}

// ─── Draft auto-submission ───────────────────────────────────────────────────

// A race round can end (timeout, or someone winning in winner-only mode)
// while other players are still mid-guess. Their own client tries to
// auto-submit at the same deadline the server uses to end the round, but
// that's a race against the network — the server's own end-of-round broadcast
// almost always arrives first and discards whatever they'd typed. Score their
// last-known draft here instead, server-side, so a timely answer still counts.
export function finalizeRaceDrafts(game: Game): void {
  const round = game.currentRound;
  if (!round || game.phase !== 'guessing') return;
  // Chaos Hints is tap-only — there's no free-text draft to auto-submit.
  if (round.party?.event === 'chaoshints') return;
  for (const id of game.players.keys()) {
    if (round.passed.has(id)) continue;
    const draft = round.liveDrafts.get(id)?.trim();
    if (draft) recordRaceGuess(game, id, draft, round.liveArtistDrafts.get(id)?.trim());
  }
}

// Same idea as finalizeRaceDrafts, but for the classic bid/tier flow: a
// tier's guessing timer expiring used to just advance to the next tier
// (or reveal) without ever looking at what the current guessers had typed,
// so a slow/backgrounded client whose own auto-submit timer missed the
// deadline just lost their answer. Auto-submits the first correct draft
// found (in tier order) so it scores exactly like a real submission would.
export function finalizeGuessDrafts(
  game: Game,
): { correct: true; points: number; guesserName: string; allDone: boolean } | null {
  const round = game.currentRound;
  if (!round || game.phase !== 'guessing' || round.answered) return null;
  for (const id of round.guesserSocketIds) {
    if (round.passed.has(id)) continue;
    const draft = round.liveDrafts.get(id)?.trim();
    if (!draft) continue;
    const result = recordGuess(game, id, draft, round.liveArtistDrafts.get(id)?.trim());
    if (result?.correct) return result as { correct: true; points: number; guesserName: string; allDone: boolean };
  }
  return null;
}

// Called on every keystroke so an opponent's in-progress guess survives even
// if the round ends (someone else wins) before they get a chance to submit.
export function updateLiveDraft(game: Game, socketId: string, text: string, artistText?: string): void {
  const round = game.currentRound;
  if (!round) return;
  if (!isRaceFlowRound(game, round) && !round.guesserSocketIds.includes(socketId)) return;
  if (game.phase !== 'guessing' && game.phase !== 'playing') return;
  if (round.passed.has(socketId)) return;
  round.liveDrafts.set(socketId, text);
  if (artistText !== undefined) round.liveArtistDrafts.set(socketId, artistText);
}

// ─── Reveal & results ────────────────────────────────────────────────────────

type RoundGuess = { name: string; guess: string | null; timeMs: number | null; live?: boolean; artistGuess?: string | null; artistCorrect?: boolean };

function artistGuessCorrect(artistGuess: string | null, round: Round): boolean | undefined {
  return artistGuess ? isCorrectArtistGuess(artistGuess, round.song.artist, round.song.featuredArtists) : undefined;
}

// Artist-guess correctness is computed independently of the title guess and
// scoring: `checkGuess`'s artistBonus is gated on the title also being right
// (it only exists to double the score), so it can't be reused here — a
// player can have the right artist and the wrong title, and the reveal still
// needs to show that artist guess as correct.
function getPlayerRoundGuess(id: string, name: string, round: Round): RoundGuess | null {
  // Chaos Hints never touches round.guesses — taps live in their own map
  // (recordChaosHintTap) — so without this branch the reveal screen shows
  // every chaos player as having not answered at all.
  if (round.party?.event === 'chaoshints' && round.chaosTapped.has(id)) {
    const tappedIndex = round.chaosTapped.get(id)!;
    return {
      name,
      guess: round.hints[tappedIndex]?.label ?? null,
      timeMs: round.guessTimes.get(id) ?? null,
    };
  }
  if (round.guesses.has(id)) {
    const artistGuess = round.artistGuesses.get(id) ?? null;
    return {
      name,
      guess: round.guesses.get(id) ?? null,
      timeMs: round.guessTimes.get(id) ?? null,
      artistGuess,
      artistCorrect: artistGuessCorrect(artistGuess, round),
    };
  }
  const draft = round.liveDrafts.get(id)?.trim();
  if (!draft) return null;
  const artistGuess = round.liveArtistDrafts.get(id)?.trim() || null;
  return {
    name, guess: draft, timeMs: null, live: true,
    artistGuess,
    artistCorrect: artistGuessCorrect(artistGuess, round),
  };
}

export function getRoundGuesses(game: Game): RoundGuess[] {
  const round = game.currentRound;
  if (!round) return [];
  const results: RoundGuess[] = [];
  for (const [id, player] of game.players) {
    if (!player.name) continue;
    const entry = getPlayerRoundGuess(id, player.name, round);
    if (entry) results.push(entry);
  }
  return results;
}

// Applies the flat DUEL_BONUS and crowns Duel Champion the instant a
// duelist's win count reaches 2 — called right where duelWins is
// incremented (applyClassicWin, applyRaceCorrectGuess, recordDuelYearWin),
// not lazily at the next "next round" click, so the reveal screen for the
// deciding sub-round already shows the true final score instead of jumping
// again once the host continues.
function resolveDuelIfWon(game: Game, socketId: string): void {
  if ((game.duelWins[socketId] ?? 0) < 2) return;
  game.duelChampion = socketId;
  const winner = game.players.get(socketId);
  if (winner) winner.score += DUEL_BONUS;
  game.duelActive = false;
}

// Called from the host's "next round" action while a finale duel is active.
// Returns true if the duel should continue (the caller then starts the next
// sub-round instead of advancing roundIndex/ending the game); false once
// it's resolved (resolveDuelIfWon already flipped duelActive off), in which
// case the caller falls through to the normal end-of-game flow exactly as if
// this were an ordinary last round.
export function advanceDuelOrResolve(game: Game): boolean {
  if (!game.duelActive) return false;
  game.duelSubRoundIndex += 1;
  return true;
}

// Active players plus anyone who left for good and never came back — a
// player who was leading (or fastest, or whatever else awards track) doesn't
// just vanish off the board because their connection dropped. Skips a
// formerPlayers entry if someone's currently playing under that same name
// (they already rejoined, so game.players has the live, current-name copy).
function playersIncludingFormer(game: Game): Player[] {
  const active = Array.from(game.players.values());
  const activeNames = new Set(active.map(p => p.name.toLowerCase()));
  const departed: Player[] = Array.from(game.formerPlayers.entries())
    .filter(([lowerName]) => !activeNames.has(lowerName))
    .map(([lowerName, former]) => ({ socketId: `former:${lowerName}`, ...former }));
  return [...active, ...departed];
}

export function getLeaderboard(game: Game) {
  return playersIncludingFormer(game)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
}

function mostCorrectAward(players: Player[]): Award | null {
  const mostCorrect = Math.max(0, ...players.map(p => p.totalCorrect));
  if (mostCorrect <= 0) return null;
  return {
    key: 'mostCorrect',
    playerNames: players.filter(p => p.totalCorrect === mostCorrect).map(p => p.name),
    detail: `${mostCorrect} correct guess${mostCorrect === 1 ? '' : 'es'}`,
  };
}

function fastestGuessAward(players: Player[]): Award | null {
  const timed = players.filter(p => p.fastestCorrectMs !== null);
  if (timed.length === 0) return null;
  const fastestMs = Math.min(...timed.map(p => p.fastestCorrectMs!));
  const winners = timed.filter(p => p.fastestCorrectMs === fastestMs);
  return {
    key: 'fastestGuess',
    playerNames: winners.map(p => p.name),
    detail: `${(fastestMs / 1000).toFixed(1)}s`,
    highlights: winners.flatMap(p => p.fastestCorrectMoment ? [p.fastestCorrectMoment] : []),
  };
}

// Separate award, not merged with fastestGuessAward: classic's per-tier
// timing isn't on the same scale as race's shared-clip-start timing, so
// comparing them directly would be misleading.
function fastestClassicGuessAward(players: Player[]): Award | null {
  const timedClassic = players.filter(p => p.fastestClassicMs !== null);
  if (timedClassic.length === 0) return null;
  const fastestClassicMs = Math.min(...timedClassic.map(p => p.fastestClassicMs!));
  const winners = timedClassic.filter(p => p.fastestClassicMs === fastestClassicMs);
  return {
    key: 'fastestClassicGuess',
    playerNames: winners.map(p => p.name),
    detail: `${(fastestClassicMs / 1000).toFixed(1)}s`,
    highlights: winners.flatMap(p => p.fastestClassicMoment ? [p.fastestClassicMoment] : []),
  };
}

function biggestSwingAward(players: Player[]): Award | null {
  const biggestSwing = Math.max(0, ...players.map(p => p.biggestSwing));
  if (biggestSwing <= 0) return null;
  return {
    key: 'biggestSwing',
    playerNames: players.filter(p => p.biggestSwing === biggestSwing).map(p => p.name),
    detail: `+${biggestSwing.toLocaleString()} in one round`,
  };
}

function finaleWinnerAward(game: Game): Award | null {
  if (!game.duelChampion) return null;
  const champ = game.players.get(game.duelChampion);
  if (!champ) return null;
  const opponentId = game.duelDuelistIds.find(id => id !== game.duelChampion);
  const opponent = opponentId ? game.players.get(opponentId) : undefined;
  const champWins = game.duelWins[game.duelChampion] ?? 2;
  const opponentWins = opponentId ? game.duelWins[opponentId] ?? 0 : 0;
  return {
    key: 'finaleWinner',
    playerNames: [champ.name],
    detail: opponent
      ? `Beat ${opponent.name} ${champWins}\u2013${opponentWins} in the finale duel`
      : 'Won the finale duel',
  };
}

// End-of-game superlatives, computed once the game's over. Ties share the
// award rather than picking one name arbitrarily. A stat of zero doesn't
// count as an achievement, so an award is omitted entirely if nobody
// actually did the thing (e.g. nobody ever guessed correctly).
export function computeAwards(game: Game): Award[] {
  const players = playersIncludingFormer(game);
  const awards = [
    mostCorrectAward(players),
    fastestGuessAward(players),
    fastestClassicGuessAward(players),
    biggestSwingAward(players),
    finaleWinnerAward(game),
  ];
  return awards.filter((a): a is Award => a !== null);
}

export function updateSocketPin(socketId: string, pin: string) {
  socketToPin.set(socketId, pin);
}

export function cleanupGame(pin: string) {
  const game = games.get(pin);
  if (!game) return;
  if (game.phaseTimer) clearTimeout(game.phaseTimer);
  for (const id of game.players.keys()) socketToPin.delete(id);
  socketToPin.delete(game.hostSocketId);
  games.delete(pin);
}
