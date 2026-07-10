import { useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import type { PlayState } from './usePlayGame';

export type MorphRect = { top: number; left: number; width: number; height: number };
export type BeginMorph = (rect: MorphRect) => void;
export type ProvideTarget = (rect: MorphRect) => void;

// Shared by every logo-morph page transition (JoinView/WaitingView's back
// navigation): arms the overlay at this page's own logo, fades the rest of
// the content out, then resolves once that fade has had time to play so
// BackButton can navigate.
export function useMorphBack(
  logoRef: RefObject<HTMLImageElement | null>,
  setLeaving: (v: boolean) => void,
  beginMorph: BeginMorph,
  reducedMotion: boolean,
) {
  return useCallback(() => new Promise<void>(resolve => {
    if (reducedMotion) {
      resolve();
      return;
    }
    if (logoRef.current) {
      const r = logoRef.current.getBoundingClientRect();
      beginMorph({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    setLeaving(true);
    setTimeout(resolve, 320);
    // logoRef/setLeaving/beginMorph are all stable across renders (ref,
    // setState, and the memoized context value respectively).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [reducedMotion]);
}

// The transition was cancelled mid-flight (a server event reset the pending
// flag before the waiting-transition timer fired — e.g. the host
// disconnected during the handoff) — resolve the overlay in place instead
// of leaving it, and the shared `morphing` flag, stranded forever.
export function cancelPendingWaitingTransition(
  pageExitTimerRef: RefObject<ReturnType<typeof setTimeout> | null>,
  transitionTimerRef: RefObject<ReturnType<typeof setTimeout> | null>,
  logoRef: RefObject<HTMLImageElement | null>,
  setLeaving: (v: boolean) => void,
  provideTarget: ProvideTarget,
) {
  if (!pageExitTimerRef.current && !transitionTimerRef.current) return;
  if (pageExitTimerRef.current) clearTimeout(pageExitTimerRef.current);
  if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
  pageExitTimerRef.current = null;
  transitionTimerRef.current = null;
  setLeaving(false);
  if (logoRef.current) {
    const cur = logoRef.current.getBoundingClientRect();
    provideTarget({ top: cur.top, left: cur.left, width: cur.width, height: cur.height });
  }
}

// Forward counterpart of useMorphBack, specific to JoinView: once join_game
// (or a saved-session rejoin) has actually succeeded server-side, arm the
// same overlay/fade handoff so the logo carries continuously into the
// waiting card instead of two independent fades. completeWaitingTransition()
// is guarded to only ever move phase 'join' -> 'waiting', so it's safe to
// let this run even if a faster server event (e.g. an instant host start)
// has already moved the game on by the time the timer fires.
export function useWaitingTransitionMorph(
  game: PlayState,
  logoRef: RefObject<HTMLImageElement | null>,
  setLeaving: (v: boolean) => void,
  beginMorph: BeginMorph,
  provideTarget: ProvideTarget,
  reducedMotion: boolean,
) {
  const pageExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!game.waitingTransitionPending) return;
    if (reducedMotion || !logoRef.current) {
      game.completeWaitingTransition();
      return;
    }
    const r = logoRef.current.getBoundingClientRect();
    beginMorph({ top: r.top, left: r.left, width: r.width, height: r.height });
    // Match Waiting -> Home's choreography: start the background crossfade
    // first, then let the Join content leave during the final 320ms. This
    // keeps the source screen present while the destination settles beneath
    // it instead of cutting to an empty dark frame before Waiting mounts.
    pageExitTimerRef.current = setTimeout(() => {
      pageExitTimerRef.current = null;
      setLeaving(true);
    }, 180);
    transitionTimerRef.current = setTimeout(() => {
      transitionTimerRef.current = null;
      game.completeWaitingTransition();
    }, 500);
    return () => cancelPendingWaitingTransition(
      pageExitTimerRef,
      transitionTimerRef,
      logoRef,
      setLeaving,
      provideTarget,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.waitingTransitionPending]);
}

// Both page-morph screens drive their outermost class from the arrival mode
// captured at mount. Do not pass the live morphing flag here: when that flag
// turns false at landing, swapping to .page-enter would start its translate
// animation late and move the page out from under the settled logo overlay.
export function pageTransitionClass(leaving: boolean, arrivedViaMorph: boolean): string {
  if (leaving) return 'page-exit';
  return arrivedViaMorph ? 'page-enter-morph' : 'page-enter';
}
