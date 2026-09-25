/**
 * Signature generator.
 *
 * Draws a handwritten-looking signature from a person's name. The same name
 * and seed always produce the same strokes, so a signature is generated once
 * (when the account reaches manager rank) and then reused on every document.
 *
 * The drawing is derived from the letters of the name rather than random:
 *
 *   - each word opens with a flourished capital shaped by its letter class
 *     (round, upright, diagonal, a cup, a tall loop), some with the strokes
 *     a hand adds afterwards — the bar of a T or an A, the hook of a J,
 *   - the remaining letters become a running stroke whose rises and dips
 *     follow the ascenders and descenders of the actual letters, with the
 *     t-bars and i-dots dropped in after the word like a real pen does,
 *   - words are joined by a ligature or separated by a lift, the baseline
 *     rolls and drifts a little, and the whole thing ends in a swash that
 *     runs back under the name, sometimes with a paraph after it.
 *
 * The ink is drawn with pressure: every stroke is flattened to points and
 * given a width that grows on the way down and thins on the way up, thins
 * again on fast sweeps and tapers at both ends, then filled as a ribbon. A
 * faint second layer along the centre reads as the pen's wet edge. A seeded
 * generator adds the small irregularities of a hand. Dependency-free, shared
 * by the server (storing) and the browser (previewing).
 */

const VIEW_W = 340;
const VIEW_H = 96;

type Point = [number, number];

/** xorshift32 seeded from a string. */
function rng(seedText: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  if (!seed) seed = 0x9e3779b9;
  return () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 0xffffffff;
  };
}

const fold = (text: string): string =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const ASCENDERS = new Set('bdfhklt');
const DESCENDERS = new Set('gjpqy');
const ROUND = new Set('aceos');
const DOTTED = new Set('ij');
const ROUND_CAPS = new Set('CGOQS');
const DIAGONAL_CAPS = new Set('AMNVWXYZ');
const CUP_CAPS = new Set('U');
const LOOP_CAPS = new Set('EL');

const f = (n: number): number => Number(n.toFixed(1));

interface Skeleton {
  /** Strokes between pen lifts, flattened, in the final coordinates. */
  strokes: Point[][];
  /** The pen's full width. */
  weight: number;
}

/** Points along a cubic curve, the start excluded. */
function flatten(from: Point, c1: Point, c2: Point, to: Point, steps = 8): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    out.push([
      mt * mt * mt * from[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * to[0],
      mt * mt * mt * from[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * to[1]
    ]);
  }
  return out;
}

