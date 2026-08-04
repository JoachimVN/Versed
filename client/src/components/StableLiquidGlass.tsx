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

  // The library only re-measures its SVG-filtered backdrop on the window's
  // own native 'resize' event, reading getBoundingClientRect() synchronously
  // off it. Our squeeze-tier layouts (RevealView, YearReveal, etc.) resize
  // this element via React state rather than a native window resize, so
  // orientation changes and viewport-driven re-tiering commit their new size
  // one or more renders after any 'resize' event the library actually saw —
  // it's left measuring the pre-squeeze box forever after. The plain content
  // (this component's children, normal DOM flow) reflows into the new size
  // fine regardless; only the filter/backdrop layer goes stale, which is why
  // it visibly stops tracking the div while everything drawn on top of it
  // still scales correctly. `.liquid-glass-stabilizer` is `display: contents`
  // so it has no box of its own to observe — watch the real parent box
  // instead, and nudge a resize event once it actually settles so the
  // library re-measures against current numbers no matter what caused the
  // change.
  useEffect(() => {
    const parent = wrapperRef.current?.parentElement;
    if (!parent) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
    observer.observe(parent);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={wrapperRef} className="liquid-glass-stabilizer" data-ready={ready ? 'true' : 'false'}>
      <LibraryLiquidGlass {...props} />
    </div>
  );
}
