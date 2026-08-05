// computeYearCardHeight needs yearTimelineLaneCounts from YearReveal.tsx,
// which itself imports CardSqueeze/cardContentWidth from revealSqueeze.ts —
// living in either of those two files would create a cycle between them, so
// this (host and player reveal's shared consumer) sits on its own instead.
import type { RoundResultEvent } from '../types';
import type { CardSqueeze } from './revealSqueeze';
import { yearTimelineLaneCounts } from './YearReveal';

// Same idea as computeCardHeight in revealSqueeze.ts, but for the
// year-format cards (YearTimelineContent's timeline, or the compact
// year-only reveal rendered via FinalRoundAnswerContent) — the slot-reel
// heading and timeline markers don't cost the same budget as SongInfo's
// stacked lines, so they get their own tiers rather than reusing
// computeCardHeight's numbers.
//
// `result` is null for the final-round card (FinalRoundAnswerContent's
// yearOnly branch never renders the chart, just the heading+footer) — that
// always gets the no-chart tiers below. For the mid-round card, `showsChart`
// mirrors YearTimelineContent's own fallback condition exactly (no guess
// data, or the ultraCompact+landscape squeeze that can't fit the chart
// alongside whatever renders below it — see that component), so this budget
// always matches whichever content it actually decided to render.
//
// StableLiquidGlass measures its own content and centers it inside this
// declared box — it doesn't clip to a short budget, it grows past the box
// equally top and bottom. So an undersized budget here doesn't just
// overflow harmlessly, it pushes the card upward into whatever's above it.
// The chart's own height varies with how many of a round's guesses land
// close enough to collide (see yearTimelineLaneCounts), which a single flat
// number per tier can't account for — hence adding that lane count's real
// cost on top of the base budget instead of guessing a margin.
export function computeYearCardHeight(hasCover: boolean, result: RoundResultEvent | null, squeeze: CardSqueeze): number {
  const { ultraCompact: ultra, compact, landscape } = squeeze;
  const hasGuessData = !!result?.year && (result.yearResults ?? []).some(r => r.guess !== null);
  const showsChart = hasGuessData && !(ultra && landscape);

  if (showsChart) {
    const { nameLanes, yearLanes } = yearTimelineLaneCounts(result!, squeeze);
    const laneExtra = nameLanes * (ultra ? 11 : 13) + yearLanes * (ultra ? 10 : 12);
    if (ultra) return (hasCover ? 340 : 300) + laneExtra;
    if (compact) return (hasCover ? 430 : 330) + laneExtra;
    return (hasCover ? 500 : 380) + laneExtra;
  }
  if (ultra && landscape) return hasCover ? 190 : 160;
  if (ultra) return hasCover ? 260 : 220;
  if (compact) return hasCover ? 300 : 260;
  return hasCover ? 360 : 320;
}