/** The strokes of a name, in the plan the pen draws them in. */
function skeleton(name: string, seed = ''): Skeleton {
  const clean = fold(name) || 'Red Moon';
  const random = rng(`${clean}|${seed}`);
  const jitter = (amount: number) => (random() - 0.5) * 2 * amount;

  const words = clean.split(' ').slice(0, 3);
  const baseline = 60;
  const slant = 0.16 + random() * 0.18;
  const xHeight = 10 + random() * 4;
  const capHeight = 28 + random() * 8;
  const weight = 2.6 + random() * 1;
  const drift = (random() - 0.5) * 0.05;
  const roll = 0.8 + random() * 1.4;
  const hurried = random() < 0.45;
  const joins = random() < 0.55;
  const paraph = random() < 0.4;

  // Budget the width so long names stay inside the box.
  const letterCount = words.reduce((sum, word) => sum + Math.max(1, word.length - 1), 0);
  const capWidth = 22;
  const available = VIEW_W - 40 - words.length * capWidth - (words.length - 1) * 14;
  const letterWidth = Math.max(4.5, Math.min(11, available / Math.max(1, letterCount)));

  const strokes: Point[][] = [];
  /* Strokes a hand adds after the word: bars and dots. */
  let later: Point[][] = [];
  let current: Point[] = [];
  let x = 22;
  let y = baseline;

  const lift = () => {
    if (current.length > 1) strokes.push(current);
    current = [];
  };
  const move = (nx: number, ny: number) => {
    lift();
    current = [[nx, ny]];
    x = nx;
    y = ny;
  };
  const curve = (c1x: number, c1y: number, c2x: number, c2y: number, nx: number, ny: number) => {
    if (!current.length) current = [[x, y]];
    current.push(...flatten([x, y], [c1x, c1y], [c2x, c2y], [nx, ny]));
    x = nx;
    y = ny;
  };
  /** A short bowed line, drawn later. */
  const bar = (x0: number, y0: number, x1: number, y1: number, bow: number) => {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2 - bow;
    later.push([[x0, y0], ...flatten([x0, y0], [mx - 2, my], [mx + 2, my], [x1, y1], 5)]);
  };
  const dot = (px: number, py: number) => {
    later.push([
      [px, py],
      [px + 0.7, py + 0.6],
      [px + 1.3, py - 0.1]
    ]);
  };

  const capital = (letter: string) => {
    const upper = letter.toUpperCase();
    const top = baseline - capHeight + jitter(2);
    const startX = x;
    if (ROUND_CAPS.has(upper)) {
      // A big open loop, drawn from the top right, round and out at the base.
      move(startX + 18, top + 6);
      curve(startX + 8, top - 4, startX - 6, top + 10, startX - 2, baseline - capHeight * 0.45);
      curve(startX + 2, baseline + 4, startX + 14, baseline + 6, startX + 20, baseline - 3 + jitter(2));
      if (upper === 'S') curve(startX + 12, baseline - 12, startX + 4, baseline - 2, startX + 21, baseline);
      if (upper === 'G') curve(startX + 14, baseline - 16, startX + 10, baseline - 10, startX + 21, baseline - 2);
      if (upper === 'Q') curve(startX + 14, baseline + 4, startX + 22, baseline + 9, startX + 26, baseline + 1);
    } else if (DIAGONAL_CAPS.has(upper)) {
      // A peak: up the left diagonal, down the right, with a little lead-in.
      move(startX - 2, baseline - 6);
      curve(startX + 2, baseline - 14, startX + 6, top + 2, startX + 10, top + jitter(2));
      curve(startX + 13, top + 4, startX + 17, baseline - 10, startX + 21, baseline + jitter(2));
      if (upper === 'M' || upper === 'W') curve(startX + 24, baseline - 18, startX + 27, top + 8, startX + 30, baseline - 2);
      if (upper === 'A') {
        const mid = baseline - capHeight * 0.42;
        bar(startX + 3, mid + 2, startX + 19, mid - 1 + jitter(1.5), 1.5);
      }
      if (upper === 'Z') {
        // The diagonal is really a zigzag: a top bar across before the peak.
        bar(startX - 1, top + 1, startX + 12, top - 1, -1);
      }
    } else if (CUP_CAPS.has(upper)) {
      move(startX, top + 4);
      curve(startX - 2, baseline - 6, startX + 6, baseline + 3, startX + 12, baseline - 4);
      curve(startX + 16, baseline - 10, startX + 18, top + 6, startX + 20, top + 2);
      curve(startX + 21, baseline - 12, startX + 20, baseline - 3, startX + 22, baseline);
    } else if (LOOP_CAPS.has(upper)) {
      // A tall loop: up over the top, down the left side, out along the base.
      move(startX + 14, baseline - capHeight * 0.55);
      curve(startX + 20, top - 8, startX + 1, top - 3, startX + 2, baseline - capHeight * 0.5);
      curve(startX + 2, baseline - 6, startX + 3, baseline + 3, startX + 10, baseline + 1);
      if (upper === 'L') curve(startX + 16, baseline + 1, startX + 22, baseline - 7, startX + 26, baseline - 2);
      else {
        curve(startX + 14, baseline - 2, startX + 18, baseline - 8, startX + 22, baseline - 2);
        bar(startX + 4, baseline - capHeight * 0.5, startX + 15, baseline - capHeight * 0.52 + jitter(1), 0.8);
      }
    } else {
      // Upright: an entry hook, a tall downstroke and a lobe to the right.
      move(startX - 4, top + 10);
      curve(startX + 2, top - 6, startX + 8, top - 2, startX + 6, top + 4);
      curve(startX + 4, baseline - capHeight * 0.4, startX + 3, baseline - 4, startX + 2, baseline + jitter(2));
      if ('BPRD'.includes(upper)) {
        curve(startX + 10, baseline - capHeight * 0.55, startX + 22, baseline - capHeight * 0.75, startX + 16, baseline - capHeight * 0.45);
        curve(startX + 12, baseline - capHeight * 0.3, startX + 8, baseline - 8, startX + 20, baseline - 2);
      } else if ('KH'.includes(upper)) {
        curve(startX + 8, baseline - capHeight * 0.6, startX + 16, top + 6, startX + 20, top + 10);
        curve(startX + 14, baseline - capHeight * 0.35, startX + 16, baseline - 6, startX + 22, baseline - 1);
        if (upper === 'H') bar(startX + 3, baseline - capHeight * 0.5, startX + 19, baseline - capHeight * 0.52 + jitter(1), 1);
      } else if ('TF'.includes(upper)) {
        // The bar goes on afterwards; the pen comes back to the base to carry on.
        bar(startX - 6, top + 2 + jitter(1), startX + 22, top - 1 + jitter(1), 2);
        if (upper === 'F') bar(startX + 3, baseline - capHeight * 0.5, startX + 16, baseline - capHeight * 0.52, 0.8);
        curve(startX + 6, baseline - 9, startX + 14, baseline - 10, startX + 20, baseline - 2);
      } else if (upper === 'J') {
        // The downstroke carries on under the line and hooks back.
        curve(startX + 2, baseline + 12, startX - 4, baseline + 17, startX - 9, baseline + 9);
        move(startX + 3, baseline - 3);
        curve(startX + 8, baseline - 10, startX + 14, baseline - 10, startX + 20, baseline - 2);
      } else {
        curve(startX + 6, baseline - 10, startX + 14, baseline - 12, startX + 20, baseline - 2);
      }
    }
  };

  const lowercase = (letter: string) => {
    const w = letterWidth + jitter(1.2);
    const nx = x + w;
    const sx = x;
    if (ASCENDERS.has(letter)) {
      const top = baseline - capHeight * (letter === 't' ? 0.5 : 0.75 + random() * 0.2);
      curve(sx + w * 0.2, baseline - xHeight, sx + w * 0.35, top, sx + w * 0.45, top + jitter(2));
      curve(sx + w * 0.55, baseline - xHeight * 0.4, sx + w * 0.7, baseline + 2, nx, baseline + jitter(1.5));
      if (letter === 't') {
        const cy = baseline - xHeight * 1.2 + jitter(1);
        bar(sx + w * 0.45 - 5, cy + 0.6, sx + w * 0.45 + 6, cy - 0.8, 0.6);
      }
    } else if (DESCENDERS.has(letter)) {
      const bottom = baseline + 14 + random() * 8;
      curve(sx + w * 0.2, baseline - xHeight * 0.9, sx + w * 0.6, baseline - xHeight, sx + w * 0.55, baseline);
      curve(sx + w * 0.5, bottom, sx + w * 0.2, bottom + 2, sx + w * 0.45, baseline - xHeight * 0.3);
      curve(sx + w * 0.7, baseline - 8, sx + w * 0.85, baseline, nx, baseline + jitter(1.5));
    } else if (ROUND.has(letter)) {
      curve(sx + w * 0.9, baseline - xHeight * 1.1, sx + w * 0.1, baseline - xHeight * 1.1, sx + w * 0.3, baseline - 2);
      curve(sx + w * 0.5, baseline + 2, sx + w * 0.8, baseline - 2, nx, baseline + jitter(1.5));
    } else {
      // x-height zigzag for the rest (m n u v w r i z x).
      curve(sx + w * 0.25, baseline - xHeight * 1.2, sx + w * 0.45, baseline - xHeight * 1.2, sx + w * 0.6, baseline - 1);
      curve(sx + w * 0.7, baseline + 2, sx + w * 0.85, baseline - 3, nx, baseline + jitter(1.5));
    }
    if (DOTTED.has(letter)) dot(sx + w * 0.45 + jitter(1), baseline - xHeight - 5 + jitter(1.5));
  };

  const ligature = () => {
    const nx = x + 14;
    curve(x + 4, baseline - 6, x + 9, baseline - xHeight * 0.8, nx, baseline - 2);
  };

  words.forEach((word, index) => {
    if (index > 0) {
      if (joins) ligature();
      else move(x + 12, baseline - 1);
    }
    capital(word[0]);
    const rest = word.slice(1).toLowerCase();
    // Long words are written faster: only every second letter gets a stroke.
    const letters = hurried && rest.length > 6 ? rest.split('').filter((_, i) => i % 2 === 0) : rest.split('');
    for (const letter of letters) lowercase(letter);
    // The pen goes back for the bars and dots of this word.
    strokes.push(...later);
    later = [];
  });

  // Closing swash: a flick up, then a long sweep back under the name.
  const endX = x;
  curve(endX + 10, baseline - 18, endX + 22, baseline - 24, endX + 16, baseline - 8);
  curve(endX + 6, baseline + 10, Math.max(30, endX * 0.4), baseline + 14 + jitter(3), 26, baseline + 8 + jitter(2));
  if (paraph) {
    // A short slash and a dot after the name, the mark of a signature in a hurry.
    move(endX + 6, baseline + 7);
    curve(endX + 10, baseline + 3, endX + 16, baseline - 1, endX + 22, baseline - 2);
    dot(endX + 27, baseline + 1);
    strokes.push(...later);
    later = [];
  }
  lift();

  // The hand's slant and the roll of its baseline, then a fit into the box.
  const placed = strokes.map((stroke) =>
    stroke.map(([px, py]): Point => {
      const rolled = py + drift * (px - 22) + Math.sin(px / 47) * roll;
      return [px + (baseline - rolled) * slant, rolled];
    })
  );
  let minX = Infinity;
  let maxX = -Infinity;
  for (const stroke of placed) for (const [px] of stroke) {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
  }
  const room = VIEW_W - 24;
  const scale = maxX - minX > room ? room / (maxX - minX) : 1;
  const fitted = placed.map((stroke) => stroke.map(([px, py]): Point => [12 + (px - minX) * scale, py]));
  return {strokes: fitted, weight: weight * Math.max(0.7, scale)};
}

