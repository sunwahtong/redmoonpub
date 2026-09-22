import React, {useId, useMemo} from 'react';

interface Series {
  label: string;
  values: number[];
  /** CSS colour for the stroke. Falls back to the brand red. */
  color?: string;
  /** Fills under the line. Use for the primary series only. */
  fill?: boolean;
}

interface Props {
  series: Series[];
  height?: number;
  className?: string;
  /** Accessible summary; the chart itself is decoration over the numbers. */
  label: string;
}

/**
 * A compact multi-series trend line.
 *
 * Deliberately axis-free: it sits next to the figures it describes, and its job
 * is to show shape — climbing, flat, spiking — not to be read for values. The
 * numbers beside it carry those.
 *
 * Both series share one scale, so revenue and expense can be compared by eye.
 * Scaling them separately would make a small expense line look like a large one.
 */
export const Sparkline: React.FC<Props> = ({series, height = 64, className = '', label}) => {
  const id = useId();
  const width = 320;

  const paths = useMemo(() => {
    const longest = Math.max(1, ...series.map((entry) => entry.values.length));
    const peak = Math.max(1, ...series.flatMap((entry) => entry.values));

    return series.map((entry) => {
      const step = longest > 1 ? width / (longest - 1) : width;
      const points = entry.values.map((value, index) => {
        const x = index * step;
        // 4px of headroom so a peak is not clipped by the viewBox edge.
        const y = height - 4 - (value / peak) * (height - 10);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });

      return {
        ...entry,
        line: points.length ? `M ${points.join(' L ')}` : '',
        area: points.length ? `M 0,${height} L ${points.join(' L ')} L ${width},${height} Z` : ''
      };
    });
  }, [series, height]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{height}}
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(227,40,78,0.32)"/>
          <stop offset="100%" stopColor="rgba(227,40,78,0)"/>
        </linearGradient>
      </defs>

      {paths.map((entry) =>
        entry.fill && entry.area ? (
          <path key={`${entry.label}-area`} d={entry.area} fill={`url(#${id}-fill)`}/>
        ) : null
      )}

      {paths.map((entry) =>
        entry.line ? (
          <path
            key={entry.label}
            d={entry.line}
            fill="none"
            stroke={entry.color || 'var(--rm-red)'}
            strokeWidth={entry.fill ? 1.8 : 1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            strokeDasharray={entry.fill ? undefined : '3 3'}
          />
        ) : null
      )}
    </svg>
  );
};
