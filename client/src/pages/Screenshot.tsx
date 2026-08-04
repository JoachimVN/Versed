import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { PlayingView } from './host/PlayingView';
import { RevealView } from './host/RevealView';
import { LobbyView } from './host/LobbyView';
import type { HostState } from './host/useHostGame';
import { WatchingView } from './play/WatchingView';
import { GuessingView } from './play/GuessingView';
import { RevealView as PlayRevealView } from './play/RevealView';
import { WaitingAtmosphere } from './play/WaitingAtmosphere';
import { WaitingView } from './play/WaitingView';
import type { PlayState } from './play/usePlayGame';
import { RoundIntro } from '../components/RoundIntro';
import { FinalResultsView } from '../components/FinalResults';
import { FinalResultsPlayerView } from '../components/FinalResultsPlayer';
import { PillButton } from '../components/RevealShared';
import { useFinalResultsRevealSound } from '../hooks/useFinalResultsRevealSound';
import { HostScaleShell } from '../hooks/useHostScale';
import { PlayerScaleShell } from '../hooks/usePlayerScale';
import type { RoundResultEvent, LeaderboardEntry, PartyInfo, Award } from '../types';
import Home from './Home';
import { JoinView } from './play/JoinView';

// ─── Fixture data ─────────────────────────────────────────────────────────────

const noop = () => {};

const MOCK_RESULT: RoundResultEvent = {
  correct: true,
  guesserName: 'Anna',
  songTitle: 'Billie Jean',
  artist: 'Michael Jackson',
  year: 1983,
  coverUrl: 'https://i.scdn.co/image/ab67616d0000b27332a7d87248d1b75463483df5',
  points: 1250,
  playerGuesses: [
    { name: 'Anna', guess: 'billie jean' },
    { name: 'John', guess: null },
    { name: 'Olivia', guess: 'Beat It' },
  ],
};

const MOCK_HOST: HostState = {
  spotify: { playerReady: true, playbackError: null, activatePlayer: noop } as any,
  phase: 'playing',
  pin: '123',
  players: [
    { name: 'Anna', score: 3100, streak: 3 },
    { name: 'John', score: 2650 },
    { name: 'Olivia', score: 1850, streak: 1 },
  ],
  roundIndex: 2,
  totalRounds: 10,
  hints: [],
  bettingTime: 15,
  timeLeft: 2,
  timerTotal: 15,
  bidCount: 3,
  countdown: null,
  guesserNames: ['Anna'],
  lowestBid: 2,
  playerBids: [
    { name: 'Anna', bid: 2 },
    { name: 'John', bid: 5 },
    { name: 'Olivia', bid: 7 },
  ],
  result: null,
  roundDeltas: {},
  roundPity: {},
  roundPityAmount: {},
  leaderboard: [],
  awards: [],
  copied: false,
  playProgress: 0.62,
  inviteUrl: '',
  settingsOpen: false,
  bettingTimeSetting: 15,
  guessingTimeSetting: 15,
  roundsSetting: 10,
  mode: 'classic',
  raceTimeSetting: 30,
  raceWinnerOnly: false,
  artistOnly: false,
  yearOnly: false,
  multipleChoice: false,
  difficulty: 'hard',
  enabledEvents: ['double', 'mystery', 'steal', 'snippet', 'fullhints', 'blind', 'outro', 'underdog'],
  enabledRoundTypes: ['choice', 'artist', 'both', 'year', 'winnerOnly'],
  chaosLevel: 50,
  finaleEnabled: false,
  songSource: 'library',
  customPlaylists: [],
  playlistPicker: { playlists: [], loadingPlaylists: false, playlistsError: null, fetchPlaylists: noop, fetchPlaylistTracks: async () => ({ ok: false, error: 'error' }) } as any,
  playlistPickerOpen: false,
  startError: null,
  party: null,
  roundArtistOnly: false,
  roundYearOnly: false,
  roundChoiceOptions: [],
  stealResult: null,
  answeredCount: 0,
  reconnecting: false,
  reconnectingCount: 0,
  gameExpired: false,
  songPlaying: true,
  songTempo: 117,
  toggleSettings: noop,
  setBettingTimeSetting: noop,
  setGuessingTimeSetting: noop,
  setRoundsSetting: noop,
  setMode: noop,
  setRaceTimeSetting: noop,
  setRaceWinnerOnly: noop,
  setArtistOnly: noop,
  setYearOnly: noop,
  setMultipleChoice: noop,
  setDifficulty: noop,
  toggleEvent: noop,
  setEnabledEvents: noop,
  toggleRoundType: noop,
  setEnabledRoundTypes: noop,
  setChaosLevel: noop,
  setFinaleEnabled: noop,
  setSongSource: noop,
  addPlaylist: noop,
  removePlaylist: noop,
  openPlaylistPicker: noop,
  closePlaylistPicker: noop,
  createGame: noop,
  startGame: noop,
  skipTurn: noop,
  endGame: noop,
  copyInvite: noop,
  newGame: noop,
  removePlayer: noop,
};

