import React from 'react';
import type { Hint, PartyInfo } from '../../types';
import type { HostState } from './useHostGame';

export function usesRaceFlow(mode: HostState['mode'], yearOnly: boolean, party: PartyInfo | null): boolean {
  if (mode === 'race') return true;
  if (party === null) return yearOnly;
  return party.format !== 'classic';
}

// Which brand accent a round reads as: year rounds get teal (matching
// Play.tsx), race/non-classic party rounds get orange, classic stays purple —
// except Party mode itself, which keeps its own teal identity even on a
// classic-format sub-round (which reads as 'classic' under isRace/isYear
// alone), so it stays consistent across every screen in the round rather
// than only wherever isRace happens to be true.
export function fullRoundAccent(mode: HostState['mode'], roundYearOnly: boolean, party: PartyInfo | null): 'classic' | 'race' | 'year' | 'party' {
  const isYear = party ? party.format === 'year' : roundYearOnly;
  if (isYear) return 'year';
  if (mode === 'party') return 'party';
  return usesRaceFlow(mode, roundYearOnly, party) ? 'race' : 'classic';
}

// Renders an album-art image hint, blurred as a teaser (per `hint.blurred`,
// server-driven) or clear (Underdog Boost's real, guaranteed assist) — the
// flag is explicit so this stays correct regardless of which screen/phase
// renders it, rather than each caller having to infer which case it is.
export function AlbumArtHint({ hint, size, radius }: Readonly<{ hint: Hint; size: number; radius: number }>) {
  if (!hint.imageUrl) return null;
  if (!hint.blurred) {
    return (
      <img
        src={hint.imageUrl} alt=""
        style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
      />
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', flexShrink: 0, boxShadow: '0 16px 40px rgba(0,0,0,0.7)', position: 'relative' }}>
      {/* Inner div extends 30px beyond all edges so blur has real pixels to sample at every boundary */}
      <div style={{ position: 'absolute', inset: -30, filter: 'blur(8px) brightness(0.6)' }}>
        <img
          src={hint.imageUrl} alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    </div>
  );
}

// Race-flow rounds are normally hint-free (the clip itself is the puzzle),
// but artist-only/year-only rounds, Underdog Boost, and classic-flow art
// hints that carry into the playing/guessing phases are the exceptions.
// Whether the art hint shows blurred or clear is driven entirely by
// `hint.blurred` (server-set), not by which round type this is.
export function RaceHintBar({ hints }: Readonly<{ hints: Hint[] }>) {
  const imageHint = hints.find(h => h.imageUrl);
  const textHints = hints.filter(h => !h.imageUrl);
  if (textHints.length === 0 && !imageHint) return null;
  return (
    <div className="flex flex-col items-center gap-3">
      {imageHint?.imageUrl && <AlbumArtHint hint={imageHint} size={96} radius={16} />}
      {textHints.length > 0 && (
        <div
          className="flex items-center justify-center gap-6 rounded-2xl"
          style={{
            padding: '12px 26px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(16px)',
          }}
        >
          {textHints.map((h, i) => (
            <React.Fragment key={h.label}>
              {i > 0 && (
                <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)' }} />
              )}
              <div className="flex flex-col items-center gap-1">
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
                  {h.label}
                </span>
                <span style={{ color: 'white', fontWeight: 800, fontSize: '1.2rem', lineHeight: 1 }}>
                  {h.value}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

