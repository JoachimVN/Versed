import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { PartyBadge } from '../../components/RoundIntro';
import { timerColor } from '../../components/CircularTimer';
import { LIQUID_PILL_PROPS } from '../../components/liquidGlassPresets';
import type { PlayState } from './usePlayGame';

function bidArrowStyle(enabled: boolean, pressed: boolean, hovered: boolean): { bg: string; border: string } {
  if (!enabled) return { bg: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.04)' };
  if (pressed) return { bg: 'rgba(158,18,204,0.28)', border: '1px solid rgba(158,18,204,0.5)' };
  if (hovered) return { bg: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.18)' };
  return { bg: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)' };
}

function BidArrow({ direction, enabled, onClick }: Readonly<{ direction: 'left' | 'right'; enabled: boolean; onClick: () => void }>) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const { bg, border } = bidArrowStyle(enabled, pressed, hovered);
  return (
    <button
      onClick={() => enabled && onClick()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => enabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      aria-label={direction === 'left' ? 'Decrease bid time' : 'Increase bid time'}
      disabled={!enabled}
      style={{
        width: 52, height: 52, borderRadius: '50%', border,
        cursor: enabled ? 'pointer' : 'default',
        background: bg,
        opacity: enabled ? 1 : 0.22,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s ease, border-color 0.15s ease, transform 0.1s ease',
        transform: pressed ? 'scale(0.9)' : 'scale(1)',
      }}
    >
      {direction === 'left'
        ? <ChevronLeft className="w-5 h-5 text-white" />
        : <ChevronRight className="w-5 h-5 text-white" />}
    </button>
  );
}

export function BettingView({ game }: Readonly<{ game: PlayState }>) {
  const { roundIndex, totalRounds, timeLeft, bettingTime, bidIndex, bidOptions, bidScores, party, error, myName, submitBid, setBidIndex } = game;
  // The finale duel's classic sub-round only takes bids from the two
  // duelists (see recordBid server-side) — everyone else would just have
  // every bid silently rejected, so they get a spectator screen instead of
  // a bid picker that can never actually submit.
  if (party?.finale && myName && !party.duelists.includes(myName)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ background: '#080812' }}>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          The finale
        </p>
        <p style={{ color: 'white', fontWeight: 900, fontSize: '1.5rem' }}>{party.duelists.join(' vs ')}</p>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>Just watch this one — only they can bid</p>
      </div>
    );
  }
  const timerPct = bettingTime > 0 ? Math.max(0, (timeLeft / bettingTime)) * 100 : 0;
  const currentBid = bidOptions[bidIndex];
  const canGoLeft = bidIndex > 0;
  const canGoRight = bidIndex < bidOptions.length - 1;
  // Server-sent per-option scores; the formula fallback only covers a server
  // that predates the bidScores payload.
  const basePoints = bidScores?.[bidIndex] ?? (500 + Math.round(1000 * Math.max(0, 1 - currentBid / 60)));
  // Fold a known party multiplier into the preview; a hidden mystery shows ×?.
  const estPoints = basePoints * (party?.multiplier ?? 1);
  const mysteryHidden = party?.event === 'mystery' && party.multiplier === null;

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: '#080812' }}>
      <img
        src={`${import.meta.env.BASE_URL}background2.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(270deg)' }}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3" style={{ position: 'relative', zIndex: 2 }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem', fontWeight: 600 }}>
          Round {roundIndex + 1}<span style={{ color: 'rgba(255,255,255,0.45)' }}>/{totalRounds}</span>
        </span>
        <span
          className="font-black text-2xl tabular-nums"
          style={{ color: 'white', transition: 'color 0.3s ease' }}
        >
          {timeLeft}s
        </span>
      </div>

      {/* Timer bar */}
      <div className="mx-5 h-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', position: 'relative', zIndex: 2 }}>
        <div
          className="h-0.5 rounded-full"
          style={{
            width: `${timerPct}%`,
            background: timerColor(timerPct / 100),
            transition: timerPct === 0 ? 'none' : 'width 1s linear, background 0.4s ease',
          }}
        />
      </div>

      {/* Bid picker */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5" style={{ position: 'relative', zIndex: 2 }}>
        <PartyBadge party={party} />
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
          How many seconds do you need?
        </p>

        <div className="flex items-center gap-5">
          <BidArrow direction="left" enabled={canGoLeft} onClick={() => setBidIndex(i => i - 1)} />

          {/* Bid value — LiquidGlass */}
          <div className="liquid-btn relative" style={{ width: 160, height: 110 }}>
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              displacementScale={55}
              blurAmount={0.06}
              saturation={130}
              aberrationIntensity={1.5}
              elasticity={0.08}
              cornerRadius={22}
              padding="20px 32px"
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '96px' }}>
                <span style={{ display: 'inline-block', minWidth: '60px', textAlign: 'center', color: 'white', fontWeight: 900, fontSize: '2.8rem', lineHeight: 1 }}>
                  {currentBid}
                </span>
                <span style={{ display: 'inline-block', color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  seconds
                </span>
              </div>
            </LiquidGlass>
          </div>

          <BidArrow direction="right" enabled={canGoRight} onClick={() => setBidIndex(i => i + 1)} />
        </div>

        {/* Score potential */}
        <div className="flex flex-col items-center gap-1">
          <span
            className="tabular-nums transition-all duration-200"
            style={{ color: 'rgba(158,18,204,0.9)', fontWeight: 900, fontSize: '1.6rem', lineHeight: 1 }}
          >
            ~{estPoints.toLocaleString()}
            {mysteryHidden && <span style={{ color: 'rgba(94,234,212,0.8)', fontSize: '1rem', marginLeft: '6px' }}>×?</span>}
          </span>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.68rem' }}>pts + difficulty bonus</p>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm text-center px-5 pb-2" style={{ position: 'relative', zIndex: 2 }} aria-live="assertive">{error}</p>}

      {/* Lock In */}
      <div className="px-5 pb-8 flex justify-center" style={{ position: 'relative', zIndex: 2 }}>
        <button
          type="button"
          className="liquid-btn glass-tint-purple relative cursor-pointer border-0 bg-transparent p-0"
          style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
          onClick={submitBid}
        >
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_PILL_PROPS}
          >
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(158,18,204,0.15)' }} />
              <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '238px', textAlign: 'center' }}>
                Lock In · {currentBid}s
              </span>
            </div>
          </LiquidGlass>
        </button>
      </div>
    </div>
  );
}

export function BidSubmittedView({ game }: Readonly<{ game: PlayState }>) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-white/50">Your bid</p>
      <p className="text-white font-black text-6xl">{game.myBid}s</p>
      <p className="text-white/45">Waiting for others...</p>
    </div>
  );
}