const MOCK_HOST_REVEAL: HostState = {
  ...MOCK_HOST,
  phase: 'reveal',
  result: MOCK_RESULT,
  roundDeltas: { Anna: 1250 },
};

const MOCK_RESULT_YEAR: RoundResultEvent = {
  correct: true,
  guesserName: null,
  songTitle: 'Billie Jean',
  artist: 'Michael Jackson',
  year: 1983,
  coverUrl: 'https://i.scdn.co/image/ab67616d0000b27332a7d87248d1b75463483df5',
  points: 0,
  party: {
    format: 'year', target: 'title', event: null, multiplier: 1, winnerOnly: false,
    intro: { title: 'Guess the Year', tagline: 'Closest answer wins the round' },
    finale: false, duelists: [], restricted: [],
  },
  playerGuesses: [
    { name: 'Anna', guess: '1984' },
    { name: 'John', guess: '1979' },
    { name: 'Olivia', guess: '1983' },
    { name: 'Marcus', guess: null },
  ],
  yearResults: [
    { name: 'Olivia', guess: 1983, diff: 0, points: 650, pity: false },
    { name: 'Anna', guess: 1984, diff: 1, points: 480, pity: false },
    { name: 'John', guess: 1979, diff: 4, points: 210, pity: false },
    { name: 'Marcus', guess: null, diff: null, points: 0, pity: false },
  ],
};

const MOCK_HOST_YEAR_REVEAL: HostState = {
  ...MOCK_HOST,
  phase: 'reveal',
  result: MOCK_RESULT_YEAR,
  roundDeltas: { Olivia: 650, Anna: 480, John: 210 },
};

// Jackpot mystery roll (x10, the rarest weight) so the reel's gold-glow
// landing state is what gets captured, not a routine x1.5-x4.
const MOCK_RESULT_MYSTERY: RoundResultEvent = {
  ...MOCK_RESULT,
  points: 4200,
  party: {
    format: 'classic', target: 'title', event: 'mystery', multiplier: 10, winnerOnly: false,
    intro: { title: 'Mystery Multiplier', tagline: 'Revealed after the round: ×1.5 up to ×10' },
    finale: false, duelists: [], restricted: [],
  },
};

const MOCK_HOST_MYSTERY_REVEAL: HostState = {
  ...MOCK_HOST,
  phase: 'reveal',
  result: MOCK_RESULT_MYSTERY,
  roundDeltas: { Anna: 4200 },
  party: MOCK_RESULT_MYSTERY.party ?? null,
};

// A delta past BIG_POINTS_THRESHOLD without a party multiplier — e.g. a big
// steal or bonuses stacking — for capturing the celebration on its own.
const MOCK_HOST_BIGPOINTS_REVEAL: HostState = {
  ...MOCK_HOST,
  phase: 'reveal',
  result: MOCK_RESULT,
  roundDeltas: { Anna: 3200 },
};

