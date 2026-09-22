import React, {useCallback, useRef} from 'react';

interface Props {
  children: React.ReactNode;
  /** How far the element may be pulled from centre, in pixels. */
  strength?: number;
  className?: string;
}

/**
 * Wraps a control so it drifts toward the pointer and springs back on leave.
 *
 * Used sparingly — on the one or two calls to action a page actually wants
 * pressed. Applied to everything it stops reading as craft and starts reading
 * as a page that will not hold still.
 *
 * Ignores touch pointers: there is no hover to anticipate, so the only effect
 * would be the button jumping out from under the finger.
 */
export const Magnetic: React.FC<Props> = ({children, strength = 9, className = ''}) => {
  const ref = useRef<HTMLSpanElement>(null);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      const node = ref.current;
      if (!node || event.pointerType === 'touch') return;

      const rect = node.getBoundingClientRect();
      const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);

      node.classList.add('is-pulled');
      node.style.transform = `translate3d(${dx * strength}px, ${dy * strength}px, 0)`;
    },
    [strength]
  );

  const reset = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    node.classList.remove('is-pulled');
    node.style.transform = 'translate3d(0, 0, 0)';
  }, []);

  return (
    <span ref={ref} className={`rm-magnetic ${className}`} onPointerMove={onPointerMove} onPointerLeave={reset}>
      {children}
    </span>
  );
};
