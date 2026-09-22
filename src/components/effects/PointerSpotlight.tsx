import React, {useEffect, useRef} from 'react';

/**
 * A soft light source that follows the pointer.
 *
 * The site is almost entirely near-black, which flattens it: every section
 * renders as the same unlit plane. Tying a faint bloom to the pointer gives the
 * page a light source, so surfaces read as lit rather than printed.
 *
 * Written straight to CSS custom properties from a rAF, never through state —
 * this fires on every pointer move, and a re-render per mouse event is the
 * difference between a page that feels expensive and one that feels stuck.
 *
 * Skipped on touch (no pointer to follow) and under reduced motion.
 */
export const PointerSpotlight: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      window.matchMedia('(pointer: coarse)').matches
    ) {
      return;
    }

    let frame = 0;
    let x = 0;
    let y = 0;

    const paint = () => {
      frame = 0;
      node.style.setProperty('--rm-spot-x', `${x}px`);
      node.style.setProperty('--rm-spot-y', `${y}px`);
    };

    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      node.classList.add('is-on');
      if (!frame) frame = window.requestAnimationFrame(paint);
    };

    const onLeave = () => node.classList.remove('is-on');

    window.addEventListener('pointermove', onMove, {passive: true});
    document.addEventListener('pointerleave', onLeave);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <div ref={ref} className="rm-spotlight" aria-hidden="true"/>;
};
