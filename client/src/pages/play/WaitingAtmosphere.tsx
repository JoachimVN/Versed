import { useEffect, useLayoutEffect } from 'react';
import {
  restoreConfettiField,
  setConfettiRespawning,
  setConfettiSpeedTarget,
} from '../../components/ConfettiBackground';
import { useLogoMorph } from '../../contexts/LogoMorph';
import {
  setAmbientBackgroundMode,
  setHomeBackgroundTarget,
  setWaitingBackgroundTarget,
} from '../../utils/homeBackgroundTransition';

export function WaitingAtmosphere({ leaving }: Readonly<{ leaving: boolean }>) {
  const { reducedMotion } = useLogoMorph();

  // The artwork is app-level so it can sit below the same persistent
  // confetti canvas and purple spotlight used by Home and Join. Disable
  // particle recycling while Waiting is active: everything already visible
  // keeps falling, but nothing new is emitted at the top.
  // Keep the treatment on the shared surface so it can ease in and back out
  // as the player moves between Home and Waiting.
  useLayoutEffect(() => {
    setHomeBackgroundTarget(true, reducedMotion);
    setAmbientBackgroundMode(true, reducedMotion);
    // Burst on the join -> waiting hand-off, same as a route change, then
    // glide down to Waiting's resting speed.
    setConfettiSpeedTarget(4);
    setConfettiRespawning(false);
    const settleTimer = setTimeout(() => setConfettiSpeedTarget(1), 1000);

    return () => {
      clearTimeout(settleTimer);
      setAmbientBackgroundMode(false, reducedMotion);
      setConfettiRespawning(true);
    };
  }, [reducedMotion]);

  // The artwork itself still fades in beneath the already-treated confetti.
  useEffect(() => {
    setWaitingBackgroundTarget(true, reducedMotion);
    return () => setWaitingBackgroundTarget(false, reducedMotion);
  }, [reducedMotion]);

  useLayoutEffect(() => {
    if (!leaving) return;
    setWaitingBackgroundTarget(false, reducedMotion);
    setAmbientBackgroundMode(false, reducedMotion);
    restoreConfettiField();
  }, [leaving, reducedMotion]);

  return null;
}
