// Shared sizing primitives for every squeeze-aware reveal card — RevealShared.tsx
// (classic got-it/no-one-got-it/final-answer cards) and YearReveal.tsx (the
// guess-the-year cards) both need these, so they live here rather than in
// either file to avoid a circular import between the two.

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