// ─── Crowd fixtures ────────────────────────────────────────────────────────
// Stress cases the 3-player fixtures above never exercise: a bigger roster
// (more leaderboard/guess-list rows) and, for a couple of players, a second
// guess line (artist guess) that doubles their row height — the actual worst
// case for a reveal screen's vertical space, not just "more of the same row".

const CROWD_RESULT: RoundResultEvent = {
  correct: true,
  guesserName: 'Anna',
  songTitle: 'Billie Jean',
  artist: 'Michael Jackson',
  year: 1983,
  coverUrl: 'https://i.scdn.co/image/ab67616d0000b27332a7d87248d1b75463483df5',
  points: 1250,
  playerGuesses: [
    { name: 'Anna', guess: 'billie jean' },
    { name: 'John', guess: null },
    { name: 'Olivia', guess: 'Beat It' },
    { name: 'Marcus', guess: 'Thriller', artistGuess: 'Michael Jackson', artistCorrect: true },
    { name: 'Sofia', guess: null },
    { name: 'Priya', guess: 'billie gene' },
    { name: 'Devon', guess: 'Billie Jean', artistGuess: 'MJ', artistCorrect: false },
  ],
};

const CROWD_HOST_PLAYERS = [
  { name: 'Anna', score: 3100, streak: 3 },
  { name: 'John', score: 2650 },
  { name: 'Olivia', score: 1850, streak: 1 },
  { name: 'Marcus', score: 2200, streak: 4 },
  { name: 'Sofia', score: 1600 },
  { name: 'Priya', score: 1400, streak: 2 },
  { name: 'Devon', score: 900 },
];

const MOCK_HOST_CROWD: HostState = {
  ...MOCK_HOST,
  players: CROWD_HOST_PLAYERS,
};

const MOCK_HOST_REVEAL_CROWD: HostState = {
  ...MOCK_HOST_CROWD,
  phase: 'reveal',
  result: CROWD_RESULT,
  roundDeltas: { Anna: 1250 },
};

// Two guesses tied exactly on the actual year (tests the timeline grouping
// multiple names under one marker) plus a full spread of the rest, so both
// the name-lane and year-lane packing in YearTimelineContent get exercised.
const CROWD_RESULT_YEAR: RoundResultEvent = {
  correct: true,
  guesserName: null,
  songTitle: 'Billie Jean',
  artist: 'Michael Jackson',
  year: 1983,
  coverUrl: 'https://i.scdn.co/image/ab67616d0000b27332a7d87248d1b75463483df5',
  points: 0,
  party: {
    format: 'year', target: 'title', event: null, multiplier: 1, winnerOnly: false,
    intro: { title: 'Guess the Year', tagline: 'Closest answer wins the round' },
    finale: false, duelists: [], restricted: [],
  },
  playerGuesses: [
    { name: 'Anna', guess: '1984' },
    { name: 'John', guess: '1979' },
    { name: 'Olivia', guess: '1983' },
    { name: 'Marcus', guess: '1985' },
    { name: 'Sofia', guess: '1990' },
    { name: 'Priya', guess: '1983' },
    { name: 'Devon', guess: null },
  ],
  yearResults: [
    { name: 'Olivia', guess: 1983, diff: 0, points: 650, pity: false },
    { name: 'Priya', guess: 1983, diff: 0, points: 650, pity: false },
    { name: 'Anna', guess: 1984, diff: 1, points: 480, pity: false },
    { name: 'Marcus', guess: 1985, diff: 2, points: 350, pity: false },
    { name: 'John', guess: 1979, diff: 4, points: 210, pity: false },
    { name: 'Sofia', guess: 1990, diff: 7, points: 80, pity: false },
    { name: 'Devon', guess: null, diff: null, points: 0, pity: false },
  ],
};

const MOCK_HOST_YEAR_REVEAL_CROWD: HostState = {
  ...MOCK_HOST_CROWD,
  phase: 'reveal',
  result: CROWD_RESULT_YEAR,
  roundDeltas: { Olivia: 650, Priya: 650, Anna: 480, Marcus: 350, John: 210, Sofia: 80 },
};

