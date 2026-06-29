import { useSearchParams } from 'react-router-dom';
import { PlayingView, RevealView } from './Host';
import type { HostState } from './Host';
import type { RoundResultEvent } from '../types';

// ─── Fixture data ─────────────────────────────────────────────────────────────

const noop = () => {};

const MOCK_RESULT: RoundResultEvent = {
  correct: true,
  guesserName: 'Anna',
  songTitle: 'Blinding Lights',
  artist: 'The Weeknd',
  year: 2019,
  coverUrl: 'https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36',
  points: 1250,
  playerGuesses: [
    { name: 'Anna', guess: 'blinding lights' },
    { name: 'John', guess: null },
    { name: 'Olivia', guess: 'Blinded by the lights' },
  ],
};

const MOCK_HOST: HostState = {
  spotify: null as any,
  phase: 'playing',
  pin: '247',
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
  leaderboard: [],
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
  answeredCount: 0,
  reconnecting: false,
  reconnectingCount: 0,
  gameExpired: false,
  toggleSettings: noop,
  setBettingTimeSetting: noop,
  setGuessingTimeSetting: noop,
  setRoundsSetting: noop,
  setMode: noop,
  setRaceTimeSetting: noop,
  setRaceWinnerOnly: noop,
  setArtistOnly: noop,
  createGame: noop,
  startGame: noop,
  skipTurn: noop,
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

// ─── Entry ────────────────────────────────────────────────────────────────────

export default function Screenshot() {
  const [params] = useSearchParams();
  const v = params.get('v');
  if (v === 'playing') return <PlayingView game={MOCK_HOST} />;
  if (v === 'reveal')  return <RevealView game={MOCK_HOST_REVEAL} result={MOCK_RESULT} />;
  return <p className="text-white p-6 font-mono">?v=playing|reveal</p>;
}
