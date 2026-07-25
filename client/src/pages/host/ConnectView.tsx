import { ShieldAlert } from 'lucide-react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { BackButton } from '../../components/BackButton';
import { LIQUID_CARD_PROPS } from '../../components/liquidGlassPresets';
import { APP_NAME, BACKEND_URL } from '../../config';
import type { HostState } from './useHostGame';
import { FullScreenDialog } from './dialogs';

export function ConnectView({ game }: Readonly<{ game: HostState }>) {
  const { spotify } = game;
  const searchParams = new URLSearchParams(globalThis.location.search);
  const error = searchParams.get('error');

  const errorMessages: Record<string, string> = {
    'access_denied': 'You denied authorization.',
    'user_denied_authorization': 'You denied authorization.',
    'cancelled': 'Authorization was cancelled.',
  };
  const errorMsg = error ? (errorMessages[error] ?? 'Authorization failed.') : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      <BackButton />
      <img src={`${import.meta.env.BASE_URL}logo.png`} alt={APP_NAME} width={2560} height={1000} className="w-auto drop-shadow-[0_18px_22px_rgba(0,0,0,0.55)]" style={{ maxHeight: '192px', maxWidth: '100%' }} />
      {spotify.isConnected && !spotify.playerReady ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-white/50">Connecting to Spotify...</p>
          {spotify.playbackError && (
            <p className="max-w-sm text-red-300 text-sm" aria-live="assertive">
              {spotify.playbackError} Try Chrome or Edge if Safari keeps blocking playback.
            </p>
          )}
          <button
            type="button"
            onClick={() => spotify.disconnect()}
            className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 text-white/70 text-sm font-semibold hover:bg-white/10 hover:text-white transition-colors"
          >
            Reconnect Spotify
          </button>
        </div>
      ) : (
        <>
          <a
            href={`${BACKEND_URL}/api/auth/spotify`}
            className="px-8 py-4 rounded-2xl bg-[#1DB954] text-white font-bold text-xl hover:bg-[#1ed760] transition-colors"
          >
            Connect Spotify
          </a>
          {errorMsg && (
            <p className="text-red-400 text-sm text-center" aria-live="assertive">{errorMsg} <a href={globalThis.location.pathname} className="underline">Try again</a></p>
          )}
        </>
      )}
      <p className="text-white/45 text-sm">Requires Spotify Premium</p>
      {spotify.unauthorized && (
        <FullScreenDialog ariaLabel="Spotify account not authorized">
          <div className="liquid-btn relative" style={{ width: '320px', height: '260px' }}>
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              {...LIQUID_CARD_PROPS}
              padding="32px 28px"
            >
              <div style={{ width: '264px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <ShieldAlert style={{ width: '30px', height: '30px', color: 'rgba(255,255,255,0.45)' }} strokeWidth={1.5} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <p style={{ color: 'white', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.01em', textAlign: 'center' }}>Account not authorized</p>
                  <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', textAlign: 'center', lineHeight: 1.5 }}>
                    Versed is in limited testing. Only a few Spotify accounts can host. Ask Joachim to add yours, then try again.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => spotify.disconnect()}
                  style={{ marginTop: '6px', width: '100%', padding: '10px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.72)', fontWeight: 600, fontSize: '0.875rem', transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.13)'; el.style.borderColor = 'rgba(255,255,255,0.22)'; el.style.color = 'white'; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.07)'; el.style.borderColor = 'rgba(255,255,255,0.12)'; el.style.color = 'rgba(255,255,255,0.72)'; }}
                >
                  Try a different account
                </button>
              </div>
            </LiquidGlass>
          </div>
        </FullScreenDialog>
      )}
    </div>
  );
}
