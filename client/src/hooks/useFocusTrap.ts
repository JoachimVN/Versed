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
    (first ?? container).focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const lastIndex = items.length - 1;
      const nextIndex = e.shiftKey
        ? (currentIndex <= 0 ? lastIndex : currentIndex - 1)
        : (currentIndex === lastIndex ? 0 : currentIndex + 1);
      e.preventDefault();
      items[nextIndex].focus();
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [active, containerRef]);
}
