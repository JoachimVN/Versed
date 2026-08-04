import { randomInt } from 'node:crypto';
import {
  Game, PartyClientView, PartyConfig, PartyEvent, PartyFormat, PartyRoundType, PartyTarget, Round,
} from './types';
import { DUEL_BONUS } from './constants';
import { pickWeighted } from './random';

// Party mode's round recipes: the format/target/event draw that decides what a
// round actually is, the announcement copy for it, and the round-shape queries
// (winner-only, multiplier, who's allowed to play) that the rest of the game
// asks about a built config.

// ─── Round intros ────────────────────────────────────────────────────────────

const PARTY_EVENT_INTROS: Record<PartyEvent, { title: string; tag: string }> = {
  double: { title: 'Double Points', tag: 'Everything is worth 2×' },
  mystery: { title: 'Mystery Multiplier', tag: 'Revealed after the round: ×1.5 up to ×10' },
  steal: { title: 'Steal Round', tag: 'Win the round, then rob another player' },
  snippet: { title: 'Snippet Roulette', tag: 'The clip starts somewhere mid-song' },
  fullhints: { title: 'Open Book', tag: 'Every hint on the table' },
  blind: { title: 'Blind Bet', tag: 'No hints at all — bid on ears alone' },
  outro: { title: 'Down to the Wire', tag: "The clip plays the song's final stretch" },
  underdog: { title: 'Underdog Boost', tag: 'Only the player(s) in last place can answer — hints on, ×1.5 points' },
  chaoshints: { title: 'Chaos Hints', tag: 'One hint is a lie — tap the fake one, fastest wins' },
};

function yearIntro(winnerOnly: boolean): { title: string; tagline: string } {
  return {
    title: 'Guess the Year',
    tagline: winnerOnly
      ? 'Only the closest guess scores — everyone else gets zero'
      : 'Closest answer wins the round',
  };
}

function flowFor(format: PartyFormat, target: PartyTarget): string {
  if (format === 'classic') return 'Bid & guess';
  if (format === 'choice') {
    if (target === 'year') return 'Tap the right year';
    if (target === 'artist') return 'Tap the right artist';
    return 'Tap the right title';
  }
  return 'Everyone races';
}

function goalFor(target: PartyTarget): string {
  if (target === 'artist') return 'name the artist';
  if (target === 'both') return 'title + artist bonus';
  if (target === 'year') return 'pick the release year';
  return 'name the song';
}

// Chaos Hints replaces the round's whole objective (spot the fake hint, not
// name the song), so it skips the normal flow/goal composition — otherwise
// the tagline would misleadingly still say "name the song".
function eventIntro(
  event: PartyEvent | null, flow: string, goal: string, suffix: string,
): { title: string; tagline: string } | undefined {
  if (!event) return undefined;
  if (event === 'chaoshints') {
    return { title: PARTY_EVENT_INTROS.chaoshints.title, tagline: PARTY_EVENT_INTROS.chaoshints.tag };
  }
  const e = PARTY_EVENT_INTROS[event];
  return { title: e.title, tagline: `${e.tag} · ${flow} / ${goal}${suffix}` };
}

function targetIntro(
  format: PartyFormat, target: PartyTarget, flow: string, suffix: string, winnerOnly: boolean,
): { title: string; tagline: string } {
  if (format === 'choice') return { title: 'Multiple Choice', tagline: `${flow}, fastest wins${suffix}` };
  if (target === 'artist') return { title: 'Who Sings It?', tagline: `${flow} / name the artist${suffix}` };
  if (target === 'both') return { title: 'Double Duty', tagline: `${flow} / name the artist too to double your points${suffix}` };
  if (format === 'race' && winnerOnly) {
    return { title: 'Winner Takes All', tagline: 'Everyone guesses at once / only the first correct answer scores' };
  }
  return format === 'race'
    ? { title: 'Race Round', tagline: 'Everyone guesses at once / speed wins' }
    : { title: 'Classic Round', tagline: 'Bid low, score high' };
}

export function introFor(
  format: PartyFormat, target: PartyTarget, event: PartyEvent | null, winnerOnly = false,
): { title: string; tagline: string } {
  if (format === 'year') return yearIntro(winnerOnly);
  const flow = flowFor(format, target);
  const goal = goalFor(target);
  const suffix = winnerOnly ? ' / winner takes all' : '';
  return eventIntro(event, flow, goal, suffix) ?? targetIntro(format, target, flow, suffix, winnerOnly);
}

// ─── Recipe draws ────────────────────────────────────────────────────────────

