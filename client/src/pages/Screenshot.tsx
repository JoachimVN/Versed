import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { PlayingView } from './host/PlayingView';
import { RevealView } from './host/RevealView';
import { LobbyView } from './host/LobbyView';
import type { HostState } from './host/useHostGame';
import { WatchingView } from './play/WatchingView';
import { GuessingView } from './play/GuessingView';
import { WaitingAtmosphere } from './play/WaitingAtmosphere';
import { WaitingView } from './play/WaitingView';
import type { PlayState } from './play/usePlayGame';
import { RoundIntro } from '../components/RoundIntro';
import { FinalResultsView } from '../components/FinalResults';
import { FinalResultsPlayerView } from '../components/FinalResultsPlayer';
import { PillButton } from '../components/RevealShared';
import type { RoundResultEvent, LeaderboardEntry, PartyInfo, Award } from '../types';

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
  spotify: null as any,
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
  { key: 'finaleWinner', playerNames: ['Sofia'], detail: 'Won the finale duel' },
];

// LobbyView is the only view that reads `game.spotify` directly, so it needs
// a minimal stand-in rather than the `null as any` the other views get away with.
const MOCK_HOST_LOBBY: HostState = {
  ...MOCK_HOST,
  phase: 'lobby',
  spotify: { playerReady: true } as any,
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
  myPity: false,
  myPityAmount: 0,
  myBreakdown: null,
  myStreak: 0,
  mode: 'classic',
  artistOnly: false,
  yearOnly: false,
  choiceOptions: [],
  party: null,
  artistGuessText: '',
  stealVictims: null,
  stealResult: null,
  myRacePoints: 0,
  myRaceTimeMs: null,
  leaderboard: [],
  leaderboardDeltas: {},
  awards: [],
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

// ─── Entry ────────────────────────────────────────────────────────────────────

export default function Screenshot() {
  const [params] = useSearchParams();
  const screenshots: Record<string, ReactNode> = {
    playing: <PlayingView game={MOCK_HOST} />,
    reveal: <RevealView game={MOCK_HOST_REVEAL} result={MOCK_RESULT} instant />,
    year: <RevealView game={MOCK_HOST_YEAR_REVEAL} result={MOCK_RESULT_YEAR} instant />,
    'mystery-reveal': <RevealView game={MOCK_HOST_MYSTERY_REVEAL} result={MOCK_RESULT_MYSTERY} />,
    'big-points-reveal': <RevealView game={MOCK_HOST_BIGPOINTS_REVEAL} result={MOCK_RESULT} />,
    watching: <WatchingView game={MOCK_PLAY} />,
    waiting: <><WaitingAtmosphere leaving={false} /><WaitingView game={{ ...MOCK_PLAY, phase: 'waiting', myName: 'Joachim' }} leaveBackground={noop} /></>,
    guessing: <GuessingView game={MOCK_PLAY_GUESSING} />,
    'year-guessing': <GuessingView game={MOCK_PLAY_YEAR_GUESSING} />,
    lobby: <LobbyView game={MOCK_HOST_LOBBY} />,
    'party-intro': <RoundIntro party={MOCK_PARTY_STEAL} roundKey={0} dismissible={false} />,
    'final-host': <FinalResultsView leaderboard={MOCK_LEADERBOARD} awards={MOCK_AWARDS} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background6.svg`} footer={<PillButton onClick={noop} label="New Game" />} />,
    'final-host-classic-only': <FinalResultsView leaderboard={MOCK_LEADERBOARD} awards={MOCK_AWARDS.filter(a => a.key !== 'fastestGuess' && a.key !== 'finaleWinner')} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background6.svg`} footer={<PillButton onClick={noop} label="New Game" />} />,
    'final-host-race-only': <FinalResultsView leaderboard={MOCK_LEADERBOARD} awards={MOCK_AWARDS.filter(a => a.key !== 'fastestClassicGuess' && a.key !== 'finaleWinner')} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background6.svg`} footer={<PillButton onClick={noop} label="New Game" />} />,
    'final-host-no-speed': <FinalResultsView leaderboard={MOCK_LEADERBOARD} awards={MOCK_AWARDS.filter(a => a.key !== 'fastestClassicGuess' && a.key !== 'fastestGuess' && a.key !== 'finaleWinner')} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background6.svg`} footer={<PillButton onClick={noop} label="New Game" />} />,
    'final-host-1': <FinalResultsView leaderboard={MOCK_LEADERBOARD.slice(0, 1)} awards={[]} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background6.svg`} footer={<PillButton onClick={noop} label="New Game" />} />,
    'final-host-2': <FinalResultsView leaderboard={MOCK_LEADERBOARD.slice(0, 2)} awards={[]} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background6.svg`} footer={<PillButton onClick={noop} label="New Game" />} />,
    'final-host-long': <FinalResultsView leaderboard={MOCK_LEADERBOARD_LONG} awards={MOCK_AWARDS} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background6.svg`} footer={<PillButton onClick={noop} label="New Game" />} />,
    'final-player': <FinalResultsPlayerView leaderboard={MOCK_LEADERBOARD} awards={MOCK_AWARDS} myName="John" backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background5.svg`} footer={<PillButton onClick={noop} label="Leave" />} />,
    'final-empty': <FinalResultsView leaderboard={[]} awards={[]} backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background6.svg`} footer={<PillButton onClick={noop} label="New Game" />} />,
  };

  return screenshots[params.get('v') ?? '']
    ?? <p className="text-white p-6 font-mono">?v=playing|reveal|year|mystery-reveal|big-points-reveal|watching|guessing|year-guessing|lobby|party-intro|final-host|final-host-classic-only|final-host-race-only|final-host-no-speed|final-host-1|final-host-2|final-host-long|final-player|final-empty</p>;
}
