import type { PartyInfo } from '../../types';

// What this round wants answered: party rounds carry it per-round, classic/
// race games use the game-wide artist/year toggles.
export type GuessTarget = 'title' | 'artist' | 'both' | 'year';
export function resolveTarget(party: PartyInfo | null, artistOnly: boolean, yearOnly: boolean): GuessTarget {
  if (party) return party.format === 'year' || party.target === 'year' ? 'year' : party.target;
  if (yearOnly) return 'year';
  return artistOnly ? 'artist' : 'title';
}

// Same pill style as PartyBadge's target bit, so a plain classic/race round
// (no party recipe, just the artist/year toggle) still gets an explicit,
// equally visible answer to "what am I about to guess" before the guessing
// screen — previously only party rounds got this via PartyBadge.
export function TargetChip({ target }: Readonly<{ target: GuessTarget }>) {
  const text = {
    title: 'NAME THE SONG',
    artist: 'NAME THE ARTIST',
    both: 'TITLE + ARTIST',
    year: 'GUESS THE YEAR',
  }[target];
  return (
    <span style={{
      padding: '4px 12px', borderRadius: '100px',
      background: 'rgba(0,238,232,0.1)',
      border: '1px solid rgba(0,238,232,0.3)',
      color: 'rgba(94,234,212,0.9)',
      fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em',
      whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}