// Title is the baseline target whenever the host has selected a format, or
// has not selected a target variant at all. When the only choices are target
// variants such as Double Duty, though, honour that narrow selection instead
// of silently mixing plain title rounds back in.
function pickPartyTarget(game: Game, format: PartyFormat): PartyTarget {
  if (format === 'year') return 'year';
  const hasFormat = game.enabledRoundTypes.has('classic')
    || game.enabledRoundTypes.has('race')
    || game.enabledRoundTypes.has('choice')
    || game.enabledRoundTypes.has('year');
  const hasTargetVariant = game.enabledRoundTypes.has('artist') || game.enabledRoundTypes.has('both');
  const pool: [PartyTarget, number][] = [];
  if (hasFormat || !hasTargetVariant) pool.push(['title', 60]);
  if (game.enabledRoundTypes.has('artist')) pool.push(['artist', 25]);
  if (format === 'choice' && game.enabledRoundTypes.has('year')) pool.push(['year', 15]);
  // Double Duty has no slot in a tap-to-answer UI, so it can't combine with
  // Multiple Choice — pickPartyTarget only ever gets called with a 'both'
  // possibility outside format === 'choice'.
  if (format !== 'choice' && game.enabledRoundTypes.has('both')) pool.push(['both', 15]);
  return pickWeighted(pool);
}

// Every party event that exists — the default "everything on" set for a new
// game, and what host-supplied enabledEvents lists get validated against.
export const ALL_PARTY_EVENTS: PartyEvent[] = [
  'double', 'mystery', 'steal', 'snippet', 'fullhints', 'blind', 'outro', 'underdog', 'chaoshints',
];

// Every party round-type variant that exists — same "default everything on,
// validate host-supplied lists against this" role as ALL_PARTY_EVENTS, but
// for the format/target/winnerOnly pool instead of event modifiers.
export const ALL_PARTY_ROUND_TYPES: PartyRoundType[] = ['classic', 'race', 'choice', 'artist', 'both', 'year', 'winnerOnly'];

// Interpolate from 80% plain rounds at Chill through 60% at Balanced to 40%
// at Chaotic. Every slider position therefore affects the actual frequency.
function noEventChance(chaosLevel: number): number {
  return 80 - chaosLevel * 0.4;
}

function pickPartyEvent(game: Game, format: PartyFormat, prevEvent: PartyEvent | null | undefined): PartyEvent | null {
  if (format === 'year' || randomInt(0, 100) < noEventChance(game.chaosLevel)) return null;
  const pool: [PartyEvent, number][] = [['double', 30], ['mystery', 25], ['snippet', 25]];
  if (format === 'classic') pool.push(['fullhints', 20], ['blind', 20]);
  // Chaos Hints replaces the whole guessing objective with a tap-the-fake-
  // hint mini-game, which only makes sense riding the plain race flow — not
  // stacked on "guess the year" or the classic bid/tier flow.
  if (format === 'race') pool.push(['outro', 25], ['chaoshints', 15]);
  // Steal needs someone else to steal from — pointless (and confusing to
  // announce) in a 1-player game.
  if (game.roundIndex >= 2 && game.players.size >= 2) pool.push(['steal', 20]);
  // Underdog restricts guessing to whoever's trailing, so it needs someone
  // else to be ahead of — and it rides race/year scoring, not the classic
  // bid/tier flow (that's a deliberately different kind of "not everyone
  // gets a turn").
  if (format !== 'classic' && game.players.size >= 2) pool.push(['underdog', 20]);
  const filtered = pool.filter(([e]) => e !== prevEvent && game.enabledEvents.has(e));
  // The host disabled everything that was otherwise eligible this round —
  // fall back to a plain round rather than erroring.
  if (filtered.length === 0) return null;
  return pickWeighted(filtered);
}

// Mystery multiplier weights — fixed regardless of chaos slider position, so
// the slider only controls how often events happen, not how big they pay.
const MYSTERY_WEIGHTS: [number, number][] = [
  [1.5, 27], [2, 27], [3, 27], [4, 12], [5, 5], [10, 2],
];

function eventMultiplier(event: PartyEvent | null): number {
  if (event === 'double') return 2;
  if (event === 'mystery') return pickWeighted(MYSTERY_WEIGHTS);
  // The "boost" in Underdog Boost — a real payout bump on top of exclusive
  // access to the round, not just first dibs at the normal rate.
  if (event === 'underdog') return 1.5;
  return 1;
}

// ─── Config building ─────────────────────────────────────────────────────────

// One random recipe per round: format + guess target + modifier, with just
// enough constraints to keep it feeling curated — round 1 is a plain warm-up,
// the same event never repeats twice in a row, steal waits until scores exist,
// and the last round is a top-2 duel.
// Whoever's currently tied for the lowest score — everyone at that score, not
// just one of them, since the underdog event lets all of them race for it.
function trailingPlayers(game: Game): { ids: string[]; names: string[] } {
  const players = Array.from(game.players.values());
  const min = Math.min(...players.map(p => p.score));
  const trailing = players.filter(p => p.score === min);
  return { ids: trailing.map(p => p.socketId), names: trailing.map(p => p.name) };
}

