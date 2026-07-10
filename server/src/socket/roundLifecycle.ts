import { randomInt } from 'node:crypto';
import * as gm from '../gameManager';
import { getAlbumArtUrl } from '../albumArt';
import { Game, Round } from '../types';
import { getIo, PLAYBACK_COUNTDOWN_MS } from './context';

// Does the current round run the everyone-at-once race flow? True for race
// games and for every non-classic party round (race, year, finale).
export function raceFlow(game: Game): boolean {
  if (game.mode === 'race') return true;
  const round = game.currentRound;
  return !!round && gm.isRaceFlowRound(game, round);
}

// Offer the steal-round winner their pick of victims. Sent at the reveal so
// the theft plays out while everyone's watching the result. With only one
// player there's no one to steal from — close it out silently instead of
// showing an empty picker (and leaving stealPendingName stuck forever).
export function maybeOfferSteal(game: Game) {
  const round = game.currentRound;
  if (!round?.stealBy || round.stealDone) return;
  const victims = gm.stealCandidates(game, round.stealBy);
  if (victims.length === 0) { round.stealDone = true; return; }
  getIo().to(round.stealBy).emit('choose_steal', { victims });
}

export function stealPendingName(game: Game, round: Round): string | undefined {
  if (!round.stealBy || round.stealDone) return undefined;
  return game.players.get(round.stealBy)?.name;
}

export async function beginRound(game: Game) {
  if (!game) return;
  const round = gm.startRound(game);
  const party = gm.partyView(game, round);
  const isRaceFlow = gm.isRaceFlowRound(game, round);
  // Race flow is normally hint-free (the audio itself is the puzzle), but
  // artist-only and year-only rounds can't be inferred from audio alone —
  // this is the only way those toggles have any teeth outside Classic mode.
  // Party rounds keep the existing (hint-free) race behaviour, except:
  // Chaos Hints, where `round.hints` isn't a guessing aid at all, it's the
  // "spot the fake" set itself, which the round is meaningless without;
  // and Underdog Boost, whose whole point is giving the trailing player(s)
  // a real shot, not just the normal hint-free race odds.
  const keepHints = (!round.party && (round.target === 'artist' || round.target === 'year'))
    || round.party?.event === 'chaoshints' || round.party?.event === 'underdog';

  // Prefer the precomputed art from the CSV (Music Popularity Index resolves
  // it offline via Spotify's oEmbed endpoint) so a normal round never calls
  // the Spotify Web API at all; only fall back to the live, quota-limited
  // call for songs the pipeline hasn't covered yet.
  const coverUrl = round.song.albumArtUrl ?? await getAlbumArtUrl(round.song.spotifyTrackId);
  if (coverUrl) {
    round.coverUrl = coverUrl;
    // Classic-flow rounds have a 1-in-4 chance of a blurred-art hint;
    // 'fullhints' and Underdog Boost always get it (Underdog's whole
    // point is a real, guaranteed assist — not a coin flip), 'blind'
    // rounds never do.
    const wantArt = round.party?.event === 'underdog'
      || (!isRaceFlow && (game.mode === 'classic' || game.mode === 'party')
        && round.party?.event !== 'blind'
        && (round.party?.event === 'fullhints' || randomInt(4) === 0));
    if (wantArt) {
      // Underdog Boost's cover art is a real, guaranteed assist and is
      // always shown clear; every other art hint is a teaser that must
      // stay blurred all the way through guessing, not just betting.
      round.hints.push({ label: 'Album art', value: '', imageUrl: coverUrl, blurred: round.party?.event !== 'underdog' });
    }
  }

  if (isRaceFlow) {
    if (!keepHints) round.hints = [];
    game.phase = 'playing';
    game.phaseEndsAt = null;

    getIo().to(`player:${game.pin}`).emit('round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      mode: 'race',
      raceTime: game.raceTime,
      artistOnly: round.target === 'artist',
      yearOnly: round.target === 'year',
      choiceOptions: round.choiceOptions,
      party,
      tempo: round.song.tempo,
    });
    getIo().to(`host:${game.pin}`).emit('host_round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      mode: 'race',
      raceTime: game.raceTime,
      artistOnly: round.target === 'artist',
      yearOnly: round.target === 'year',
      choiceOptions: round.choiceOptions,
      party,
      song: {
        title: round.song.title,
        artist: round.song.artist,
        trackId: round.song.spotifyTrackId,
        tempo: round.song.tempo,
      },
    });

    getIo().to(`host:${game.pin}`).emit('play_song', {
      trackId: round.song.spotifyTrackId,
      durationMs: game.raceTime * 1000,
      countdownMs: PLAYBACK_COUNTDOWN_MS,
      positionMs: round.snippetMs,
    });

    // Fallback: if host never confirms song_started, end the round after the window.
    game.phaseTimer = setTimeout(() => {
      if (game.phase === 'playing') {
        gm.markRaceStarted(game);
        endRaceRound(game);
      }
    }, game.raceTime * 1000 + PLAYBACK_COUNTDOWN_MS + 5000);
    return;
  }

  const bettingEndsAt = Date.now() + game.bettingTime * 1000;
  game.phaseEndsAt = bettingEndsAt;

  getIo().to(`player:${game.pin}`).emit('round_start', {
    roundIndex: game.roundIndex,
    total: game.totalRounds,
    hints: round.hints,
    bettingTime: game.bettingTime,
    endsAt: bettingEndsAt,
    mode: 'classic',
    artistOnly: round.target === 'artist',
    yearOnly: round.target === 'year',
    choiceOptions: round.choiceOptions,
    party,
    // Source of truth for the client's bid picker and its score preview —
    // keeps the UI from drifting out of sync with server-side scoring.
    bidOptions: gm.BID_OPTIONS,
    bidScores: gm.bidScoreTable(),
    tempo: round.song.tempo,
  });
  getIo().to(`host:${game.pin}`).emit('host_round_start', {
    roundIndex: game.roundIndex,
    total: game.totalRounds,
    hints: round.hints,
    bettingTime: game.bettingTime,
    endsAt: bettingEndsAt,
    mode: 'classic',
    artistOnly: round.target === 'artist',
    yearOnly: round.target === 'year',
    choiceOptions: round.choiceOptions,
    party,
    song: {
      title: round.song.title,
      artist: round.song.artist,
      trackId: round.song.spotifyTrackId,
      tempo: round.song.tempo,
    },
  });

  // Extra 500ms lets last-second auto-submits from clients arrive before we close.
  game.phaseTimer = setTimeout(() => closeBettingAndPlay(game), game.bettingTime * 1000 + 500);
}

