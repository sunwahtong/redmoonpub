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
 *     (round, upright, diagonal or a cup),
 *   - the remaining letters become a running stroke whose rises and dips
 *     follow the ascenders and descenders of the actual letters,
 *   - words are joined by a ligature, and the whole thing ends in a swash
 *     that runs back under the name.
 *
 * A seeded generator adds the small irregularities of a hand. Dependency-free,
 * shared by the server (storing) and the browser (previewing).
 */

const VIEW_W = 340;
const VIEW_H = 96;

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
const ROUND_CAPS = new Set('CGOQS');
const DIAGONAL_CAPS = new Set('AMNVWXYZ');
const CUP_CAPS = new Set('U');

const f = (n: number): number => Number(n.toFixed(1));

/**
 * Returns the SVG path data for a name.
 *
 * @param name  the person's name
 * @param seed  any stable per-person string (account id)
 */
export function signaturePath(name: string, seed = ''): string {
  const clean = fold(name) || 'Red Moon';
  const random = rng(`${clean}|${seed}`);
  const jitter = (amount: number) => (random() - 0.5) * 2 * amount;

  const words = clean.split(' ').slice(0, 3);
  const baseline = 62;
  const slant = 0.22 + random() * 0.1;
  const xHeight = 11 + random() * 3;
  const capHeight = 30 + random() * 6;

  // Budget the width so long names stay inside the box.
  const letterCount = words.reduce((sum, word) => sum + Math.max(1, word.length - 1), 0);
  const capWidth = 22;
  const available = VIEW_W - 40 - words.length * capWidth - (words.length - 1) * 14;
  const letterWidth = Math.max(4.5, Math.min(11, available / Math.max(1, letterCount)));

  const shear = (px: number, py: number) => px + (baseline - py) * slant;
  let x = 22;
  let y = baseline;
  let d = '';
  const move = (nx: number, ny: number) => {
    x = nx;
    y = ny;
    d += `M ${f(shear(x, y))} ${f(y)}`;
  };
  const curve = (c1x: number, c1y: number, c2x: number, c2y: number, nx: number, ny: number) => {
    d += ` C ${f(shear(c1x, c1y))} ${f(c1y)}, ${f(shear(c2x, c2y))} ${f(c2y)}, ${f(shear(nx, ny))} ${f(ny)}`;
    x = nx;
    y = ny;
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
    } else if (DIAGONAL_CAPS.has(upper)) {
      // A peak: up the left diagonal, down the right, with a little lead-in.
      move(startX - 2, baseline - 6);
      curve(startX + 2, baseline - 14, startX + 6, top + 2, startX + 10, top + jitter(2));
      curve(startX + 13, top + 4, startX + 17, baseline - 10, startX + 21, baseline + jitter(2));
      if (upper === 'M' || upper === 'W') curve(startX + 24, baseline - 18, startX + 27, top + 8, startX + 30, baseline - 2);
    } else if (CUP_CAPS.has(upper)) {
      move(startX, top + 4);
      curve(startX - 2, baseline - 6, startX + 6, baseline + 3, startX + 12, baseline - 4);
      curve(startX + 16, baseline - 10, startX + 18, top + 6, startX + 20, top + 2);
      curve(startX + 21, baseline - 12, startX + 20, baseline - 3, startX + 22, baseline);
    } else {
      // Upright: an entry hook, a tall downstroke and a lobe to the right.
      move(startX - 4, top + 10);
      curve(startX + 2, top - 6, startX + 8, top - 2, startX + 6, top + 4);
      curve(startX + 4, baseline - capHeight * 0.4, startX + 3, baseline - 4, startX + 2, baseline + jitter(2));
      if ('BPRD'.includes(upper)) {
        curve(startX + 10, baseline - capHeight * 0.55, startX + 22, baseline - capHeight * 0.75, startX + 16, baseline - capHeight * 0.45);
        curve(startX + 12, baseline - capHeight * 0.3, startX + 8, baseline - 8, startX + 20, baseline - 2);
      } else if ('KHT'.includes(upper)) {
        curve(startX + 8, baseline - capHeight * 0.6, startX + 16, top + 6, startX + 20, top + 10);
        curve(startX + 14, baseline - capHeight * 0.35, startX + 16, baseline - 6, startX + 22, baseline - 1);
      } else {
        curve(startX + 6, baseline - 10, startX + 14, baseline - 12, startX + 20, baseline - 2);
      }
    }
  };

  const lowercase = (letter: string) => {
    const w = letterWidth + jitter(1.2);
    const nx = x + w;
    if (ASCENDERS.has(letter)) {
      const top = baseline - capHeight * (0.75 + random() * 0.2);
      curve(x + w * 0.2, baseline - xHeight, x + w * 0.35, top, x + w * 0.45, top + jitter(2));
      curve(x + w * 0.55, baseline - xHeight * 0.4, x + w * 0.7, baseline + 2, nx, baseline + jitter(1.5));
    } else if (DESCENDERS.has(letter)) {
      const bottom = baseline + 14 + random() * 8;
      curve(x + w * 0.2, baseline - xHeight * 0.9, x + w * 0.6, baseline - xHeight, x + w * 0.55, baseline);
      curve(x + w * 0.5, bottom, x + w * 0.2, bottom + 2, x + w * 0.45, baseline - xHeight * 0.3);
      curve(x + w * 0.7, baseline - 8, x + w * 0.85, baseline, nx, baseline + jitter(1.5));
    } else if (ROUND.has(letter)) {
      curve(x + w * 0.9, baseline - xHeight * 1.1, x + w * 0.1, baseline - xHeight * 1.1, x + w * 0.3, baseline - 2);
      curve(x + w * 0.5, baseline + 2, x + w * 0.8, baseline - 2, nx, baseline + jitter(1.5));
    } else {
      // x-height zigzag for the rest (m n u v w r i z x).
      curve(x + w * 0.25, baseline - xHeight * 1.2, x + w * 0.45, baseline - xHeight * 1.2, x + w * 0.6, baseline - 1);
      curve(x + w * 0.7, baseline + 2, x + w * 0.85, baseline - 3, nx, baseline + jitter(1.5));
    }
  };

  const ligature = () => {
    const nx = x + 14;
    curve(x + 4, baseline - 6, x + 9, baseline - xHeight * 0.8, nx, baseline - 2);
  };

  words.forEach((word, index) => {
    if (index > 0) ligature();
    capital(word[0]);
    const rest = word.slice(1).toLowerCase();
    // Long words are written faster: only every second letter gets a stroke.
    const letters = rest.length > 7 ? rest.split('').filter((_, i) => i % 2 === 0) : rest.split('');
    for (const letter of letters) lowercase(letter);
  });

  // Closing swash: a flick up, then a long sweep back under the name.
  const endX = x;
  curve(endX + 10, baseline - 18, endX + 22, baseline - 24, endX + 16, baseline - 8);
  curve(endX + 6, baseline + 10, Math.max(30, endX * 0.4), baseline + 14 + jitter(3), 26, baseline + 8 + jitter(2));

  return d;
}

/** Full SVG markup, ready to be embedded in HTML or a PDF. */
export function generateSignatureSvg(name: string, seed = '', color = '#12121a'): string {
  const path = signaturePath(name, seed);
  const label = String(name || '').replace(/[<>&"]/g, '');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}" role="img" aria-label="${label} aláírása">` +
    `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${path}" fill="none" stroke="${color}" stroke-width="0.7" stroke-opacity="0.55" stroke-linecap="round" stroke-linejoin="round" transform="translate(0.6 0.4)"/>` +
    `</svg>`
  );
}

export const SIGNATURE_VIEWBOX = {width: VIEW_W, height: VIEW_H};