type PlainPartyConfig = Omit<PartyConfig, 'format' | 'target' | 'event' | 'multiplier' | 'winnerOnly' | 'intro'>;

// Prefer the plainest enabled format so the warm-up stays a gentle intro
// rather than opening on Guess the Year or Multiple Choice — but still
// respect a host who's disabled Classic/Race outright.
function pickWarmupFormat(game: Game): PartyFormat {
  if (game.enabledRoundTypes.has('classic')) return 'classic';
  if (game.enabledRoundTypes.has('race')) return 'race';
  if (game.enabledRoundTypes.has('year')) return 'year';
  if (game.enabledRoundTypes.has('choice')) return 'choice';
  return 'classic';
}

function buildWarmupConfig(game: Game, plain: PlainPartyConfig): PartyConfig {
  const warmupFormat = pickWarmupFormat(game);
  const target = pickPartyTarget(game, warmupFormat);
  // The warm-up is still gentler than a normal Party intro, but it must name
  // the recipe that will actually be played. Otherwise a Double Duty warm-up
  // is announced as a plain Classic/Race round and surprises everyone once it
  // starts.
  const resolvedIntro = introFor(warmupFormat, target, null);
  return {
    ...plain, format: warmupFormat, target,
    event: null, multiplier: 1, winnerOnly: false,
    intro: { title: `Warm-Up · ${resolvedIntro.title}`, tagline: resolvedIntro.tagline },
  };
}

