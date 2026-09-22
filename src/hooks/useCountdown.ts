import {useEffect, useState} from 'react';

export interface Countdown {
  d: string;
  h: string;
  m: string;
  s: string;
  /** True once the target moment has passed. */
  elapsed: boolean;
}

const ZERO: Countdown = {d: '00', h: '00', m: '00', s: '00', elapsed: true};

function compute(target: number): Countdown {
  const diff = target - Date.now();
  if (!Number.isFinite(target) || diff <= 0) return ZERO;
  return {
    d: String(Math.floor(diff / 86400000)).padStart(2, '0'),
    h: String(Math.floor(diff / 3600000) % 24).padStart(2, '0'),
    m: String(Math.floor(diff / 60000) % 60).padStart(2, '0'),
    s: String(Math.floor(diff / 1000) % 60).padStart(2, '0'),
    elapsed: false
  };
}

/**
 * Live countdown to an ISO timestamp. A single shared ticker per consumer, and
 * it stops itself once the target has passed instead of running forever.
 */
export function useCountdown(startsAt: string | null | undefined): Countdown {
  const target = startsAt ? new Date(startsAt).getTime() : NaN;
  const [value, setValue] = useState<Countdown>(() => compute(target));

  useEffect(() => {
    setValue(compute(target));
    if (!Number.isFinite(target) || target - Date.now() <= 0) return;

    const timer = window.setInterval(() => {
      const next = compute(target);
      setValue(next);
      if (next.elapsed) window.clearInterval(timer);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [target]);

  return value;
}
