// Shared sizing primitives for every squeeze-aware reveal card — RevealShared.tsx
// (classic got-it/no-one-got-it/final-answer cards) and YearReveal.tsx (the
// guess-the-year cards) both need these, so they live here rather than in
// either file to avoid a circular import between the two.

import { useEffect, useState } from 'react';

// Reveal cards are centered inside a fixed-height box rather than sized to
// their own content (see host/RevealView.tsx's `.liquid-btn` wrapper), so a
// squeeze tier that shrinks a card's content without shrinking its declared
// height in lockstep would leave the card floating off-center inside dead
// space — or, shrunk the other way, overlapping the row below it. Every
// squeeze-aware piece takes the same flags so callers size the box to match.
// landscape is optional because most callers (PillButton, the card labels)
// don't care about it — only the tightest layouts (SongInfo, YearSongFooter)
// do, laying cover art beside the text instead of above it to spend a
// landscape phone's abundant width instead of its scarce height.
export type CardSqueeze = { compact: boolean; ultraCompact: boolean; landscape?: boolean };

// The card content column's own width cap, independent of the glass card's
// outer width (see computeCardWidth in host/RevealView.tsx) — widened at
// ultraCompact so a combined title/artist/year line has real room to sit on
// one or two lines instead of wrapping hard into a narrow 262px column purely
// because that's normal/compact's aesthetic width, not an actual constraint
// at this squeeze. Landscape gets the most: its row layout (cover beside
// text) needs the width most, and it's the one axis landscape actually has
// to spare.
export function cardContentWidth(squeeze?: CardSqueeze): string {
  const { ultraCompact = false, landscape = false } = squeeze ?? {};
  if (ultraCompact && landscape) return 'min(420px, calc(100vw - 48px))';
  if (ultraCompact) return 'min(300px, calc(100vw - 56px))';
  return 'min(262px, calc(100vw - 96px))';
}

// Both reveal screens (host's RevealView and the player's) size their squeeze
// tier off raw window height — host has no keyboard to reserve room for
// (host-only, no text input), and the player screen's reveal has no input
// either (the guess itself already happened on the guessing screen), so both
// can share the same plain height-based measurement instead of each growing
// their own copy. Deliberately conservative: a maximized browser on an
// ordinary laptop display (e.g. a 1440x900 MacBook) still reports an
// innerHeight comfortably above COMPACT_HEIGHT_PX — browser chrome (tabs/URL
// bar) rarely eats more than ~100px — so an everyday desktop view stays on
// the untouched "normal" tier.
export const COMPACT_HEIGHT_PX = 760;
export const ULTRA_COMPACT_HEIGHT_PX = 690;

// Carries the raw height alongside the tier flags so callers can size
// something (e.g. a capped scroll list) off exactly how much room the rest of
// the tier's chrome actually leaves, instead of getting their own separate
// height thresholds that could drift out of sync with the tier's real cost.
export type RevealLayout = CardSqueeze & { windowHeight: number };

// scale is the caller's host/player zoom factor (useHostScaleValue /
// usePlayerScaleValue, default 1 off the desktop/phone baseline where it
// never binds). Both shells render their content through a CSS `zoom`, which
// inflates every px value declared here by that same factor without
// window.innerHeight ever reflecting it — dividing it back out here mirrors
// how --host-app-height/--player-app-height already correct for it on the
// CSS side (see useHostScale.tsx's comment on the div-by-self cycle this
// sidesteps). Skipping the division let a large-scale desktop window (2.5k+
// tall, scale > 1) measure raw innerHeight as if it were still the tightest
// "normal" tier's roomy baseline, so the tier thresholds below never
// engaged even though the real post-zoom space left for content was far
// smaller — silently overflowing the score box's last line or two off the
// bottom of the screen.
export function useRevealLayout(scale = 1): RevealLayout {
  const measure = (): RevealLayout => {
    const h = typeof window !== 'undefined' ? window.innerHeight / scale : Infinity;
    const w = typeof window !== 'undefined' ? window.innerWidth / scale : 0;
    return { compact: h < COMPACT_HEIGHT_PX, ultraCompact: h < ULTRA_COMPACT_HEIGHT_PX, landscape: w > h, windowHeight: h };
  };
  const [layout, setLayout] = useState<RevealLayout>(measure);
  useEffect(() => {
    const check = () => setLayout(measure());
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);
  return layout;
}

// Mirrors the fixed pixel budget SongInfo/GotItCardContent/etc. actually
// render at each tier (icon circle + label + divider + cover art + title/
// artist/year, plus the card's own padding) — recalibrate both together if
// either drifts. The classic (non-year) reveal cards are centered inside a
// fixed-height box rather than sized to their own content (see the
// `.liquid-btn` wrapper in both RevealView.tsx files), so a squeeze tier that
// shrinks a card's content without shrinking its declared height in lockstep
// would leave the card floating off-center inside dead space — or, shrunk the
// other way, overlapping whatever renders below it.
export function computeCardHeight(hasCover: boolean, squeeze: CardSqueeze): number {
  // ultraCompact folds title/artist/year onto one line (see SongInfo), so
  // its budget is well below a straight-line interpolation from compact's.
  // Budgeted for that combined line wrapping to two — it doesn't always fit
  // on one at the card's narrowest width (280px viewport, e.g. iOS's
  // "Zoomed" display setting), and the card is centered inside this
  // fixed-height box rather than sized to its own content, so
  // under-budgeting here overlaps the card's own border instead of just
  // wasting space. normal/compact no longer carry a leading icon-circle row
  // (GotItCardContent/NoOneGotItCardContent dropped it — the label text
  // right below already said the same thing), which is what these two
  // tiers' numbers are lighter than a straight normal/compact split would
  // suggest; ultraCompact never rendered that row so its own numbers are
  // unchanged.
  if (hasCover) {
    // Landscape's row layout (cover beside the text) caps the row's own
    // height at the cover art's, since the text column has far more width
    // to wrap into there than portrait's centered layout does — computeCardWidth's
    // widened landscape card is what actually keeps that column wide enough
    // to hold at one line most of the time; this still carries a margin for
    // when it doesn't.
    if (squeeze.ultraCompact && squeeze.landscape) return 165;
    return squeeze.ultraCompact ? 264 : squeeze.compact ? 348 : 418;
  }
  return squeeze.ultraCompact ? 149 : squeeze.compact ? 153 : 178;
}

// The glass card's own outer width — widened at ultraCompact to match
// cardContentWidth above (the inner content column), since widening one
// without the other just wastes the extra room on padding. Landscape gets
// the most: it has width to spare precisely because height is what's scarce
// there, unlike portrait where both axes are tight.
export function computeCardWidth(squeeze: CardSqueeze, wide: boolean): string {
  if (wide) {
    if (squeeze.ultraCompact && squeeze.landscape) return 'min(94vw, 480px)';
    if (squeeze.ultraCompact) return 'min(92vw, 340px)';
    return 'min(88vw, 366px)';
  }
  if (squeeze.ultraCompact && squeeze.landscape) return 'min(94vw, 450px)';
  if (squeeze.ultraCompact) return 'min(94vw, 340px)';
  return 'min(92vw, 310px)';
}