// Starts (or continues) the finale duel if this is the last round; returns
// null when the game isn't at its finale yet so the caller falls through to
// the normal random-round build.
function maybeBuildFinaleDuelConfig(game: Game): PartyConfig | null {
  if (!game.finaleEnabled) return null;
  const isLast = game.roundIndex === game.totalRounds - 1;
  if (!isLast || game.totalRounds <= 1 || game.players.size < 2) return null;

  if (!game.duelActive) {
    const top = Array.from(game.players.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    game.duelActive = true;
    game.duelDuelistIds = top.map(p => p.socketId);
    game.duelWins = { [top[0].socketId]: 0, [top[1].socketId]: 0 };
    game.duelSubRoundIndex = 0;
  }
  return buildDuelSubRoundConfig(game);
}

function buildRandomRoundConfig(game: Game, plain: PlainPartyConfig): PartyConfig {
  const prev = game.currentRound?.party;
  const formatPool: [PartyFormat, number][] = [];
  if (game.enabledRoundTypes.has('classic')) formatPool.push(['classic', 40]);
  if (game.enabledRoundTypes.has('race')) formatPool.push(['race', 35]);
  if (game.enabledRoundTypes.has('year')) formatPool.push(['year', 15]);
  if (game.enabledRoundTypes.has('choice')) formatPool.push(['choice', 10]);
  // The host disabled every format — fall back to a plain classic round
  // rather than handing pickWeighted an empty pool.
  if (formatPool.length === 0) formatPool.push(['classic', 1]);
  let format = pickWeighted<PartyFormat>(formatPool);
  // Avoid two Guess the Year rounds back to back — reroll among whatever
  // else the host has enabled rather than assuming 'race' is available.
  if (format === 'year' && prev?.format === 'year') {
    const nonYearPool = formatPool.filter(([f]) => f !== 'year');
    format = nonYearPool.length > 0 ? pickWeighted<PartyFormat>(nonYearPool) : 'year';
  }

  const target = pickPartyTarget(game, format);
  const event = pickPartyEvent(game, format, prev?.event);
  const multiplier = eventMultiplier(event);
  // Only race/year formats can go winner-only — classic already has its own
  // bid/tier stakes, and stacking this on top would just zero out everyone
  // but the lowest bidder.
  const winnerOnly = format !== 'classic' && game.enabledRoundTypes.has('winnerOnly') && randomInt(0, 100) < 25;

  const restricted = event === 'underdog' ? trailingPlayers(game) : { ids: [], names: [] };

  return {
    ...plain, format, target, event, multiplier, winnerOnly,
    restrictedIds: restricted.ids, restrictedNames: restricted.names,
    intro: introFor(format, target, event, winnerOnly),
  };
}

export function buildPartyConfig(game: Game): PartyConfig {
  const plain: PlainPartyConfig = {
    finale: false, duelistIds: [], duelistNames: [], restrictedIds: [], restrictedNames: [],
  };

  const duelConfig = maybeBuildFinaleDuelConfig(game);
  if (duelConfig) return duelConfig;

  if (game.roundIndex === 0) return buildWarmupConfig(game, plain);

  return buildRandomRoundConfig(game, plain);
}

// Best-of-3 finale duel: a fixed format sequence rather than the usual
// random pick — game 1 is a classic bid/tier round, game 2 a race, game 3
// (and any replay of it — see finalizeYearRound) a year decider. Each still
// rolls its own normal event/multiplier, just like a regular round.
// Deliberately ignores enabledRoundTypes: the finale is a fixed, curated
// sequence by design, not a draw from the host's round-type pool — it never
// calls pickPartyTarget and always hardcodes target: 'title'/winnerOnly:
// false below, so it plays out the same finale regardless of which round
// types the host has disabled.
const DUEL_FORMAT_SEQUENCE: PartyFormat[] = ['classic', 'race', 'year'];

function buildDuelSubRoundConfig(game: Game): PartyConfig {
  const format = DUEL_FORMAT_SEQUENCE[Math.min(game.duelSubRoundIndex, DUEL_FORMAT_SEQUENCE.length - 1)];
  const [idA, idB] = game.duelDuelistIds;
  const nameA = game.players.get(idA)?.name ?? '';
  const nameB = game.players.get(idB)?.name ?? '';
  const winsA = game.duelWins[idA] ?? 0;
  const winsB = game.duelWins[idB] ?? 0;

  const prev = game.currentRound?.party;
  const event = pickPartyEvent(game, format, prev?.event);
  const multiplier = eventMultiplier(event);

  const gameNum = game.duelSubRoundIndex + 1;
  const gameLabel = gameNum > DUEL_FORMAT_SEQUENCE.length
    ? `Decider replay ${gameNum - DUEL_FORMAT_SEQUENCE.length}`
    : `Game ${gameNum} of 3`;

  return {
    format, target: 'title', event, multiplier, winnerOnly: false,
    finale: true,
    duelistIds: [idA, idB],
    duelistNames: [nameA, nameB],
    restrictedIds: [], restrictedNames: [],
    intro: {
      title: `The Finale · ${gameLabel}`,
      tagline: `${nameA} ${winsA} – ${winsB} ${nameB} · first to 2 wins takes ${DUEL_BONUS.toLocaleString()} pts`,
    },
  };
}

// The sanitized view clients get: no socketIds, and a mystery multiplier stays
// hidden (null) until the reveal.
export function partyView(game: Game, round: Round, revealed = false): PartyClientView | undefined {
  const p = round.party;
  if (!p) return undefined;
  return {
    format: p.format,
    target: p.target,
    event: p.event,
    multiplier: p.event === 'mystery' && !revealed ? null : p.multiplier,
    winnerOnly: p.winnerOnly,
    intro: p.intro,
    finale: p.finale,
    duelists: p.duelistNames,
    restricted: p.restrictedNames,
    choiceOptions: p.choiceOptions,
    duelProgress: p.finale ? {
      subRoundIndex: game.duelSubRoundIndex,
      wins: game.duelDuelistIds.map(id => ({ name: game.players.get(id)?.name ?? '', count: game.duelWins[id] ?? 0 })),
    } : undefined,
  };
}

// ─── Round-shape queries ─────────────────────────────────────────────────────

// True when only the round's winner should score — either the game-wide race
// toggle, or this round's own party recipe called for it.
export function isWinnerOnlyRound(game: Game, round: Round): boolean {
  return game.raceWinnerOnly || round.party?.winnerOnly === true;
}

export function roundMultiplier(round: Round): number {
  return round.party?.multiplier ?? 1;
}

// Race-flow rounds are everyone-at-once; party rounds ride it for every
// non-classic format. Classic-mode "Guess the year" still rides the normal
// bid/tier flow — an exact year ends it early like any other classic round,
// otherwise the closest guess wins once every tier's had its turn (see
// `recordGuess`'s 'year' branch and `finalizeClassicYearWin`).
export function isRaceFlowRound(game: Game, round: Round): boolean {
  if (game.mode === 'race') return true;
  if (round.party) return round.party.format !== 'classic';
  return false;
}

// The current round's participant restriction, if any — the finale's
// duelists, or (e.g.) underdog's trailing player(s). Finale and a generic
// restriction never coexist (finale hardcodes its own format/scoring), but
// every gate that cares "who's allowed to guess this round" can check this
// one thing instead of re-deriving finale-vs-event logic each time.
export function restrictedParticipantIds(round: Round): string[] | null {
  if (round.party?.finale) return round.party.duelistIds;
  if (round.party?.restrictedIds?.length) return round.party.restrictedIds;
  return null;
}

// Who actually plays a race-flow round — a restricted subset (finale
// duelists, underdog trailers) if this round has one, everyone otherwise.
export function raceParticipants(game: Game, round: Round): string[] {
  const restricted = restrictedParticipantIds(round);
  if (restricted) return restricted.filter(id => game.players.has(id));
  return Array.from(game.players.keys());
}