/**
 * The outline of a stroke drawn with pressure: wide on the downstrokes,
 * thin on the rises and the fast sweeps, tapered at both ends.
 */
function ribbon(points: Point[], base: number): string {
  const n = points.length;
  if (n < 2) return '';
  const along: number[] = [0];
  for (let i = 1; i < n; i += 1) along.push(along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = along[n - 1] || 1;
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const [px, py] = points[i];
    const [ax, ay] = points[Math.max(0, i - 1)];
    const [bx, by] = points[Math.min(n - 1, i + 1)];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const tx = (bx - ax) / len;
    const ty = (by - ay) / len;
    // A nib presses on the way down and lifts on the way up.
    const pressure = 0.32 + 0.68 * (0.5 + 0.5 * ty);
    // A fast sweep thins the line.
    const local = (i > 0 ? along[i] - along[i - 1] : 0) + (i < n - 1 ? along[i + 1] - along[i] : 0);
    const speed = Math.max(0.5, 1.05 - local / 26);
    const at = along[i] / total;
    const taper = Math.min(1, at / 0.08 + 0.12, (1 - at) / 0.08 + 0.12);
    const half = (base * pressure * speed * taper) / 2;
    left.push([px - ty * half, py + tx * half]);
    right.push([px + ty * half, py - tx * half]);
  }
  const forward = left.map(([px, py], i) => `${i ? 'L' : 'M'} ${f(px)} ${f(py)}`).join(' ');
  const back = right
    .reverse()
    .map(([px, py]) => `L ${f(px)} ${f(py)}`)
    .join(' ');
  return `${forward} ${back} Z`;
}