const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, name: 'Anna', score: 5350 },
  { rank: 2, name: 'John', score: 4100 },
  { rank: 3, name: 'Olivia', score: 3200 },
  { rank: 4, name: 'Marcus', score: 2850 },
  { rank: 5, name: 'Sofia', score: 2100 },
];

const MOCK_LEADERBOARD_LONG: LeaderboardEntry[] = [
  { rank: 1, name: 'Maximiliana Featherstonehaugh', score: 5350 },
  { rank: 2, name: 'Bartholomew Higginbotham-Smythe', score: 4100 },
  { rank: 3, name: 'Olivia', score: 3200 },
];

const MOCK_AWARDS: Award[] = [
  { key: 'mostCorrect', playerNames: ['Anna'], detail: '9/10 correct guesses' },
  {
    key: 'fastestGuess', playerNames: ['John'], detail: '0.8s fastest correct guess',
    highlights: [{ playerName: 'John', guess: 'Billie Jean', songTitle: 'Billie Jean', artist: 'Michael Jackson', coverUrl: MOCK_RESULT.coverUrl, timeMs: 800 }],
  },
  {
    key: 'fastestClassicGuess', playerNames: ['Priya'], detail: '1.2s fastest correct guess',
    highlights: [{ playerName: 'Priya', guess: 'Billie Jean', songTitle: 'Billie Jean', artist: 'Michael Jackson', coverUrl: MOCK_RESULT.coverUrl, timeMs: 1200 }],
  },
  { key: 'biggestSwing', playerNames: ['Olivia', 'Marcus'], detail: '+1200 point single-round swing' },
  { key: 'finaleWinner', playerNames: ['Anna'], detail: 'Beat John 2\u20131 in the finale duel' },
];

const MOCK_HOST_LOBBY: HostState = {
  ...MOCK_HOST,
  phase: 'lobby',
};

// Steal Round is party mode's showiest mechanic (win, then rob a victim), so
// it's the one screenshotted to represent the round-intro popup.
const MOCK_PARTY_STEAL: PartyInfo = {
  format: 'classic', target: 'title', event: 'steal', multiplier: 1, winnerOnly: false,
  intro: { title: 'Steal Round', tagline: 'Win the round, then rob another player · Bid & guess / name the song' },
  finale: false, duelists: [], restricted: [],
};

const MOCK_PLAY: PlayState = {
  phase: 'watching',
  pin: '123',
  name: 'Anna',
  myName: 'Anna',
  error: '',
  roundIndex: 2,
  totalRounds: 10,
  hints: [],
  timeLeft: 8,
  timerTotal: 15,
  bettingTime: 15,
  bidIndex: 4,
  bidOptions: [0.1, 0.5, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 45, 60],
  bidScores: null,
  myBid: 2,
  guesserNames: ['John'],
  lowestBid: 2,
  guessText: '',
  result: null,
  myScore: 2650,
  myScoreDelta: 0,
  myRank: null,
  myPity: false,
  myPityAmount: 0,
  myBreakdown: null,
  myStreak: 0,
  mode: 'classic',
  artistOnly: false,
  yearOnly: false,
  choiceOptions: [],
  party: null,
  introParty: null,
  artistGuessText: '',
  stealVictims: null,
  stealResult: null,
  myRacePoints: 0,
  myRaceTimeMs: null,
  leaderboard: [],
  leaderboardDeltas: {},
  awards: [],
  finalResultsSkipped: false,
  songPlaying: true,
  songTempo: 117,
  reconnecting: false,
  hostReconnecting: false,
  savedSession: null,
  guessInputRef: { current: null },
  cameFromQR: false,
  setPin: noop, setName: noop, setBidIndex: noop, setGuessText: noop, setArtistGuessText: noop,
  submitStealVictim: noop, skipSteal: noop, join: noop, rejoinSaved: noop, submitBid: noop,
  submitGuess: noop, submitChoice: noop, submitChaosTap: noop, skipGuess: noop, newGamePin: null, rejoinNewGame: noop, renamePlayer: noop,
  waitingTransitionPending: false, completeWaitingTransition: noop,
};

