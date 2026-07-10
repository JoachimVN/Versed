// Home's complete ambient background is rendered by App, outside individual
// routes. Moving the whole composited layer keeps its confetti, spotlight,
// dark overlay, and blur synchronized during phase transitions.
export function setHomeBackgroundTarget(visible: boolean, foreground: boolean, immediate = false) {
  const root = document.documentElement;
  if (immediate) root.style.setProperty('--home-background-fade-duration', '0ms');
  root.style.setProperty('--home-background-opacity', visible ? '1' : '0');
  root.style.setProperty('--home-background-z-index', foreground ? '1' : '0');
  if (immediate) {
    requestAnimationFrame(() => {
      root.style.setProperty('--home-background-fade-duration', '1s');
    });
  }
}
