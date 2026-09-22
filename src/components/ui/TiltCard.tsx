import React, {useCallback, useRef} from 'react';

interface Props {
  children: React.ReactNode;
  className?: string;
  /** Maximum rotation in degrees at the corners. */
  max?: number;
}

/**
 * A surface that turns toward the pointer, with a specular highlight tracking
 * across it.
 *
 * The rotation is written straight to CSS custom properties on the element
 * rather than held in React state — this fires on every pointer move, and
 * re-rendering a subtree per mouse event is the classic way to make a card feel
 * heavy instead of expensive.
 *
 * Skipped entirely on touch: there is no hover to track, and the tilt would
 * only fight the scroll.
 */
export const TiltCard: React.FC<Props> = ({children, className = '', max = 7}) => {
  const ref = useRef<HTMLDivElement>(null);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const node = ref.current;
      if (!node || event.pointerType === 'touch') return;

      const rect = node.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;

      node.style.setProperty('--rm-tilt-y', `${(px - 0.5) * 2 * max}deg`);
      // Inverted: pushing the pointer down should tip the top of the card away.
      node.style.setProperty('--rm-tilt-x', `${(0.5 - py) * 2 * max}deg`);
      node.style.setProperty('--rm-tilt-mx', `${px * 100}%`);
      node.style.setProperty('--rm-tilt-my', `${py * 100}%`);
      node.classList.add('is-live');
    },
    [max]
  );

  const reset = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    node.classList.remove('is-live');
    node.style.setProperty('--rm-tilt-x', '0deg');
    node.style.setProperty('--rm-tilt-y', '0deg');
  }, []);

  return (
    <div ref={ref} className={`rm-tilt ${className}`} onPointerMove={onPointerMove} onPointerLeave={reset}>
      <div className="rm-tilt-sheen" aria-hidden="true"/>
      {children}
    </div>
  );
};