const MOCK_PLAY_GUESSING: PlayState = {
  ...MOCK_PLAY,
  phase: 'guessing',
  guesserNames: ['Anna'],
  guessText: 'Bil',
};

const MOCK_PLAY_YEAR_GUESSING: PlayState = {
  ...MOCK_PLAY,
  phase: 'guessing',
  guesserNames: ['Anna'],
  guessText: '198',
  mode: 'race',
  party: {
    format: 'year', target: 'title', event: null, multiplier: 1, winnerOnly: false,
    intro: { title: 'Guess the Year', tagline: 'Closest answer wins the round' },
    finale: false, duelists: [], restricted: [],
  },
};

const MOCK_PLAY_REVEAL: PlayState = {
  ...MOCK_PLAY,
  phase: 'reveal',
  myName: 'Anna',
  myScore: 4350,
  myScoreDelta: 1250,
  myRank: { rank: 1, total: 3 },
  myBreakdown: { parts: [{ label: 'Base', amount: 500 }, { label: 'Bid bonus', amount: 600 }, { label: 'Difficulty', amount: 150 }], multiplier: 1, multiplierBonus: 0, pity: 0, total: 1250 },
  myStreak: 3,
};

const MOCK_RESULT_NOONE: RoundResultEvent = {
  ...MOCK_RESULT,
  correct: false,
  guesserName: null,
  points: 0,
  playerGuesses: [
    { name: 'Anna', guess: 'not quite it' },
    { name: 'John', guess: null },
    { name: 'Olivia', guess: 'Thriller' },
  ],
};

const MOCK_PLAY_REVEAL_NOONE: PlayState = {
  ...MOCK_PLAY,
  phase: 'reveal',
  myName: 'Anna',
  myScoreDelta: 0,
};

// Every non-zero PointsBreakdownList line at once (base, bid, difficulty,
// artist bonus, multiplier, pity) stacked on top of the 7-row crowd guess
// list — the tallest the player reveal card's content can realistically get.
const MOCK_PLAY_REVEAL_CROWD: PlayState = {
  ...MOCK_PLAY,
  phase: 'reveal',
  myName: 'Anna',
  myScore: 4350,
  myScoreDelta: 1250,
  myRank: { rank: 1, total: 7 },
  myBreakdown: {
    parts: [
      { label: 'Base', amount: 500 },
      { label: 'Bid bonus', amount: 400 },
      { label: 'Difficulty', amount: 150 },
      { label: 'Artist bonus', amount: 100 },
    ],
    multiplier: 2, multiplierBonus: 600, pity: 80, total: 1250,
  },
  myStreak: 4,
};

// Party's "both" target puts two text inputs on screen at once — explicitly
// called out in GuessingView as the tightest case for a keyboard-shrunk
// viewport (title + artist input + submit, all above the keyboard).
const MOCK_PLAY_GUESSING_BOTH: PlayState = {
  ...MOCK_PLAY,
  phase: 'guessing',
  guesserNames: ['Anna'],
  guessText: 'Bil',
  artistGuessText: 'Mich',
  party: {
    format: 'classic', target: 'both', event: null, multiplier: 1, winnerOnly: false,
    intro: { title: 'Name It', tagline: 'Title + artist = bonus' },
    finale: false, duelists: [], restricted: [],
  },
};

// Join-state fixtures exercise each shape of the entry screen: a normal PIN
// entry, a direct invite where the PIN is already encoded in the URL, and a
// returning player who can rejoin their saved session.
const MOCK_PLAY_JOIN: PlayState = {
  ...MOCK_PLAY,
  phase: 'join',
};

const MOCK_PLAY_JOIN_LINK: PlayState = {
  ...MOCK_PLAY_JOIN,
  pin: '123',
  cameFromQR: true,
};

