import { useEffect, useState } from 'react';
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

  return (
    <div className="liquid-glass-stabilizer" data-ready={ready ? 'true' : 'false'}>
      <LibraryLiquidGlass {...props} />
    </div>
  );
}
