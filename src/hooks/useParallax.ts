import {useEffect, useRef} from 'react';

/**
 * Scroll-driven parallax on one element.
 *
 * Returns a ref to attach. The element is translated vertically in proportion
 * to how far it has travelled through the viewport, so a backdrop drifts more
 * slowly than the copy in front of it and the section gains depth.
 *
 * Writes `transform` from a rAF rather than through React state: this runs on
 * every scroll frame, and re-rendering the tree at 60fps to move one image
 * costs far more than the effect is worth.
 *
 * @param strength Pixels of travel across the full viewport. Negative values
 *                 move the element against the scroll direction.
 */
export function useParallax<T extends HTMLElement>(strength = 90) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 1;

      // Off-screen elements cost nothing: skip the write entirely.
      if (rect.bottom < -viewport || rect.top > viewport * 2) return;

      // -1 when the element sits below the fold, +1 once it has passed above.
      const progress = (viewport / 2 - (rect.top + rect.height / 2)) / viewport;
      node.style.transform = `translate3d(0, ${(progress * strength).toFixed(2)}px, 0)`;
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, {passive: true});
    window.addEventListener('resize', onScroll);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [strength]);

  return ref;
}
