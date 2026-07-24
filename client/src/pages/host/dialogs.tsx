import React, { useState, useEffect } from 'react';

// Discreet "End game" control with a two-tap confirm so a stray click can't
// nuke a running game. Jumps everyone to final scores.
export function EndGameButton({ endGame }: Readonly<{ endGame: () => void }>) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);
  return (
    <button
      type="button"
      onClick={() => { if (confirming) endGame(); else setConfirming(true); }}
      className="text-xs transition-colors"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: confirming ? 'rgba(248,113,113,0.9)' : 'rgba(255,255,255,0.28)',
      }}
      onMouseEnter={e => { if (!confirming) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)'; }}
      onMouseLeave={e => { if (!confirming) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.28)'; }}
    >
      {confirming ? 'Tap again to end the game' : 'End game'}
    </button>
  );
}

// Shared full-screen modal shell (opaque backdrop + radial glow) used by
// every dialog-style overlay — "Game expired," "Spotify account not
// authorized," etc. Callers supply just the card content.
export function FullScreenDialog({ ariaLabel, dialogRef, children }: Readonly<{
  ariaLabel: string;
  dialogRef?: React.RefObject<HTMLDialogElement | null>;
  children: React.ReactNode;
}>) {
  return (
    <dialog
      ref={dialogRef}
      open
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{
        width: '100%',
        height: '100%',
        margin: 0,
        border: 'none',
        padding: 0,
        color: 'inherit',
        background: 'rgba(8,8,18,0.92)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(134,6,189,0.22) 0%, transparent 65%)' }} />
      {children}
    </dialog>
  );
}