const MOCK_PLAY_JOIN_REJOIN: PlayState = {
  ...MOCK_PLAY_JOIN,
  savedSession: { pin: '123', name: 'Anna' },
};

// ─── Entry ────────────────────────────────────────────────────────────────────

// A manual fixture gives sound design a reliable downbeat: the real
// FinalResultsView does not mount until the button is pressed, so its own
// two-beat black intro begins at that exact click rather than on page load.
function FinalResultsPreview({ leaderboard = MOCK_LEADERBOARD, awards = MOCK_AWARDS }: Readonly<{
  leaderboard?: LeaderboardEntry[];
  awards?: Award[];
}>) {
  const [started, setStarted] = useState(false);
  const { ready } = useFinalResultsRevealSound(Math.min(3, leaderboard.length));
  const backgroundSrc = `${import.meta.env.BASE_URL}backgrounds/background7.png`;

  if (started) {
    return (
      <HostScaleShell>
        <FinalResultsView
          leaderboard={leaderboard}
          awards={awards}
          backgroundSrc={backgroundSrc}
          footer={<PillButton onClick={noop} label="New Game" />}
        />
      </HostScaleShell>
    );
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center overflow-hidden bg-black p-6">
      <img
        src={backgroundSrc}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover opacity-15"
      />
      <div className="absolute inset-0 bg-black/80" aria-hidden="true" />
      <button
        type="button"
        onClick={() => setStarted(true)}
        disabled={!ready}
        className="relative z-10 rounded-full border border-white/30 bg-white/10 px-7 py-4 text-center text-white shadow-xl backdrop-blur-sm transition hover:bg-white/20 disabled:cursor-wait disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
      >
        <span className="block text-base font-black uppercase tracking-[0.16em]">{ready ? 'Start final reveal' : 'Loading final reveal'}</span>
        <span className="mt-1 block text-xs font-bold tracking-[0.12em] text-white/60">112 BPM · 2-beat intro</span>
      </button>
    </main>
  );
}

