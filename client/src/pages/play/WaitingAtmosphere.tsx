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
  // Apply the overlay treatment before the first hand-off frame. If this is
  // deferred to a passive effect (or animated in), the still-crisp Home
  // confetti flashes above Waiting for roughly half a second.
  useLayoutEffect(() => {
    setHomeBackgroundTarget(true, reducedMotion);
    setAmbientBackgroundMode(true, true);
    setConfettiSpeedTarget(1);
    setConfettiRespawning(false);

    return () => {
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
