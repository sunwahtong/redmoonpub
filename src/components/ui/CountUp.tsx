import React, {useEffect, useRef, useState} from 'react';

interface Props {
  to: number;
  /** Duration in ms. */
  duration?: number;
  /** Rendered before and after the number, e.g. "★" or " Ft". */
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}

/** Decelerating ease. Fast at the start, settles on the final value. */
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * A number that counts up the first time it scrolls into view.
 *
 * The final value is present in the DOM from the first frame for assistive
 * technology, and the animation only replaces what is painted — so a screen
 * reader never reads a running total, and the value is correct even if the
 * animation never runs.
 */
export const CountUp: React.FC<Props> = ({
  to,
  duration = 1600,
  prefix = '',
  suffix = '',
  decimals = 0,
  className = ''
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setStarted(true);
      },
      {threshold: 0.4}
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;

    let frame = 0;
    const start = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setValue(to * easeOut(progress));
      if (progress < 1) frame = window.requestAnimationFrame(step);
    };

    setValue(0);
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [started, to, duration]);

  const text = `${prefix}${value.toLocaleString('hu-HU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}${suffix}`;

  return (
    <span ref={ref} className={className}>
      <span className="sr-only">{`${prefix}${to.toLocaleString('hu-HU', {minimumFractionDigits: decimals, maximumFractionDigits: decimals})}${suffix}`}</span>
      <span aria-hidden="true">{text}</span>
    </span>
  );
};
