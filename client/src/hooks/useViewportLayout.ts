import { useEffect, useState } from 'react';

// Below this, a gap between the layout viewport and the visual viewport is
// browser chrome settling or a rounding difference — not an on-screen
// keyboard. No keyboard is anywhere near this short.
const KEYBOARD_MIN_HEIGHT = 80;

export function readKeyboardInset() {
  const vv = window.visualViewport;
  // While pinch-zoomed the visual viewport is smaller for reasons that have
  // nothing to do with a keyboard, so don't read one into it.
  if (!vv || vv.scale > 1.01) return 0;
  const covered = window.innerHeight - vv.height;
  return covered > KEYBOARD_MIN_HEIGHT ? Math.round(covered) : 0;
}

/**
 * Publishes the two CSS variables every full-screen layout is built on:
 *
 * --app-height     the app shell's height
 * --keyboard-inset how much of the shell's bottom an on-screen keyboard covers
 *                  (always 0 on Android, see below)
 *
 * The split is the whole point. --app-height deliberately tracks
 * window.innerHeight, *not* visualViewport.height: on iOS the keyboard
 * doesn't change innerHeight, so the shell keeps a constant size and no
 * screen ever rescales while a keyboard opens or closes. Screens that need
 * to get out of the keyboard's way opt in locally via --keyboard-inset
 * instead of the whole app reflowing around them.
 *
 * On Android (interactive-widget=resizes-content, see index.html) the
 * keyboard shrinks the layout viewport itself, so --app-height shrinks with
 * it and --keyboard-inset stays 0 — the content is already clear of the
 * keyboard, and the same CSS is correct on both platforms without branching.
 */
export function useViewportLayout() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const syncHeight = () => {
      root.style.setProperty('--app-height', `${window.innerHeight}px`);
    };

    const syncInset = () => {
      root.style.setProperty('--keyboard-inset', `${readKeyboardInset()}px`);
    };

    syncHeight();
    syncInset();

    // window resize fires for orientation/chrome changes and, on Android,
    // for the keyboard; visualViewport resize fires for the iOS keyboard.
    // Note: visualViewport's *scroll* event is deliberately not listened to.
    // It fires while the user drags inside a scroll container with the
    // keyboard up, and reacting to it re-lays out the page mid-drag, which
    // feeds back into more scroll events — the layouts below are built to fit
    // above the keyboard so that Safari never needs to scroll in the first
    // place.
    window.addEventListener('resize', syncHeight);
    vv?.addEventListener('resize', syncInset);

    return () => {
      window.removeEventListener('resize', syncHeight);
      vv?.removeEventListener('resize', syncInset);
    };
  }, []);
}

/**
 * Keeps an element glued to the visible viewport, matching what iOS does to
 * position: fixed elements on its own.
 *
 * With a keyboard up, iOS lets the user drag the visual viewport around
 * inside the layout viewport — a browser gesture, not a scroll, so there's no
 * overflow setting that turns it off. The content shell is position: fixed
 * and rides along with it; the background layers are positioned against the
 * document and don't, so a drag slides the app off the bottom edge of the
 * confetti and onto flat body colour. Re-applying visualViewport.offsetTop to
 * the background closes that gap.
 *
 * Written straight to the element's transform rather than through a CSS
 * variable on :root, and coalesced to one write per frame: transforms are
 * compositor-only, so this can't feed back into the drag the way anything
 * that triggers layout would.
 */
export function useVisualViewportAnchor(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      if (ref.current) ref.current.style.transform = `translate3d(0, ${Math.round(vv.offsetTop)}px, 0)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener('scroll', schedule);
    vv.addEventListener('resize', schedule);

    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('scroll', schedule);
      vv.removeEventListener('resize', schedule);
    };
  }, [ref]);
}

/**
 * True while an on-screen keyboard is up (or about to be), so a layout can
 * shed anything it can't afford to show alongside one.
 *
 * Driven by focus rather than by measuring the viewport, for two reasons: it
 * flips the instant the field is tapped, so a layout compacts in the same
 * beat as the keyboard sliding up instead of lurching a moment later; and it
 * reads identically on iOS and Android, where the keyboard's effect on the
 * two viewports is completely different. The coarse-pointer check is what
 * keeps it false on desktop, which focuses inputs without any keyboard.
 */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;

    const isTextField = (el: EventTarget | null) =>
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

    let frame = 0;
    const onFocusIn = (e: FocusEvent) => {
      cancelAnimationFrame(frame);
      if (isTextField(e.target)) setOpen(true);
    };
    // Deferred by a frame so moving between two fields (the PIN box to the
    // name box) doesn't blink the layout back open in the gap between the
    // focusout and the focusin that immediately follows it.
    const onFocusOut = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setOpen(isTextField(document.activeElement)));
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return open;
}
