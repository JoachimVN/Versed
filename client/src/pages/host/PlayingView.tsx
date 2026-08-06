import LiquidGlass from '../../components/StableLiquidGlass';
import { PartyBadge } from '../../components/RoundIntro';
import { CircularTimer, HeroTimer } from '../../components/CircularTimer';
import { AudioBars, ACCENT_TINT_CLASS, ACCENT_WASH, ACCENT_GLOW_ANIMATION } from '../../components/AudioBars';
import { LIQUID_CARD_PROPS } from '../../components/liquidGlassPresets';
import { useRevealLayout } from '../../components/revealSqueeze';
import type { HostState } from './useHostGame';
import { roundAccent, usesRaceFlow, RaceHintBar } from './roundBits';
import { EndGameButton } from './dialogs';
import { BID_OPTIONS } from '../../config';

// Bid display shared by PlayingView and GuessingView: a genuine relative
// timeline, positioned against the fixed BID_OPTIONS ladder rather than
// today's own min/max — the old design rescaled to fill 8%-92% every round
// regardless of the actual spread, so a 2s/5s pair and a 2s/60s pair looked
// identically spaced and "relative" was a lie. Anchoring to the ladder's own
// index means the same bid always lands in the same spot, and the ladder's
// own steps (0.1, 0.5, 1, 2, 3... 45, 60) are already spaced the way people
// intuit duration — small gaps low, big gaps high — so nothing needs its own
// log/sqrt curve on top.
const TIMELINE_MAX_NAMES = 3;
const TIMELINE_PAD_PCT = 6;
// Dots are pinned to this exact y (via their own transform) rather than
// falling out of flex-stacking a variable-height label above/below them —
// a longer name used to push its dot a few px off the rail; anchoring both
// the dot and the label to this one fixed point keeps every dot dead-center
// on the rail regardless of label length.
const TIMELINE_HEIGHT = 56;
const TIMELINE_RAIL_Y = 28;
const TIMELINE_GAP = 8;

function bidTimelinePosition(bid: number): number {
  let idx = BID_OPTIONS.indexOf(bid);
  if (idx === -1) {
    // Shouldn't happen (bids always come off the ladder) — fall back to the closest step.
    idx = BID_OPTIONS.reduce((best, opt, i) => Math.abs(opt - bid) < Math.abs(BID_OPTIONS[best] - bid) ? i : best, 0);
  }
  return TIMELINE_PAD_PCT + (idx / (BID_OPTIONS.length - 1)) * (100 - TIMELINE_PAD_PCT * 2);
}

export function BidTimeline({ bids, lowestBid }: Readonly<{ bids: { name: string; bid: number }[]; lowestBid: number }>) {
  if (bids.length === 0) return null;
  const sorted = [...bids].sort((a, b) => a.bid - b.bid);

  // Group players by bid so ties share one marker instead of stacking.
  const groups: { bid: number; names: string[] }[] = [];
  for (const { name, bid } of sorted) {
    const last = groups.at(-1);
    if (last?.bid === bid) last.names.push(name);
    else groups.push({ bid, names: [name] });
  }

  return (
    <div className="relative w-full" style={{ height: `${TIMELINE_HEIGHT}px` }}>
      {/* The rail itself — a soft gradient track, not a hard line, so it reads as a scale rather than a divider. */}
      <div
        aria-hidden="true"
        className="absolute rounded-full"
        style={{ left: 0, right: 0, top: `${TIMELINE_RAIL_Y}px`, height: '3px', transform: 'translateY(-50%)', background: 'linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.18), rgba(255,255,255,0.05))' }}
      />
      {groups.map((group, i) => {
        const active = group.bid === lowestBid;
        const left = bidTimelinePosition(group.bid);
        // Alternate the label above/below the rail so adjacent close-together
        // ladder steps don't overlap each other's text.
        const above = i % 2 === 0;
        const names = group.names.slice(0, TIMELINE_MAX_NAMES).join(', ')
          + (group.names.length > TIMELINE_MAX_NAMES ? ` +${group.names.length - TIMELINE_MAX_NAMES}` : '');
        return (
          <div key={group.bid} className="absolute" style={{ left: `${left}%`, top: 0, bottom: 0 }}>
            {/* Pinned to the rail's exact center via its own transform, independent
                of the label's height, so a longer/shorter name never nudges the dot
                off the line the way stacking it in flex flow with the label did. */}
            <div
              className="absolute rounded-full -translate-x-1/2 -translate-y-1/2"
              style={{
                left: 0, top: `${TIMELINE_RAIL_Y}px`,
                width: active ? '13px' : '8px', height: active ? '13px' : '8px',
                background: active ? '#c084fc' : 'rgba(255,255,255,0.45)',
                boxShadow: active ? '0 0 12px rgba(192,132,252,0.85)' : undefined,
                border: active ? '2px solid rgba(255,255,255,0.9)' : undefined,
              }}
            />
            <div
              className="absolute -translate-x-1/2"
              style={above
                ? { left: 0, bottom: `${TIMELINE_HEIGHT - TIMELINE_RAIL_Y + TIMELINE_GAP}px` }
                : { left: 0, top: `${TIMELINE_RAIL_Y + TIMELINE_GAP}px` }}
            >
              <TimelineLabel active={active} bid={group.bid} names={names} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineLabel({ active, bid, names }: Readonly<{ active: boolean; bid: number; names: string }>) {
  return (
    <div className="flex flex-col items-center" style={{ gap: '1px' }}>
      <span style={{ fontSize: active ? '0.78rem' : '0.68rem', fontWeight: 700, whiteSpace: 'nowrap', color: active ? '#fff' : 'rgba(255,255,255,0.55)' }}>
        {names}
      </span>
      <span style={{ fontSize: active ? '0.72rem' : '0.62rem', fontWeight: 900, whiteSpace: 'nowrap', color: active ? '#d8a8f0' : 'rgba(255,255,255,0.4)' }}>
        {bid}s
      </span>
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
  // bar) rather than falling through to race/classic's colors — year rounds
  // still win out over that, since target is a distinction orthogonal to
  // mode. This drives HeroTimer's ring gradient too (passed as `accent`),
  // so a year round rings cyan regardless of which underlying mode it rides.
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
                    <HeroTimer timeLeft={timeLeft} total={timerTotal} size={timerSize} accent={accent} />
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600, fontSize: captionSize, display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                      {isRace ? raceStatus : `${guesserNames.join(' & ')} will guess`}
                    </span>
                    {!isRace && <div className="w-full"><BidTimeline bids={playerBids} lowestBid={lowestBid} /></div>}
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
                        <div className="w-full"><BidTimeline bids={playerBids} lowestBid={lowestBid} /></div>
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
