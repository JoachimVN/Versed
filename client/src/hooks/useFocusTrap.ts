import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keeps Tab focus cycling within the container while active, moves focus
// into it on open, and restores focus to whatever was focused before it
// opened once it closes/unmounts. Shared by every modal-like overlay
// (settings panel, steal picker, game-expired dialog) so keyboard/screen
// reader users can't tab into the page behind them and don't lose their
// place when the overlay goes away.
export function useFocusTrap<T extends HTMLElement>(containerRef: React.RefObject<T | null>, active: boolean) {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusables()[0];
    const target = first ?? container;
    // This focus() call happens in an effect, decoupled from whatever click
    // opened the overlay, so Chromium can't tell it apart from a real
    // keyboard-driven focus and paints a :focus-visible ring even when the
    // overlay was opened with a mouse. Suppress just that one ring, and drop
    // the suppression the moment real keyboard nav (Tab) happens so it still
    // shows up for actual keyboard users tabbing inside the trap.
    target.classList.add('suppress-focus-ring');
    target.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      target.classList.remove('suppress-focus-ring');
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const lastIndex = items.length - 1;
      let nextIndex: number;
      if (e.shiftKey) {
        nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
      } else {
        nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
      }
      e.preventDefault();
      items[nextIndex].focus();
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      target.classList.remove('suppress-focus-ring');
      previouslyFocused.current?.focus?.();
    };
  }, [active, containerRef]);
}