export function songFields(game: Game, round: Round) {
  return {
    songTitle: round.song.title,
    artist: round.song.artist,
    featuredArtists: round.song.featuredArtists,
    year: round.song.year,
    coverUrl: round.coverUrl,
    // round.target is this round's resolved answer (title/artist/both/year)
    // — the reveal card's "song was"/"artist was" label has to match
    // whichever one actually decided the guess, or a correct artist-only
    // guess reads as a title mismatch (and vice versa).
    artistOnly: gm.effectiveTarget(round) === 'artist',
    yearOnly: gm.effectiveTarget(round) === 'year',
    // Reveal payloads always carry the full party config (mystery revealed).
    party: gm.partyView(game, round, true),
    // 'chaoshints' rounds: which hint (already sent as `hints` at
    // round_start) was the fabricated one — hidden until now.
    chaosFakeIndex: round.chaosFakeIndex,
  };
}

export function emitScoreUpdate(game: Game) {
  const pityAwardedTo = game.currentRound?.pityAwardedTo;
  getIo().to(game.pin).emit('score_update', {
    players: Array.from(game.players.values()).map(p => {
      const pity = pityAwardedTo?.has(p.socketId) ?? false;
      return { name: p.name, score: p.score, streak: p.streak, pity, pityAmount: pity ? gm.PITY_BONUS : undefined };
    }),
  });
}

export function endRaceRound(game: Game) {
  if (game.phase === 'reveal') return; // guard against timer + allDone race
  if (game.phaseTimer) clearTimeout(game.phaseTimer);
  gm.finalizeRaceDrafts(game);
  const round = game.currentRound!;
  // Year rounds score in one pass now that every distance is known.
  if (gm.effectiveTarget(round) === 'year') gm.finalizeYearRound(game);
  game.phase = 'reveal';
  const correctNames = Array.from(round.correctGuessers)
    .map(id => game.players.get(id)?.name ?? '')
    .filter(Boolean);
  getIo().to(game.pin).emit('round_result', {
    correct: round.correctGuessers.size > 0,
    guesserName: null,
    mode: 'race',
    correctGuessers: correctNames,
    ...songFields(game, round),
    points: 0,
    playerGuesses: gm.getRoundGuesses(game),
    yearResults: round.yearResults,
    stealPending: stealPendingName(game, round),
  });
  gm.settleStreaks(game, round);
  emitScoreUpdate(game);
  maybeOfferSteal(game);
}

