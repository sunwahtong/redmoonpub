import React from 'react';
import {useCountdown} from '../../hooks/useCountdown';

interface Props {
  startsAt: string;
  /** Outer diameter in px. */
  size?: number;
  /** The span the ring represents. Default: one week. */
  windowMs?: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Circular countdown to an event.
 *
 * The ring fills as the event approaches, over a fixed window — a week by
 * default. An event further out than that simply shows an empty ring rather
 * than a meaningless sliver, which is honest: at three weeks' notice the
 * precise arc tells the reader nothing the day count does not.
 *
 * The digits are the information; the ring is the decoration. The digits are
 * inside the SVG's sibling, not the SVG, so they stay selectable text.
 */
export const CountdownRing: React.FC<Props> = ({startsAt, size = 178, windowMs = WEEK_MS}) => {
  const countdown = useCountdown(startsAt);

  const remaining = Math.max(0, new Date(startsAt).getTime() - Date.now());
  const progress = Math.max(0, Math.min(1, 1 - remaining / windowMs));

  const stroke = 2;
  const radius = size / 2 - stroke * 3;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative shrink-0" style={{width: size, height: size}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id="rmRingGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8a0c24"/>
            <stop offset="50%" stopColor="#e3284e"/>
            <stop offset="100%" stopColor="#ff4668"/>
          </linearGradient>
        </defs>

        <circle
          className="rm-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="rm-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          /* Start the arc at twelve o'clock instead of three. */
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {countdown.elapsed ? (
          <>
            <strong className="font-heading text-[19px] leading-none text-white">MOST</strong>
            <span className="mt-2 text-[7px] tracking-[0.22em] text-[color:var(--rm-red)]">A RED MOONBAN</span>
          </>
        ) : (
          <>
            <strong className="font-heading text-[40px] leading-none text-white tabular-nums">{countdown.d}</strong>
            <span className="mt-1.5 text-[7px] tracking-[0.24em] text-[#777]">NAP</span>
            <span className="mt-3 font-heading text-[15px] leading-none text-[color:var(--rm-red)] tabular-nums">
              {countdown.h}:{countdown.m}:{countdown.s}
            </span>
          </>
        )}
      </div>
    </div>
  );
};
