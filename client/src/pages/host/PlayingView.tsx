import LiquidGlass from '../../components/StableLiquidGlass';
import { PartyBadge } from '../../components/RoundIntro';
import { CircularTimer, HeroTimer } from '../../components/CircularTimer';
import { AudioBars, ACCENT_TINT_CLASS, ACCENT_WASH, ACCENT_GLOW_ANIMATION } from '../../components/AudioBars';
import { LIQUID_CARD_PROPS } from '../../components/liquidGlassPresets';
import { useRevealLayout } from '../../components/revealSqueeze';
import type { HostState } from './useHostGame';
import { roundAccent, usesRaceFlow, RaceHintBar } from './roundBits';
import { EndGameButton } from './dialogs';

export function BidTimeline({ bids, lowestBid }: Readonly<{ bids: { name: string; bid: number }[]; lowestBid: number }>) {
  if (bids.length === 0) return null;
  const sorted = [...bids].sort((a, b) => a.bid - b.bid);
  const min = sorted[0].bid;
  const max = sorted.at(-1)!.bid;
  const span = max === min ? 0 : max - min;
  const pos = (bid: number) => span === 0 ? 50 : 8 + ((bid - min) / span) * 84;

  // Group players by bid so ties share one position instead of stacking on top of each other.
  const groups: { bid: number; names: string[] }[] = [];
  for (const { name, bid } of sorted) {
    const last = groups.at(-1);
    if (last?.bid === bid) last.names.push(name);
    else groups.push({ bid, names: [name] });
  }

  const MAX_NAMES = 3;
  const maxLines = groups.reduce((m, g) => Math.max(m, Math.min(g.names.length, MAX_NAMES) + (g.names.length > MAX_NAMES ? 1 : 0)), 0);
  const nameAreaHeight = 22 + maxLines * 16 + 8;

  return (
    <div className="w-full">
      {/* Name labels — alternate above/below to reduce overlap on close bids */}
      <div className="relative" style={{ height: nameAreaHeight }}>
        {groups.map((group, i) => (
          <div
            key={group.bid}
            className={`absolute -translate-x-1/2 flex flex-col items-center gap-0.5 ${group.bid === lowestBid ? 'text-purple-300' : 'text-white/50'}`}
            style={{ left: `${pos(group.bid)}%`, top: i % 2 === 0 ? 2 : 22 }}
          >
            {group.names.slice(0, MAX_NAMES).map(name => (
              <span key={name} className="text-xs font-semibold whitespace-nowrap">{name}</span>
            ))}
            {group.names.length > MAX_NAMES && (
              <span className="text-xs whitespace-nowrap opacity-60">+{group.names.length - MAX_NAMES} more</span>
            )}
          </div>
        ))}
      </div>

      {/* Bar + dots */}
      <div className="relative h-px bg-white/20">
        {groups.map(group => (
          <div
            key={group.bid}
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full ${group.bid === lowestBid ? 'w-3 h-3 bg-purple-400' : 'w-2 h-2 bg-white/40'}`}
            style={{ left: `${pos(group.bid)}%` }}
          />
        ))}
      </div>

      {/* Bid value labels */}
      <div className="relative h-5 mt-1">
        {groups.map(group => (
          <span
            key={group.bid}
            className={`absolute text-xs -translate-x-1/2 ${group.bid === lowestBid ? 'text-purple-400' : 'text-white/45'}`}
            style={{ left: `${pos(group.bid)}%` }}
          >
            {group.bid}s
          </span>
        ))}
      </div>
    </div>
  );
}

// PlayingView's own bid display — a flat row of chips (one per bid, ties
// grouped) rather than BidTimeline's spatial number-line. Demoted to small
// supporting chrome under the hero timer, so a plain list reads better here
// than a whole secondary spatial widget competing for attention.
function BidChipRow({ bids, lowestBid }: Readonly<{ bids: { name: string; bid: number }[]; lowestBid: number }>) {
  if (bids.length === 0) return null;
  const sorted = [...bids].sort((a, b) => a.bid - b.bid);
  const groups: { bid: number; names: string[] }[] = [];
  for (const { name, bid } of sorted) {
    const last = groups.at(-1);
    if (last?.bid === bid) last.names.push(name);
    else groups.push({ bid, names: [name] });
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px' }}>
      {groups.map(group => {
        const active = group.bid === lowestBid;
        return (
          <div key={group.bid} style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '999px',
            background: active ? 'rgba(158,18,204,0.28)' : 'rgba(255,255,255,0.06)',
            border: active ? '1px solid rgba(216,144,240,0.55)' : '1px solid rgba(255,255,255,0.1)',
          }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: active ? '#fff' : 'rgba(255,255,255,0.7)' }}>{group.names.join(' & ')}</span>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: active ? 'rgba(230,190,250,0.95)' : 'rgba(255,255,255,0.4)' }}>{group.bid}s</span>
          </div>
        );
      })}
    </div>
  );
}

// The small "now playing" icon + eyebrow row every branch below leads with —
// demoted to compact supporting chrome so the countdown dial underneath is
// the card's one dominant hero, not one block among several equal-weight ones.
function EyebrowRow({ label, accent, songPlaying, songTempo, size }: Readonly<{
  label: string; accent: 'classic' | 'race' | 'year' | 'party'; songPlaying: boolean; songTempo?: number | null; size: number;
}>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
      <AudioBars playing={songPlaying} accent={accent} height={size} bpm={songTempo} />
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700 }}>
        {label}
      </span>
    </div>
  );
}

export function PlayingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, countdown, guesserNames, lowestBid, playerBids, timeLeft, timerTotal, mode, roundYearOnly, hints, answeredCount, players, skipTurn, endGame, party, songPlaying, songTempo, spotify } = game;
  // Party rounds that aren't classic-format arrive with an empty bid state and
  // behave exactly like race rounds on this screen. "Guess the year" rides
  // the race flow even in Classic mode — but only outside Party, which picks
  // its own per-round target. roundYearOnly is this round's actually-resolved
  // value (from host_round_start), not the settings-panel draft — those can
  // differ once a round's target is randomized rather than static for the
  // whole game.
  const isRace = usesRaceFlow(mode, roundYearOnly, party);
  const isYear = party ? party.format === 'year' : roundYearOnly;
  // Finale duelists or (for underdog rounds) the trailing player(s) — the
  // only ones actually guessing this round, if either applies.
  let restrictedNames: string[] | null = null;
  if (party?.finale) restrictedNames = party.duelists;
  else if (party?.event === 'underdog') restrictedNames = party.restricted;
  const nameSeparator = party?.finale ? ' vs ' : ' & ';
  const raceStatus = restrictedNames
    ? `${restrictedNames.join(nameSeparator)} - first correct wins`
    : `${answeredCount} / ${players.length} answered`;
  // Party mode gets its own aqua identity across the card (ring, tint, eq
  // bar) rather than falling through to race/classic's colors, since here
  // "mode" is the thing driving HeroTimer's ring gradient too — year rounds
  // still win out, since that's a guess-target distinction orthogonal to mode.
  const accent: 'classic' | 'race' | 'year' | 'party' = isYear ? 'year' : mode === 'party' ? 'party' : roundAccent(isRace, isYear);
  const { compact, ultraCompact } = useRevealLayout();
  const tier: 'ultra' | 'compact' | 'normal' = ultraCompact ? 'ultra' : compact ? 'compact' : 'normal';
  // The dial is the card's one dominant hero (much bigger than the old
  // "one block among several" size); everything else — the now-playing icon,
  // the guesser caption, the bid chips — is deliberately small supporting
  // chrome around it instead of equal-weight stacked sections.
  const cardWidth = { ultra: 'min(78vw, 380px)', compact: 'min(76vw, 460px)', normal: 'min(68vw, 560px)' }[tier];
  const cardHeight = { ultra: '290px', compact: '400px', normal: '540px' }[tier];
  const innerWidth = { ultra: 'min(64vw, 300px)', compact: 'min(62vw, 360px)', normal: 'min(54vw, 420px)' }[tier];
  const timerSize = { ultra: 100, compact: 172, normal: 244 }[tier];
  const iconSize = { ultra: 14, compact: 16, normal: 18 }[tier];
  const captionSize = { ultra: '0.85rem', compact: '1rem', normal: '1.15rem' }[tier];
  return (
    <div className="relative min-h-screen screen-center-safe flex flex-col items-center justify-center p-6 gap-5 text-center overflow-x-hidden overflow-y-auto overscroll-contain">
      <img src={`${import.meta.env.BASE_URL}backgrounds/background4.svg`} alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, filter: 'blur(36px)', transform: 'scale(1.04)' }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)' }} />
      <div className="flex flex-col items-center gap-5 text-center w-full" style={{ position: 'relative', zIndex: 2 }}>
        <p className="text-white/50 text-sm" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>Round {roundIndex + 1}/{totalRounds}</p>
        <PartyBadge party={party} />
        <RaceHintBar hints={hints} />

        <div
          className={`liquid-btn host-game-card relative ${ACCENT_TINT_CLASS[accent]}`}
          style={{
            width: cardWidth, height: cardHeight,
            animationName: songPlaying ? ACCENT_GLOW_ANIMATION[accent] : undefined,
            animationDuration: '4.2s', animationTimingFunction: 'ease-in-out', animationIterationCount: 'infinite',
          }}
        >
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding="28px 28px"
          >
            <div style={{ position: 'relative', width: innerWidth }}>
              <div aria-hidden="true" style={{ position: 'absolute', inset: '-28px', borderRadius: '20px', zIndex: 0, pointerEvents: 'none', background: ACCENT_WASH[accent] }} />
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
                {countdown === null ? (
                  <>
                    <EyebrowRow label="Now playing" accent={accent} songPlaying={songPlaying} songTempo={songTempo} size={iconSize} />
                    <HeroTimer timeLeft={timeLeft} total={timerTotal} size={timerSize} mode={mode} />
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600, fontSize: captionSize, display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                      {isRace ? raceStatus : `${guesserNames.join(' & ')} will guess`}
                    </span>
                    {!isRace && <BidChipRow bids={playerBids} lowestBid={lowestBid} />}
                  </>
                ) : (
                  <>
                    <EyebrowRow label="Get ready" accent={accent} songPlaying={songPlaying} songTempo={songTempo} size={iconSize} />
                    <div className="text-8xl font-black text-white" style={{ animation: 'badgeBreathe 1s ease-in-out infinite' }}>{countdown}</div>
                    {isRace ? (
                      <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600, fontSize: captionSize, display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                        {restrictedNames ? restrictedNames.join(nameSeparator) : 'Everyone will guess'}
                      </span>
                    ) : (
                      <>
                        <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600, fontSize: captionSize, display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                          {guesserNames.join(' & ')} will guess
                        </span>
                        <BidChipRow bids={playerBids} lowestBid={lowestBid} />
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </LiquidGlass>
        </div>

        {spotify.playbackError && (
          <p className="max-w-sm text-center text-red-300 text-sm" aria-live="assertive">
            {spotify.playbackError}
          </p>
        )}

        <div className="flex flex-col items-center gap-2 mt-2">
          <button type="button" onClick={skipTurn} className="text-white/20 text-xs hover:text-white/35 transition-colors">
            Skip round
          </button>
          <EndGameButton endGame={endGame} />
        </div>
      </div>
    </div>
  );
}

export function GuessingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, guesserNames, lowestBid, playerBids, timeLeft, timerTotal, mode, roundYearOnly, hints, party, skipTurn, endGame } = game;
  // roundYearOnly is this round's resolved value, not the settings-panel
  // draft — see PlayingView's comment above for why that distinction matters.
  const isRace = mode === 'race' || (party === null && roundYearOnly) || (party !== null && party.format !== 'classic');
  const isYear = party ? party.format === 'year' : roundYearOnly;
  const accent = roundAccent(isRace, isYear);
  // Bidders who placed a bid this round but aren't in the current tier —
  // if everyone bid the same (or there's only one player), there's no one
  // else left waiting on a later turn.
  const othersWaiting = playerBids.length > guesserNames.length;
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-6 gap-5 text-center overflow-hidden">
      <img src={`${import.meta.env.BASE_URL}backgrounds/background4.svg`} alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(36px)' }} />
      <div className="flex flex-col items-center gap-5 text-center w-full" style={{ position: 'relative', zIndex: 2 }}>
        <p className="text-white/45 text-sm">Round {roundIndex + 1}/{totalRounds}</p>
        <PartyBadge party={party} />
        <RaceHintBar hints={hints} />

        <div className="liquid-btn relative" style={{ width: '310px', height: '420px' }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding="28px 28px"
          >
            <div style={{ width: '254px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              {/* Audio is always paused by the time this view mounts (guessing_start pauses it). */}
              <AudioBars playing={false} accent={accent} height={32} />
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                Guessing
              </span>
              <span style={{ color: 'white', fontWeight: 900, fontSize: '1.4rem', lineHeight: 1.3, display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                {guesserNames.join(' & ')}
              </span>
              <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.07)' }} />
              <CircularTimer timeLeft={timeLeft} total={timerTotal} size={90} />
              <div className="w-full">
                <BidTimeline bids={playerBids} lowestBid={lowestBid} />
              </div>
            </div>
          </LiquidGlass>
        </div>

        {othersWaiting && <p className="text-white/45 text-sm">Other players are waiting...</p>}
        <div className="flex flex-col items-center gap-2 mt-2">
          <button type="button" onClick={skipTurn} className="text-white/28 text-xs hover:text-white/50 transition-colors">
            Skip turn
          </button>
          <EndGameButton endGame={endGame} />
        </div>
      </div>
    </div>
  );
}