export function closeBettingAndPlay(game: Game) {
  if (game?.phase !== 'betting') return;
  const round = game.currentRound!;
  const result = gm.closeBetting(game);
  if (!result) {
    // Nobody bid — skip the round. Move the phase along too, or the game
    // stays in 'betting' and a stale bid could re-trigger this round.
    game.phase = 'reveal';
    game.phaseEndsAt = null;
    getIo().to(game.pin).emit('round_result', {
      correct: false,
      guesserName: null,
      ...songFields(game, round),
      points: 0,
      playerGuesses: [],
    });
    gm.settleStreaks(game, round);
    emitScoreUpdate(game);
    return;
  }
  playTier(game, result);
}

// Play the song for the current tier and queue its guessing phase. Reused both
// for the opening (lowest) tier and each next-lowest tier that gets a turn.
export function playTier(
  game: Game,
  turn: gm.TierTurn,
) {
  if (game.phaseTimer) clearTimeout(game.phaseTimer);
  const round = game.currentRound!;
  const { lowestBid, guesserNames } = turn;
  const playerBids = Array.from(round.bids.entries())
    .map(([id, bid]) => ({ name: game.players.get(id)?.name ?? '', bid }))
    .filter(b => b.name);
  getIo().to(game.pin).emit('betting_closed', { lowestBid, guesserNames, playerBids });
  const durationMs = gm.playMsFor(lowestBid);
  getIo().to(`host:${game.pin}`).emit('play_song', {
    trackId: round.song.spotifyTrackId,
    durationMs,
    countdownMs: PLAYBACK_COUNTDOWN_MS,
    positionMs: round.snippetMs,
  });

  // Fallback: start guessing if host never confirms song_started. The host
  // first runs a countdown (and buffers the track) before playback begins,
  // so allow for that plus the play duration plus slack.
  game.phaseTimer = setTimeout(() => {
    if (game.phase === 'playing') {
      gm.markTierStarted(game);
      startGuessingPhase(game);
    }
  }, durationMs + PLAYBACK_COUNTDOWN_MS + 5000);
}

// A tier ran out of guesses (all wrong, or time expired). Hand off to the
// next-lowest bidders if there are any; otherwise reveal that nobody got it
// — for a year round, that's when the closest guess across every tier wins.
export function revealRound(game: Game) {
  const round = game.currentRound!;
  if (game.phaseTimer) clearTimeout(game.phaseTimer);
  game.phase = 'reveal';
  if (gm.effectiveTarget(round) === 'year') gm.finalizeClassicYearRound(game);
  getIo().to(game.pin).emit('round_result', {
    correct: false,
    guesserName: null,
    ...songFields(game, round),
    points: 0,
    playerGuesses: gm.getRoundGuesses(game),
    yearResults: round.yearResults,
  });
  gm.settleStreaks(game, round);
  emitScoreUpdate(game);
}

export function advanceTierOrReveal(game: Game) {
  const next = gm.advanceTier(game);
  if (next) {
    playTier(game, next);
    return;
  }
  revealRound(game);
}

export function startGuessingPhase(game: Game) {
  if (game?.phase !== 'playing') return;
  const round = game.currentRound!;
  const guesserSocketIds = round.guesserSocketIds;
  const guesserNames = guesserSocketIds
    .map(id => game.players.get(id)?.name ?? '')
    .filter(Boolean);

  if (game.phaseTimer) clearTimeout(game.phaseTimer);
  game.phase = 'guessing';
  const guessingEndsAt = Date.now() + game.guessingTime * 1000;
  game.phaseEndsAt = guessingEndsAt;
  getIo().to(game.pin).emit('guessing_start', { guesserNames, timeLimit: game.guessingTime, endsAt: guessingEndsAt });
  for (const sid of guesserSocketIds) {
    // Skip players who already got their turn early — don't reset their timer
    if (!round.earlyGuessers.has(sid)) {
      getIo().to(sid).emit('your_turn', { timeLimit: game.guessingTime, endsAt: guessingEndsAt });
    }
  }

  game.phaseTimer = setTimeout(() => {
    if (game.phase !== 'guessing' || round.answered) return;
    // A guesser's own client auto-submits at this same deadline, but that's
    // a race against the network — this server timer firing first would
    // otherwise just discard whatever they'd typed. Give their live draft
    // one last look before moving the round on.
    const auto = gm.finalizeGuessDrafts(game);
    if (auto) {
      getIo().to(game.pin).emit('round_result', {
        correct: true,
        guesserName: auto.guesserName,
        ...songFields(game, round),
        points: auto.points,
        playerGuesses: gm.getRoundGuesses(game),
        yearResults: round.yearResults,
        stealPending: stealPendingName(game, round),
      });
      emitScoreUpdate(game);
      maybeOfferSteal(game);
      return;
    }
    advanceTierOrReveal(game);
  }, game.guessingTime * 1000);
}
