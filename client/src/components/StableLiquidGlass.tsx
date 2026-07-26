import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import LibraryLiquidGlass from 'liquid-glass-react';

type LiquidGlassProps = ComponentProps<typeof LibraryLiquidGlass>;

// liquid-glass-react renders every instance at its hard-coded 270x69 default,
// measures the real content in a passive effect, then transitions `all` to
// that measured size over 200ms. On phase/route mounts that produces the
// visible scale-up and can move centered layouts after a logo morph target
// has already been measured. Keep the library's first two paint frames hidden
// and transition-free; by the time it is revealed, its measurement update has
// committed and normal hover/press transitions can take over.
export default function StableLiquidGlass(props: Readonly<LiquidGlassProps>) {
  const [ready, setReady] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let revealFrame = 0;
    const settleFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(settleFrame);
      cancelAnimationFrame(revealFrame);
    };
  }, []);

  // The library pins its dimming/sheen/edge-ring overlay layers to a pixel
  // size cached in its own React state, refreshed only on a `window` resize
  // event — but the actual glass panel underneath (`.glass`) is sized by
  // plain CSS and reflows live. A window resize or zoom doesn't always
  // settle the panel's layout in the same tick the resize event fires, so
  // those overlay layers can end up a beat behind, visibly mismatched
  // against the panel. Watching the real panel with a ResizeObserver and
  // re-firing `resize` whenever its box actually changes keeps every layer
  // pinned to what's really on screen, however it got resized.
  useEffect(() => {
    const glass = wrapperRef.current?.querySelector('.glass');
    if (!glass) return;
    const observer = new ResizeObserver(() => {
      globalThis.dispatchEvent(new Event('resize'));
    });
    observer.observe(glass);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="liquid-glass-stabilizer" data-ready={ready ? 'true' : 'false'}>
      <LibraryLiquidGlass {...props} />
    </div>
  );
}
