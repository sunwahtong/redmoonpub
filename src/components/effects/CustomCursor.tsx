import React, {useEffect, useRef, useState} from 'react';

const INTERACTIVE = 'a[href], button, [role="button"], input, textarea, select, .rm-btn';

/**
 * The cinematic cursor: a ruby ring that lags slightly behind a hard dot, and
 * swells over anything interactive. Legacy `.cursor` / `.cursor-dot`.
 *
 * Fine pointers only — never shown on touch.
 */
export const CustomCursor: React.FC = () => {
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [hot, setHot] = useState(false);

  useEffect(() => {
    if (!window.matchMedia('(pointer:fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    setEnabled(true);
    document.documentElement.classList.add('rm-cursor-active');
    return () => document.documentElement.classList.remove('rm-cursor-active');
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let frame = 0;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let ringX = x;
    let ringY = y;

    const tick = () => {
      // The ring eases toward the dot; the dot is pinned to the pointer.
      ringX += (x - ringX) * 0.18;
      ringY += (y - ringY) * 0.18;

      if (ringRef.current) ringRef.current.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;
      if (dotRef.current) dotRef.current.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;

      frame = requestAnimationFrame(tick);
    };

    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      const target = event.target as Element | null;
      setHot(!!target?.closest?.(INTERACTIVE));
    };

    window.addEventListener('pointermove', onMove, {passive: true});
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <div ref={ringRef} className={`rm-cursor${hot ? ' is-hot' : ''}`} aria-hidden="true"/>
      <div ref={dotRef} className="rm-cursor-dot" aria-hidden="true"/>
    </>
  );
};