const centreline = (strokes: Point[][]): string => strokes.map((stroke) => stroke.map(([px, py], i) => `${i ? 'L' : 'M'} ${f(px)} ${f(py)}`).join(' ')).join(' ');

/**
 * Returns the SVG path data of the pen's centre line for a name: moves and
 * lines, one sub-path per stroke.
 *
 * @param name  the person's name
 * @param seed  any stable per-person string (account id)
 */
export function signaturePath(name: string, seed = ''): string {
  return centreline(skeleton(name, seed).strokes);
}

/** Full SVG markup, ready to be embedded in HTML or a PDF. */
export function generateSignatureSvg(name: string, seed = '', color = '#12121a'): string {
  const {strokes, weight} = skeleton(name, seed);
  const ink = strokes.map((stroke) => ribbon(stroke, weight)).filter(Boolean).join(' ');
  const centre = centreline(strokes);
  const label = String(name || '').replace(/[<>&"]/g, '');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}" role="img" aria-label="${label} aláírása">` +
    `<path d="${ink}" fill="${color}" fill-opacity="0.32" transform="translate(0.7 0.5)"/>` +
    `<path d="${ink}" fill="${color}"/>` +
    `<path d="${centre}" fill="none" stroke="${color}" stroke-width="0.6" stroke-opacity="0.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

export const SIGNATURE_VIEWBOX = {width: VIEW_W, height: VIEW_H};

/** Path data as the signature pad produces it: moves, lines and cubic curves only. */
export const SIGNATURE_PATH_PATTERN = /^[MLCQZmlcqz0-9.,\s-]+$/;

/** Wraps hand-drawn path data (in the signature view box) as the stored SVG. */
export function svgFromPath(d: string, name = '', color = '#12121a'): string {
  const label = String(name || '').replace(/[<>&"]/g, '');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}" role="img" aria-label="${label} aláírása">` +
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

/** Wraps an uploaded, background-stripped PNG (data URL) as the stored SVG. */
export function svgFromImage(dataUrl: string, name = ''): string {
  const label = String(name || '').replace(/[<>&"]/g, '');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}" role="img" aria-label="${label} aláírása">` +
    `<image href="${dataUrl}" xlink:href="${dataUrl}" x="0" y="0" width="${VIEW_W}" height="${VIEW_H}" preserveAspectRatio="xMidYMid meet"/>` +
    `</svg>`
  );
}

/** The embedded picture of an uploaded signature, or null for a drawn one. */
export function signatureImageData(svg: string | null | undefined): string | null {
  const match = String(svg || '').match(/href="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/);
  return match ? match[1] : null;
}
