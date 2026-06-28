import { useSearchParams } from 'react-router-dom';
import { Music, ChevronLeft, ChevronRight } from 'lucide-react';
import { APP_NAME, BID_OPTIONS } from '../config';

// ─── Shared ───────────────────────────────────────────────────────────────────

function BidTimeline({ bids, lowestBid }: { bids: { name: string; bid: number }[]; lowestBid: number }) {
  const sorted = [...bids].sort((a, b) => a.bid - b.bid);
  const min = sorted[0].bid;
  const max = sorted[sorted.length - 1].bid;
  const span = max === min ? 0 : max - min;
  const pos = (bid: number) => (span === 0 ? 50 : 8 + ((bid - min) / span) * 84);
  return (
    <div className="w-full">
      <div className="relative h-12">
        {sorted.map((e, i) => (
          <span key={e.name} className={`absolute text-xs font-semibold whitespace-nowrap -translate-x-1/2 ${e.bid === lowestBid ? 'text-purple-300' : 'text-white/50'}`}
            style={{ left: `${pos(e.bid)}%`, top: i % 2 === 0 ? 2 : 22 }}>
            {e.name}
          </span>
        ))}
      </div>
      <div className="relative h-px bg-white/20">
        {sorted.map(e => (
          <div key={e.name}
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full ${e.bid === lowestBid ? 'w-3 h-3 bg-purple-400' : 'w-2 h-2 bg-white/40'}`}
            style={{ left: `${pos(e.bid)}%` }} />
        ))}
      </div>
      <div className="relative h-5 mt-1">
        {sorted.map(e => (
          <span key={e.name} className={`absolute text-xs -translate-x-1/2 ${e.bid === lowestBid ? 'text-purple-400' : 'text-white/30'}`}
            style={{ left: `${pos(e.bid)}%` }}>
            {e.bid}s
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Playing — host mid-playback ──────────────────────────────────────────────

function PlayingScreenshot() {
  const bids = [
    { name: 'Player1', bid: 2 },
    { name: 'Player2', bid: 5 },
    { name: 'Player3', bid: 7 },
  ];
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6 text-center">
      <p className="text-white/50">Round 3/10</p>
      <Music className="w-16 h-16 text-white" />
      <p className="text-white/50">Player1 will guess</p>
      <div className="w-full max-w-sm bg-white/10 rounded-full h-2 overflow-hidden">
        <div className="bg-purple-500 h-2 rounded-full" style={{ width: '62%' }} />
      </div>
      <p className="text-white font-black text-2xl">2s</p>
      <div className="w-full max-w-sm">
        <BidTimeline bids={bids} lowestBid={2} />
      </div>
    </div>
  );
}

// ─── Home — landing page ──────────────────────────────────────────────────────

function LobbyScreenshot() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt={APP_NAME} className="mx-auto h-16 w-auto" />
        <p className="mt-2 text-white/60 text-lg">Music quiz for everyone in the room</p>
      </div>
      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button className="w-full py-4 rounded-2xl bg-[#1DB954] text-white font-bold text-xl shadow-lg">
          Host a game
        </button>
        <button className="w-full py-4 rounded-2xl bg-white/10 text-white font-bold text-xl">
          Join a game
        </button>
      </div>
      <p className="text-white/30 text-sm text-center max-w-xs">
        Hosting requires a Spotify Premium account
      </p>
    </div>
  );
}

// ─── Betting — player bidding phase ───────────────────────────────────────────

function BettingScreenshot() {
  const hints = [
    { label: 'Era', value: '2010s' },
    { label: 'Artist initials', value: 'T.S.' },
    { label: 'Title', value: '_ _ _ _   _ _ _ _' },
  ];
  const bidIndex = 4; // 2s
  const timeLeft = 8;
  const bettingTime = 15;
  return (
    <div className="min-h-screen flex flex-col p-5 gap-4">
      <div className="flex justify-between items-center">
        <span className="text-white/50 text-sm">1/10</span>
        <span className="text-white font-black text-xl">{timeLeft}s</span>
        <span className="text-white/50 text-sm">1 850 pts</span>
      </div>
      <div className="w-full bg-white/10 rounded-full h-1.5">
        <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${(timeLeft / bettingTime) * 100}%` }} />
      </div>
      <div className="bg-white/5 rounded-2xl p-4 space-y-2">
        {hints.map(h => (
          <div key={h.label} className="flex justify-between">
            <span className="text-white/50 text-sm">{h.label}</span>
            <span className="text-white font-semibold text-sm">{h.value}</span>
          </div>
        ))}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <p className="text-white/60 text-center">How fast can you name this song?</p>
        <div className="flex items-center gap-6">
          <button className="w-14 h-14 rounded-full bg-white/10 text-white flex items-center justify-center">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="text-center w-28">
            <p className="text-white font-black text-5xl">{BID_OPTIONS[bidIndex]}</p>
            <p className="text-white/40 text-sm">seconds</p>
          </div>
          <button className="w-14 h-14 rounded-full bg-white/10 text-white flex items-center justify-center">
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      </div>
      <button className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl">
        Lock In
      </button>
    </div>
  );
}

// ─── Entry ────────────────────────────────────────────────────────────────────

export default function Screenshot() {
  const [params] = useSearchParams();
  const v = params.get('v');
  if (v === 'playing') return <PlayingScreenshot />;
  if (v === 'lobby') return <LobbyScreenshot />;
  if (v === 'betting') return <BettingScreenshot />;
  return <p className="text-white p-6 font-mono">?v=playing|lobby|betting</p>;
}
