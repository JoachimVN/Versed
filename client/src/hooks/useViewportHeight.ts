import { useEffect } from 'react';

/**
 * Tracks the visible viewport height (shrinking when a mobile keyboard opens)
 * and exposes it as the --app-height CSS variable, so full-screen layouts can
 * reflow around the keyboard instead of being covered by it.
 */
export function useViewportHeight() {
  useEffect(() => {
    let inputFocused = false;

    const setHeight = (height: number) => {
      document.documentElement.style.setProperty('--app-height', `${height}px`);
    };

    const applyVisualViewport = () => {
      setHeight(window.visualViewport?.height ?? window.innerHeight);
    };

    // Only trust visualViewport while an input is focused (keyboard is
    // meant to be open). iOS fires its resize event promptly when the
    // keyboard opens, but fires a stale/trailing one well after the dismiss
    // animation finishes — without this guard that trailing event causes a
    // second, redundant rescale right after the blur-triggered reset below.
    const handleVisualViewportResize = () => {
      if (inputFocused) applyVisualViewport();
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        inputFocused = true;
        applyVisualViewport();
      }
    };

    const handleFocusOut = () => {
      inputFocused = false;
      setHeight(window.innerHeight);
    };

    setHeight(window.innerHeight);

    window.visualViewport?.addEventListener('resize', handleVisualViewportResize);
    window.addEventListener('resize', applyVisualViewport);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleVisualViewportResize);
      window.removeEventListener('resize', applyVisualViewport);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);
}
