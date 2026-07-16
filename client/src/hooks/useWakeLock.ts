import { useEffect } from 'react';

// Keeps the screen from auto-locking/dimming while a game is active — on
// iOS Safari (16.4+) the screen otherwise goes dark mid-round and players
// miss the reveal. The lock is released by the OS whenever the tab loses
// visibility (e.g. app-switch), so we re-acquire on visibilitychange.
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Refused (low battery, backgrounded, unsupported) — nothing to do.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !sentinel) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release();
    };
  }, [active]);
}
