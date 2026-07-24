import { useState, useEffect } from 'react';
import { Check, Disc3 } from 'lucide-react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { resolvePlaylistInput, PlaylistFetchError, PlaylistSummary, MAX_PLAYLIST_TRACKS } from '../../hooks/usePlaylistPicker';
import { LIQUID_CARD_PROPS } from '../../components/liquidGlassPresets';
import { BACKEND_URL } from '../../config';
import type { HostState } from './useHostGame';
import { mergeUniqueTracks, MAX_POOL_TRACKS } from './useHostGame';
import { FullScreenDialog } from './dialogs';

// Shared verbatim between the blocked-playlist-card hint and the paste-a-link
// error, so the two surfaces never drift into different wording for the same
// Spotify restriction.
const PLAYLIST_ACCESS_WORKAROUND =
  "You can't import playlists you don't own or collaborate on due to Spotify API restrictions.\n\n"
  + 'To work around this:\n'
  + '1. Open the playlist\n'
  + '2. Tap ⋯\n'
  + '3. "Add to other playlist"\n'
  + '4. "New playlist" to copy it into your own library.\n\n'
  + 'You may need to refresh the page for it to show up here.';

function playlistErrorMessage(error: PlaylistFetchError): string {
  switch (error) {
    case 'unauthorized': return 'Reconnect Spotify to allow playlist access.';
    case 'forbidden': return PLAYLIST_ACCESS_WORKAROUND;
    case 'not_found': return "Couldn't find that playlist. Check the link and try again.";
    case 'empty': return 'That playlist has no playable tracks.';
    default: return "Couldn't load that playlist. Try again.";
  }
}

export function ReconnectBanner() {
  return (
    <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(248,113,113,0.3)' }}>
      <p style={{ color: '#fca5a5', fontSize: '0.8125rem', marginBottom: '8px' }}>
        Reconnect Spotify to allow playlist access.
      </p>
      <a
        href={`${BACKEND_URL}/api/auth/spotify`}
        style={{ color: 'white', fontWeight: 600, fontSize: '0.8125rem', textDecoration: 'underline' }}
      >
        Reconnect Spotify
      </a>
    </div>
  );
}

