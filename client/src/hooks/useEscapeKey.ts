import { useEffect } from 'react';

// Closes/dismisses whatever's open on Escape — shared by every overlay
// (settings panel, steal picker, game-expired dialog, round intro) so each
// one doesn't reimplement its own listener.
export function useEscapeKey(onEscape: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onEscape]);
}
