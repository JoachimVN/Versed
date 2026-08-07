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
    let trailingTimeout = 0;
    const dispatchResize = () => window.dispatchEvent(new Event('resize'));
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      clearTimeout(trailingTimeout);
      frame = requestAnimationFrame(() => {
        dispatchResize();
        // liquid-glass-react hardcodes a 200ms CSS transition on its own glass
        // container (baseStyle.transition, unconditional) but only snapshots
        // its overlay layers' size via getBoundingClientRect() at the moment
        // this resize event fires. If our container's own resize settles
        // before that internal transition finishes, the snapshot lands
        // mid-transition and the overlay is stuck there for good — nothing
        // else re-triggers a re-measure. Re-dispatch once more after that
        // window has definitely closed to catch the true final size.
        trailingTimeout = window.setTimeout(dispatchResize, 250);
      });
    });
    observer.observe(parent);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(trailingTimeout);
      observer.disconnect();
    };
  }, []);

  // Safari's page zoom (and pinch-zoom on trackpads) rescales the visual
  // viewport without firing a native window 'resize' or changing this
  // element's own CSS-px box size, so neither the library's resize listener
  // nor the ResizeObserver above ever re-fires — the SVG-filtered backdrop
  // (which is what actually draws the refraction) stays snapshotted at the
  // pre-zoom scale and visibly drifts from its own container, most visible
  // as glass panels no longer lining up with plain DOM siblings beside them.
  // visualViewport's 'resize' event is the one signal that reliably fires
  // for both page zoom and pinch-zoom across Safari and Chrome, so reuse it
  // to trigger the same re-measure nudge as the ResizeObserver above.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let trailingTimeout = 0;
    const dispatchResize = () => window.dispatchEvent(new Event('resize'));
    const handleViewportResize = () => {
      clearTimeout(trailingTimeout);
      dispatchResize();
      trailingTimeout = window.setTimeout(dispatchResize, 250);
    };
    viewport.addEventListener('resize', handleViewportResize);
    return () => {
      clearTimeout(trailingTimeout);
      viewport.removeEventListener('resize', handleViewportResize);
    };
  }, []);

  // The library's own edge-highlight ring tracked the cursor via a
  // `background: linear-gradient(...)` angle driven by its internal
  // mouseOffset state -- lost when CSS replaced those separately-animated
  // spans with `.glass::after` (see index.css) to fix a Safari transform
  // desync. Recreate just the cursor-tracking part here, independently: a
  // CSS var updated directly via style.setProperty (no React state/render
  // involved, so this can't reintroduce the same class of bug) that
  // index.css's ::after gradient reads to rotate its angle toward the
  // cursor, matching the library's own `135 + mouseOffset.x * 1.2` formula.
  useEffect(() => {
    const parent = wrapperRef.current?.parentElement;
    if (!parent) return;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = parent.getBoundingClientRect();
      const offsetX = ((e.clientX - (rect.left + rect.width / 2)) / rect.width) * 100;
      parent.style.setProperty('--liquid-glass-sheen-x', offsetX.toFixed(2));
    };
    const resetSheen = () => parent.style.setProperty('--liquid-glass-sheen-x', '0');
    parent.addEventListener('mousemove', handleMouseMove);
    parent.addEventListener('mouseleave', resetSheen);
    return () => {
      parent.removeEventListener('mousemove', handleMouseMove);
      parent.removeEventListener('mouseleave', resetSheen);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="liquid-glass-stabilizer" data-ready={ready ? 'true' : 'false'}>
      <LibraryLiquidGlass {...props} />
    </div>
  );
}
