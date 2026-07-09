// Shared LiquidGlass prop presets — the "card" and "pill" looks are reused
// verbatim across Host.tsx and Play.tsx; centralizing them keeps the values
// in sync and avoids repeating the same six props at every call site.
export const LIQUID_CARD_PROPS = {
  displacementScale: 55,
  blurAmount: 0.06,
  saturation: 130,
  aberrationIntensity: 1.5,
  elasticity: 0.08,
  cornerRadius: 20,
} as const;

export const LIQUID_PILL_PROPS = {
  displacementScale: 64,
  blurAmount: 0.05,
  saturation: 130,
  aberrationIntensity: 2,
  elasticity: 0.12,
  cornerRadius: 100,
  padding: '18px 36px',
} as const;

// Circular "record label" look (Play's waiting-room vinyl card) — same glass
// character as LIQUID_CARD_PROPS, but cornerRadius is pinned to the
// library's own "always circular" default (999 — browsers clamp
// border-radius to 50% of the box regardless of the px value requested) so
// it stays a true circle at any of that card's responsive sizes, not just
// the one size it happened to be authored against.
export const LIQUID_LABEL_PROPS = {
  displacementScale: 55,
  // Sits directly over the sharp, high-contrast spinning vinyl (not the
  // already-blurred page background CARD/PILL sit over), so a much higher
  // blur is needed to read as frosted glass rather than a window straight
  // onto the grooves.
  blurAmount: 0.22,
  saturation: 130,
  aberrationIntensity: 1.5,
  elasticity: 0.08,
  cornerRadius: 999,
} as const;
