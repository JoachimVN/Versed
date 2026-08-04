import type { SyntheticEvent } from 'react';

export const BRAND_LOGO_SRC = `${import.meta.env.BASE_URL}branding/logo.png`;
const BRAND_LOGO_FALLBACK_SRC = `${import.meta.env.BASE_URL}branding/logo.svg`;

// iPhone Chrome uses WebKit. If WebKit declines the raster logo, retry with
// the much smaller vector mark instead of leaving a blank brand area.
export function showBrandLogoFallback(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  if (image.dataset.logoFallbackApplied) return;

  image.dataset.logoFallbackApplied = 'true';
  image.src = BRAND_LOGO_FALLBACK_SRC;
}