export default function Screenshot() {
  const [params] = useSearchParams();
  const screenshots: Record<string, ReactNode> = {
    home: <Home />,
    join: <PlayerScaleShell><JoinView game={MOCK_PLAY_JOIN} /></PlayerScaleShell>,
    'join-link': <PlayerScaleShell><JoinView game={MOCK_PLAY_JOIN_LINK} /></PlayerScaleShell>,
    'join-rejoin': <PlayerScaleShell><JoinView game={MOCK_PLAY_JOIN_REJOIN} /></PlayerScaleShell>,
    playing: <HostScaleShell><PlayingView game={MOCK_HOST} /></HostScaleShell>,
    reveal: <HostScaleShell><RevealView game={MOCK_HOST_REVEAL} result={MOCK_RESULT} instant /></HostScaleShell>,
    year: <HostScaleShell><RevealView game={MOCK_HOST_YEAR_REVEAL} result={MOCK_RESULT_YEAR} instant /></HostScaleShell>,
    'mystery-reveal': <HostScaleShell><RevealView game={MOCK_HOST_MYSTERY_REVEAL} result={MOCK_RESULT_MYSTERY} /></HostScaleShell>,
    'big-points-reveal': <HostScaleShell><RevealView game={MOCK_HOST_BIGPOINTS_REVEAL} result={MOCK_RESULT} /></HostScaleShell>,
    watching: <PlayerScaleShell><WatchingView game={MOCK_PLAY} /></PlayerScaleShell>,
    waiting: <PlayerScaleShell><WaitingAtmosphere leaving={false} /><WaitingView game={{ ...MOCK_PLAY, phase: 'waiting', myName: 'Joachim' }} leaveBackground={noop} /></PlayerScaleShell>,
    guessing: <PlayerScaleShell><GuessingView game={MOCK_PLAY_GUESSING} /></PlayerScaleShell>,
    'year-guessing': <PlayerScaleShell><GuessingView game={MOCK_PLAY_YEAR_GUESSING} /></PlayerScaleShell>,
    'guessing-both': <PlayerScaleShell><GuessingView game={MOCK_PLAY_GUESSING_BOTH} /></PlayerScaleShell>,
    'play-reveal': <PlayerScaleShell><PlayRevealView game={MOCK_PLAY_REVEAL} result={MOCK_RESULT} /></PlayerScaleShell>,
    'play-reveal-noone': <PlayerScaleShell><PlayRevealView game={MOCK_PLAY_REVEAL_NOONE} result={MOCK_RESULT_NOONE} /></PlayerScaleShell>,
    'play-reveal-crowd': <PlayerScaleShell><PlayRevealView game={MOCK_PLAY_REVEAL_CROWD} result={CROWD_RESULT} /></PlayerScaleShell>,
    'reveal-crowd': <HostScaleShell><RevealView game={MOCK_HOST_REVEAL_CROWD} result={CROWD_RESULT} instant /></HostScaleShell>,
    'year-crowd': <HostScaleShell><RevealView game={MOCK_HOST_YEAR_REVEAL_CROWD} result={CROWD_RESULT_YEAR} instant /></HostScaleShell>,
    lobby: <HostScaleShell><LobbyView game={MOCK_HOST_LOBBY} /></HostScaleShell>,
    'party-intro': <RoundIntro party={MOCK_PARTY_STEAL} roundKey={0} dismissible={false} />,
    'final-host': <FinalResultsPreview />,
    'final-host-classic-only': <HostScaleShell><FinalResultsView leaderboard={MOCK_LEADERBOARD} awards={MOCK_AWARDS.filter(a => a.key !== 'fastestGuess' && a.key !== 'finaleWinner')} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background7.png`} footer={<PillButton onClick={noop} label="New Game" />} /></HostScaleShell>,
    'final-host-race-only': <HostScaleShell><FinalResultsView leaderboard={MOCK_LEADERBOARD} awards={MOCK_AWARDS.filter(a => a.key !== 'fastestClassicGuess' && a.key !== 'finaleWinner')} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background7.png`} footer={<PillButton onClick={noop} label="New Game" />} /></HostScaleShell>,
    'final-host-no-speed': <HostScaleShell><FinalResultsView leaderboard={MOCK_LEADERBOARD} awards={MOCK_AWARDS.filter(a => a.key !== 'fastestClassicGuess' && a.key !== 'fastestGuess' && a.key !== 'finaleWinner')} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background7.png`} footer={<PillButton onClick={noop} label="New Game" />} /></HostScaleShell>,
    'final-host-1': <FinalResultsPreview leaderboard={MOCK_LEADERBOARD.slice(0, 1)} awards={[]} />,
    'final-host-2': <FinalResultsPreview leaderboard={MOCK_LEADERBOARD.slice(0, 2)} awards={[]} />,
    'final-host-long': <HostScaleShell><FinalResultsView leaderboard={MOCK_LEADERBOARD_LONG} awards={MOCK_AWARDS} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background7.png`} footer={<PillButton onClick={noop} label="New Game" />} /></HostScaleShell>,
    'final-player': <PlayerScaleShell><FinalResultsPlayerView leaderboard={MOCK_LEADERBOARD} awards={MOCK_AWARDS} myName="John" backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background7.png`} footer={<PillButton onClick={noop} label="Leave" />} /></PlayerScaleShell>,
    'final-empty': <HostScaleShell><FinalResultsView leaderboard={[]} awards={[]} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background7.png`} footer={<PillButton onClick={noop} label="New Game" />} /></HostScaleShell>,
  };

  return screenshots[params.get('v') ?? '']
    ?? <p className="text-white p-6 font-mono">?v=home|join|join-link|join-rejoin|playing|reveal|year|mystery-reveal|big-points-reveal|watching|guessing|year-guessing|guessing-both|play-reveal|play-reveal-noone|play-reveal-crowd|reveal-crowd|year-crowd|lobby|party-intro|final-host|final-host-classic-only|final-host-race-only|final-host-no-speed|final-host-1|final-host-2|final-host-long|final-player|final-empty</p>;
}
