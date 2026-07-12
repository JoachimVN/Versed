// Home's complete ambient background is rendered by App, outside individual
// routes. Moving the whole composited layer keeps its confetti, spotlight,
// dark overlay, and blur synchronized during phase transitions.
export function setHomeBackgroundTarget(visible: boolean, immediate = false) {
  const root = document.documentElement;
  if (immediate) root.style.setProperty('--home-background-fade-duration', '0ms');
  root.style.setProperty('--home-background-opacity', visible ? '1' : '0');
  if (immediate) {
    requestAnimationFrame(() => {
      root.style.setProperty('--home-background-fade-duration', '1s');
    });
  }
}

export function setWaitingBackgroundTarget(visible: boolean, immediate = false) {
  const root = document.documentElement;
  const fadeDuration = immediate ? '0ms' : visible ? '1s' : '500ms';
  root.style.setProperty('--waiting-background-fade-duration', fadeDuration);
  root.style.setProperty('--waiting-background-opacity', visible ? '1' : '0');
}

export function setAmbientBackgroundMode(waiting: boolean, immediate = false) {
  const root = document.documentElement;
  root.style.setProperty('--ambient-surface-duration', immediate ? '0ms' : '500ms');
  // Commit the disabled transition before changing any visual values. Without
  // this flush, browsers may batch both writes and animate with the previous
  // 500ms duration, briefly exposing crisp/undarkened confetti on entry.
  if (immediate) root.getBoundingClientRect();
  root.style.setProperty('--ambient-overlay-color', waiting ? 'rgba(5,5,14,0.70)' : 'rgba(8,8,18,0.7)');
  root.style.setProperty('--ambient-overlay-blur', waiting ? '40px' : '2px');
  root.style.setProperty('--ambient-overlay-webkit-blur', waiting ? '40px' : '6px');
  root.style.setProperty('--ambient-overlay-z-index', waiting ? '1' : '0');
  root.style.setProperty('--confetti-layer-z-index', waiting ? '2' : '0');
  root.style.setProperty('--confetti-layer-opacity', waiting ? '0.55' : '1');
  root.style.setProperty('--confetti-treatment-opacity', waiting ? '1' : '0');
  if (immediate) {
    requestAnimationFrame(() => {
      root.style.setProperty('--ambient-surface-duration', '500ms');
    });
  }
}
