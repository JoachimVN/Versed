import { Plus } from 'lucide-react';
import LiquidGlass from '../../../components/StableLiquidGlass';
import { LIQUID_CONTROL_PROPS } from '../../../components/liquidGlassPresets';
import { mergeUniqueTracks, MAX_POOL_TRACKS, type CustomPlaylist } from '../useHostGame';
import { SETTINGS_CONTENT_WIDTH } from './rows';

// The chosen-playlists list shown when Song Source is "My Playlist": each
// picked playlist with a remove button, plus the add-another affordance and
// the combined-pool cap warning.
export function PlaylistList({ customPlaylists, onOpen, onRemove }: Readonly<{
  customPlaylists: CustomPlaylist[]; onOpen: () => void; onRemove: (id: string) => void;
}>) {
  const uncappedTotal = mergeUniqueTracks(customPlaylists).length;
  const totalTracks = Math.min(uncappedTotal, MAX_POOL_TRACKS);
  const overCap = uncappedTotal > MAX_POOL_TRACKS;
  return (
    <div className="space-y-2">
      {customPlaylists.map(p => (
        <div
          key={p.id}
          className="w-full flex items-center gap-2.5 rounded-xl"
          style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {p.imageUrl ? (
            <img src={p.imageUrl} alt="" className="w-8 h-8 rounded-md object-cover shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-md shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate" style={{ color: 'white', fontWeight: 600, fontSize: '0.8125rem' }}>{p.name}</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.6875rem' }}>{p.tracks.length} tracks</p>
          </div>
          <button
            type="button"
            onClick={() => onRemove(p.id)}
            aria-label={`Remove ${p.name}`}
            className="text-white/35 hover:text-white/80 transition-colors"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '4px' }}
          >
            ×
          </button>
        </div>
      ))}
      {/* Same subtle real-LiquidGlass chrome as the panel's other small
          controls (see SettingStepperButton/ToggleRow), tinted green for
          the Spotify-playlist context rather than the panel's default
          purple — replaces the old dashed "add" affordance with a quiet
          glass pill and a plus badge instead of a trailing arrow. */}
      <div className="liquid-btn glass-tint-green subtle-glass-chip relative w-full" style={{ height: '48px' }}>
        <LiquidGlass style={{ position: 'absolute', top: '50%', left: '50%' }} {...LIQUID_CONTROL_PROPS} cornerRadius={14} padding="0">
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-2.5 text-left"
            style={{ width: `${SETTINGS_CONTENT_WIDTH}px`, height: '48px', padding: '0 12px', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <span
              className="flex items-center justify-center rounded-full shrink-0"
              style={{ width: '26px', height: '26px', background: 'rgba(29,185,84,0.16)', border: '1px solid rgba(29,185,84,0.32)' }}
            >
              <Plus className="w-3.5 h-3.5" style={{ color: '#6ee7a0' }} strokeWidth={2.5} />
            </span>
            <div className="min-w-0 flex-1">
              <p style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 600, fontSize: '0.8125rem' }}>
                {customPlaylists.length === 0 ? 'Choose playlists' : 'Add another playlist'}
              </p>
              {customPlaylists.length > 1 && (
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.6875rem' }}>{totalTracks} unique tracks total</p>
              )}
            </div>
          </button>
        </LiquidGlass>
      </div>
      {overCap && (
        <p style={{ color: '#fcd34d', fontSize: '0.6875rem' }}>
          Combined pool capped at {MAX_POOL_TRACKS.toLocaleString()} tracks — {(uncappedTotal - MAX_POOL_TRACKS).toLocaleString()} track{uncappedTotal - MAX_POOL_TRACKS === 1 ? '' : 's'} from the most recently added playlist(s) won't be included.
        </p>
      )}
    </div>
  );
}