// The playlist picker's main panel has four mutually-exclusive states; kept
// as its own component (rather than a nested ternary) so each is a plain,
// independently-readable branch.
function PlaylistsPanel({ playlistsError, loadingPlaylists, playlists, resolving, selectedIds, onChoose }: Readonly<{
  playlistsError: PlaylistFetchError | null;
  loadingPlaylists: boolean;
  playlists: PlaylistSummary[];
  resolving: boolean;
  selectedIds: Set<string>;
  onChoose: (id: string, imageUrl: string | null) => void;
}>) {
  const [openBlockedId, setOpenBlockedId] = useState<string | null>(null);
  if (playlistsError === 'unauthorized') return <ReconnectBanner />;
  if (loadingPlaylists) {
    return <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8125rem' }}>Loading your playlists…</p>;
  }
  if (playlistsError) {
    return <p style={{ color: '#fca5a5', fontSize: '0.8125rem' }}>{playlistErrorMessage(playlistsError)}</p>;
  }
  return (
    <div className="overflow-y-auto" style={{ maxHeight: '48vh' }}>
      <div className="grid grid-cols-3 gap-2.5">
        {playlists.map(p => {
          const selected = selectedIds.has(p.id);
          const blocked = !p.importable;
          const guideOpen = openBlockedId === p.id;
          return (
            <div key={p.id} className="relative">
              <button
                type="button"
                onClick={() => { if (!blocked) onChoose(p.id, p.imageUrl); }}
                disabled={resolving}
                aria-pressed={selected}
                className="relative flex flex-col w-full rounded-xl text-left"
                style={{
                  padding: '8px',
                  background: selected ? 'rgba(29, 185, 84, 0.12)' : 'rgba(255,255,255,0.04)',
                  border: selected ? '1px solid rgba(29, 185, 84, 0.45)' : '1px solid rgba(255,255,255,0.07)',
                  cursor: resolving || blocked ? 'not-allowed' : 'pointer',
                }}
              >
                {/* Dimmed independently of the guide overlay below, which needs
                    full opacity of its own regardless of the tile's blocked look. */}
                <div className="flex flex-col items-start gap-1.5 w-full" style={{ opacity: blocked ? 0.35 : 1 }}>
                  <div className="relative w-full">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="w-full aspect-square rounded-lg object-cover" />
                    ) : (
                      <div className="w-full aspect-square rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }} />
                    )}
                    {selected && (
                      <div
                        className="absolute top-1 right-1 flex items-center justify-center rounded-full"
                        style={{ width: '20px', height: '20px', background: '#1DB954' }}
                      >
                        <Check style={{ width: '13px', height: '13px', color: 'white' }} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  <p className="truncate w-full" style={{ color: 'white', fontWeight: 600, fontSize: '0.75rem' }}>{p.name}</p>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.6875rem' }}>{p.trackCount} tracks</p>
                </div>
              </button>
              {blocked && (
                <button
                  type="button"
                  aria-label="Why is this playlist blocked?"
                  onClick={() => setOpenBlockedId(guideOpen ? null : p.id)}
                  className="absolute top-1 left-1 flex items-center justify-center rounded-full"
                  style={{ width: '18px', height: '18px', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}
                >
                  <span style={{ color: 'white', fontSize: '0.6875rem', fontWeight: 700, lineHeight: 1 }}>?</span>
                </button>
              )}
              {blocked && (
                <button
                  type="button"
                  aria-label="Close blocked-playlist guide"
                  onClick={() => setOpenBlockedId(null)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setOpenBlockedId(null); }}
                  tabIndex={guideOpen ? 0 : -1}
                  className="absolute inset-0 overflow-y-auto rounded-xl text-left"
                  style={{
                    padding: '8px',
                    paddingTop: '26px',
                    background: 'rgba(10,10,14,0.95)',
                    opacity: guideOpen ? 1 : 0,
                    pointerEvents: guideOpen ? 'auto' : 'none',
                    transition: 'opacity 200ms ease',
                  }}
                >
                  <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.5625rem', lineHeight: 1.4, whiteSpace: 'pre-line' }}>
                    {PLAYLIST_ACCESS_WORKAROUND}
                  </p>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Full-screen playlist browser + paste-a-link fallback. Kept out of the
// small settings popover entirely — this is the "heavy" UI (grid, loading/
// error states) that the popover's chip just launches.
export function PlaylistPickerDialog({ game }: Readonly<{ game: HostState }>) {
  const { playlistPicker, closePlaylistPicker, customPlaylists, addPlaylist, removePlaylist } = game;
  const { playlists, loadingPlaylists, playlistsError, fetchPlaylists, fetchPlaylistTracks } = playlistPicker;
  const [linkInput, setLinkInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [truncationNotice, setTruncationNotice] = useState<string | null>(null);
  const [loadHovered, setLoadHovered] = useState(false);
  const [doneHovered, setDoneHovered] = useState(false);
  const selectedIds = new Set(customPlaylists.map(p => p.id));

  useEffect(() => { fetchPlaylists(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // LiquidGlass only measures its own size once on mount (and on window
  // resize) — it has no ResizeObserver, so it never notices the card growing
  // as content changes (spinner -> grid, or an error/loading line appearing
  // below it). Re-firing its resize listener (rather than remounting the
  // component) lets it re-measure in place and transition smoothly to the
  // new size — remounting instead snaps it back to its 270x69 default first,
  // which is what caused the visible "rescaling" on every state change.
  const glassContentShape = [
    loadingPlaylists ? 'loading' : 'idle',
    playlistsError ?? 'none',
    playlists.length > 0 ? 'has-playlists' : 'no-playlists',
    resolving ? 'resolving' : 'idle',
    resolveError ? 'resolve-error' : 'ok',
    truncationNotice ? 'truncated' : 'ok',
  ].join('|');
  useEffect(() => {
    globalThis.dispatchEvent(new Event('resize'));
  }, [glassContentShape]);

  const choosePlaylist = async (id: string, fallbackImageUrl: string | null = null) => {
    // Clicking an already-added playlist again toggles it off — no need to
    // refetch tracks just to remove something already in hand.
    if (selectedIds.has(id)) { removePlaylist(id); setTruncationNotice(null); return; }
    setResolving(true);
    setResolveError(null);
    setTruncationNotice(null);
    setResolvedCount(0);
    const result = await fetchPlaylistTracks(id, setResolvedCount);
    setResolving(false);
    if (!result.ok) {
      setResolveError(playlistErrorMessage(result.error));
      return;
    }
    const imageUrl = fallbackImageUrl ?? result.tracks[0]?.albumArtUrl ?? null;
    addPlaylist({ id, name: result.name, imageUrl, tracks: result.tracks });
    setLinkInput('');
    if (result.truncated) {
      setTruncationNotice(`That playlist has more than ${MAX_PLAYLIST_TRACKS.toLocaleString()} tracks — only the first ${MAX_PLAYLIST_TRACKS.toLocaleString()} were imported.`);
    }
  };

  const submitLink = () => {
    const id = resolvePlaylistInput(linkInput);
    if (!id) { setResolveError("That doesn't look like a Spotify playlist link."); return; }
    choosePlaylist(id);
  };

  return (
    <FullScreenDialog ariaLabel="Choose a playlist">
      <div className="liquid-btn relative" style={{ width: 'min(560px, 92vw)' }}>
        <LiquidGlass style={{ position: 'absolute', top: '50%', left: '50%' }} {...LIQUID_CARD_PROPS} elasticity={0.04} padding="28px 24px">
          <div style={{ width: 'min(512px, 84vw)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="flex items-center justify-between">
              <p style={{ color: 'white', fontWeight: 800, fontSize: '1.1rem' }}>Choose a playlist</p>
              <button
                type="button"
                onClick={closePlaylistPicker}
                aria-label="Close"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                value={linkInput}
                onChange={e => setLinkInput(e.target.value)}
                placeholder="Or paste a playlist link"
                style={{ flex: 1, padding: '9px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '0.8125rem' }}
              />
              <button
                type="button"
                onClick={submitLink}
                disabled={resolving || !linkInput.trim()}
                className="transition-all duration-150"
                style={{
                  padding: '9px 14px', borderRadius: '10px',
                  background: (() => {
                    if (resolving || !linkInput.trim()) return 'rgba(178,16,224,0.15)';
                    return loadHovered ? 'rgba(178,16,224,0.55)' : 'rgba(178,16,224,0.4)';
                  })(),
                  border: `1px solid ${(() => {
                    if (resolving || !linkInput.trim()) return 'rgba(208,46,249,0.2)';
                    return loadHovered ? 'rgba(208,46,249,0.8)' : 'rgba(208,46,249,0.5)';
                  })()}`,
                  color: 'white', fontWeight: 600, fontSize: '0.8125rem',
                  cursor: resolving || !linkInput.trim() ? 'not-allowed' : 'pointer',
                  boxShadow: loadHovered && !resolving && linkInput.trim() ? '0 0 16px rgba(178,16,224,0.35)' : 'none',
                  opacity: linkInput.trim() ? 1 : 0.3,
                }}
                onMouseEnter={() => !resolving && linkInput.trim() && setLoadHovered(true)}
                onMouseLeave={() => setLoadHovered(false)}
              >
                {resolving ? <Disc3 className="w-3.5 h-3.5 animate-spin inline mr-1.5" strokeWidth={1.5} /> : null}
                Load
              </button>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.7rem', marginTop: '-8px' }}>
              Works for playlists you own or collaborate on. Spotify blocks API access to others' playlists.
            </p>

            <PlaylistsPanel
              playlistsError={playlistsError}
              loadingPlaylists={loadingPlaylists}
              playlists={playlists}
              resolving={resolving}
              selectedIds={selectedIds}
              onChoose={choosePlaylist}
            />

            {resolveError && <p style={{ color: '#fca5a5', fontSize: '0.75rem', whiteSpace: 'pre-line' }}>{resolveError}</p>}
            {truncationNotice && <p style={{ color: '#fcd34d', fontSize: '0.75rem' }}>{truncationNotice}</p>}
            {resolving && (
              <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8125rem' }}>
                {resolvedCount > 0 ? `Loading tracks… ${resolvedCount} so far` : 'Loading tracks…'}
              </p>
            )}

            {(() => {
              const pluralS = selectedIds.size === 1 ? '' : 's';
              const trackCount = Math.min(mergeUniqueTracks(customPlaylists).length, MAX_POOL_TRACKS);
              const trackPluralS = trackCount === 1 ? '' : 's';
              const trackSuffix = trackCount > 0 ? ` (${trackCount.toLocaleString()} song${trackPluralS})` : '';
              return (
                <div className="flex items-center justify-between">
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>
                    {selectedIds.size === 0 ? 'Nothing selected yet' : `${selectedIds.size} playlist${pluralS} selected${trackSuffix}`}
                  </p>
                  <button
                    type="button"
                    onClick={closePlaylistPicker}
                    className="transition-all duration-150"
                    style={{
                      padding: '9px 16px', borderRadius: '10px',
                      background: doneHovered ? 'rgba(29, 185, 84, 0.45)' : 'rgba(29, 185, 84, 0.35)',
                      border: `1px solid ${doneHovered ? 'rgba(29, 185, 84, 0.75)' : 'rgba(29, 185, 84, 0.6)'}`,
                      color: 'white', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer',
                      boxShadow: doneHovered ? '0 0 16px rgba(29, 185, 84, 0.3)' : 'none',
                    }}
                    onMouseEnter={() => setDoneHovered(true)}
                    onMouseLeave={() => setDoneHovered(false)}
                  >
                    Done
                  </button>
                </div>
              );
            })()}
          </div>
        </LiquidGlass>
      </div>
    </FullScreenDialog>
  );
}
