import React, {useMemo} from 'react';

/**
 * Constellation geometry, lifted verbatim from v68-starfield.js. Percentages
 * inside the constellation's own box.
 */
const DIPPER: [number, number][] = [
  [5, 31], [20, 37], [36, 45], [51, 57], [69, 43], [91, 52], [82, 80]
];

const PISCES: [number, number][] = [
  [4, 30], [11, 19], [20, 14], [30, 18], [37, 27], [31, 37], [21, 41], [12, 37],
  [39, 32], [46, 38], [53, 45], [60, 52], [67, 57], [73, 51], [80, 43], [89, 40],
  [97, 46], [98, 56], [93, 65], [84, 70], [76, 64], [69, 61], [63, 70], [57, 77]
];

interface Star {
  left: string;
  top: string;
  size: string;
  base: string;
  dur: string;
  delay: string;
  red: boolean;
  strong: boolean;
  faint: boolean;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function buildStars(count: number): Star[] {
  return Array.from({length: count}, () => {
    const red = Math.random() < 0.24;
    const strong = Math.random() < 0.18;
    const faint = !strong && Math.random() < 0.4;

    return {
      left: `${rand(0.5, 99.5).toFixed(2)}%`,
      top: `${rand(1, 98).toFixed(2)}%`,
      size: `${rand(faint ? 0.55 : 0.8, strong ? 3.5 : 2.15).toFixed(2)}px`,
      base: rand(faint ? 0.1 : 0.28, strong ? 1 : 0.78).toFixed(2),
      dur: `${rand(strong ? 1.15 : 1.7, strong ? 3.1 : 6.8).toFixed(2)}s`,
      // Negative delay starts each star mid-cycle, so the sky is alive on frame one.
      delay: `${(-rand(0, 8)).toFixed(2)}s`,
      red,
      strong,
      faint
    };
  });
}

const Constellation: React.FC<{name: string; points: [number, number][]}> = ({name, points}) => (
  <span className={`rm-constellation ${name}`} aria-hidden="true">
    {points.map(([left, top], index) => (
      <b
        key={`${left}-${top}`}
        className="rm-cstar"
        style={
          {
            left: `${left}%`,
            top: `${top}%`,
            '--cs': `${index % 3 === 0 ? 6.2 : 4.8}px`,
            '--cd': `${rand(1.25, 2.65).toFixed(2)}s`,
            '--cdelay': `${(-rand(0, 4)).toFixed(2)}s`
          } as React.CSSProperties
        }
      />
    ))}
  </span>
);

/**
 * The living neon sky behind the hero: ~300 stars (fewer on touch devices),
 * about a quarter of them ruby, plus Göncölszekér and Halak.
 *
 * Positions are randomised once per mount via useMemo — re-rolling them on every
 * render would make the whole sky jump.
 */
export const Starfield: React.FC = () => {
  const stars = useMemo(() => {
    const mobile =
      typeof window !== 'undefined' && window.matchMedia('(max-width:900px), (pointer:coarse)').matches;
    return buildStars(mobile ? 120 : 300);
  }, []);

  return (
    <div className="rm-starfield" aria-hidden="true">
      {stars.map((star, index) => (
        <i
          key={index}
          className={`rm-star${star.red ? ' is-red' : ''}${star.strong ? ' is-strong' : ''}${star.faint ? ' is-faint' : ''}`}
          style={
            {
              left: star.left,
              top: star.top,
              '--size': star.size,
              '--base': star.base,
              '--dur': star.dur,
              '--delay': star.delay
            } as React.CSSProperties
          }
        />
      ))}

      <Constellation name="dipper" points={DIPPER}/>
      <Constellation name="pisces" points={PISCES}/>
    </div>
  );
};
