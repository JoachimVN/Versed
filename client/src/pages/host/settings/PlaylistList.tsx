import { mergeUniqueTracks, MAX_POOL_TRACKS, type CustomPlaylist } from '../useHostGame';

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
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center gap-2.5 rounded-xl text-left"
        style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.15)', cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s' }}
        onMouseEnter={e => { const el = e.currentTarget; el.style.background = 'rgba(255,255,255,0.09)'; el.style.borderColor = 'rgba(255,255,255,0.3)'; }}
        onMouseLeave={e => { const el = e.currentTarget; el.style.background = 'rgba(255,255,255,0.05)'; el.style.borderColor = 'rgba(255,255,255,0.15)'; }}
      >
        <div className="min-w-0 flex-1">
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8125rem' }}>
            {customPlaylists.length === 0 ? 'Choose playlists' : '+ Add another playlist'}
          </p>
          {customPlaylists.length > 1 && (
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.6875rem' }}>{totalTracks} unique tracks total</p>
          )}
        </div>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>→</span>
      </button>
      {overCap && (
        <p style={{ color: '#fcd34d', fontSize: '0.6875rem' }}>
          Combined pool capped at {MAX_POOL_TRACKS.toLocaleString()} tracks — {(uncappedTotal - MAX_POOL_TRACKS).toLocaleString()} track{uncappedTotal - MAX_POOL_TRACKS === 1 ? '' : 's'} from the most recently added playlist(s) won't be included.
        </p>
      )}
    </div>
  );
}
