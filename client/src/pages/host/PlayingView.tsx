import LiquidGlass from '../../components/StableLiquidGlass';
import { PartyBadge } from '../../components/RoundIntro';
import { CircularTimer } from '../../components/CircularTimer';
import { AudioBars } from '../../components/AudioBars';
import { LIQUID_CARD_PROPS } from '../../components/liquidGlassPresets';
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

export function PlayingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, countdown, guesserNames, lowestBid, playerBids, timeLeft, timerTotal, mode, roundYearOnly, hints, answeredCount, players, skipTurn, endGame, party, songPlaying, songTempo } = game;
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
  const accent = roundAccent(isRace, isYear);
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-6 gap-5 text-center overflow-hidden">
      <img src={`${import.meta.env.BASE_URL}background4.svg`} alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(36px)' }} />
      <div className="flex flex-col items-center gap-5 text-center w-full" style={{ position: 'relative', zIndex: 2 }}>
        <p className="text-white/45 text-sm">Round {roundIndex + 1}/{totalRounds}</p>
        <PartyBadge party={party} />
        <RaceHintBar hints={hints} />

        <div className="liquid-btn relative" style={{ width: 'min(77vw, 527px)', height: countdown === null ? '340px' : '306px' }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding="28px 28px"
          >
            <div style={{ width: 'min(71vw, 479px)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              {countdown === null ? (
                <>
                  <AudioBars playing={songPlaying} accent={accent} height={36} bpm={songTempo} />
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                    {isRace ? raceStatus : `${guesserNames.join(' & ')} will guess`}
                  </span>
                  <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.07)' }} />
                  <CircularTimer timeLeft={timeLeft} total={timerTotal} size={90} />
                  {!isRace && (
                    <div className="w-full">
                      <BidTimeline bids={playerBids} lowestBid={lowestBid} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                    Get ready
                  </span>
                  <div className="text-8xl font-black text-white" style={{ animation: 'badgeBreathe 1s ease-in-out infinite' }}>{countdown}</div>
                  <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.07)' }} />
                  {isRace ? (
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                      {restrictedNames ? restrictedNames.join(nameSeparator) : 'Everyone will guess'}
                    </span>
                  ) : (
                    <>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                        {guesserNames.join(' & ')} will guess
                      </span>
                      <div className="w-full">
                        <BidTimeline bids={playerBids} lowestBid={lowestBid} />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </LiquidGlass>
        </div>

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
      <img src={`${import.meta.env.BASE_URL}background4.svg`} alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
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
