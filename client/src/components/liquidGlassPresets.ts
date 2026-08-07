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

// Small always-on control chrome (the lobby's volume pill) rather than a CTA.
// Two deliberate departures from LIQUID_PILL_PROPS: displacement is dialled
// well down, because the refraction is drawn from the element's edges inward
// and what reads as a gentle bevel across a 310px button swallows something
// this short; and elasticity is off entirely, since the glass leaning toward
// the cursor is charming on a button you tap once and distracting on a slider
// you drag along.
export const LIQUID_CONTROL_PROPS = {
  displacementScale: 34,
  blurAmount: 0.025,
  saturation: 130,
  aberrationIntensity: 1.2,
  elasticity: 0,
  cornerRadius: 100,
  padding: '8px 16px',
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
  blurAmount: 0.48,
  saturation: 130,
  aberrationIntensity: 1.5,
  elasticity: 0.08,
  cornerRadius: 999,
} as const;

// Reveal's card has no round accent to key off (unlike PlayingView's
// ACCENT_TINT_CLASS/ACCENT_WASH, which pick per-mode colors) — this is a
// fixed cyan/purple pairing instead, echoing the same combo WaitingView's
// vinyl label already uses. glass-tint-reveal (index.css) recolors the ring
// itself so both hues reach the card's edge, not just a single accent tint;
// REVEAL_WASH is the matching interior glow, kept faint (0.06 peak) so it
// reads as ambient light rather than a colored panel.
export const REVEAL_TINT_CLASS = 'glass-tint-reveal';
export const REVEAL_WASH = 'radial-gradient(circle at 12% 88%, rgba(158,18,204,0.06) 0%, transparent 55%), radial-gradient(circle at 88% 12%, rgba(0,238,232,0.06) 0%, transparent 55%)';
