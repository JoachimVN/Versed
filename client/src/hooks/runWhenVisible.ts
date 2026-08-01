// Defers `fn` until the document is actually visible, instead of running it
// immediately. Used by reveal sequences (slot-reel flicker + reveal_rise/hit
// SFX) that must not start while the tab is backgrounded: the flicker's
// setTimeout chain gets throttled/stretched, and the AudioContext may be
// auto-suspended, so audio scheduled against its (frozen) clock either goes
// silent or bursts out all at once on refocus instead of landing on beat.
// Starting fresh once the tab is actually visible sidesteps both. Returns a
// cleanup function that cancels the pending wait.
export function runWhenVisible(fn: () => void): () => void {
  if (!document.hidden) {
    fn();
    return () => {};
  }
  const onVisible = () => {
    if (document.hidden) return;
    document.removeEventListener('visibilitychange', onVisible);
    fn();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}
