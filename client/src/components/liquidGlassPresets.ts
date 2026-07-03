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
