/**
 * The card as a picture, made by the browser and never by a server.
 *
 * The card on the page is an SVG; its PNG is a copy of that SVG drawn into
 * a canvas at three times the size, so it stays crisp on any screen. An SVG
 * drawn into a canvas may not fetch anything, so the page's fonts are
 * fetched once and embedded as data URIs; without them the PNG would fall
 * back to the system's serif.
 */
import {CARD_H, CARD_W} from './houseCard';

/** The families and weights the card uses; nothing else is embedded. */
const FONTS: Record<string, string[]> = {Cinzel: ['600', '700', '800'], 'Noto Sans': ['400', '500']};
const SVG_NS = 'http://www.w3.org/2000/svg';

let fontCss: Promise<string> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x4000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  return btoa(binary);
}

/** Google Fonts serves one @font-face per family, weight and script; only latin and latin-ext are needed. */
async function fetchFontCss(): Promise<string> {
  const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
  if (!link) return '';
  const css = await (await fetch(link.href)).text();
  const faces = css.match(/@font-face\s*{[^}]*}/g) || [];
  const wanted = faces.filter((face) => {
    const family = face.match(/font-family:\s*'([^']+)'/)?.[1] || '';
    const weight = face.match(/font-weight:\s*(\d+)/)?.[1] || '';
    const range = face.match(/unicode-range:\s*([^;]+)/)?.[1] || '';
    return (FONTS[family] || []).includes(weight) && /U\+0000-00FF|U\+0100-02BA/.test(range);
  });
  const embedded = await Promise.all(
    wanted.map(async (face) => {
      const url = face.match(/url\(([^)]+)\)/)?.[1];
      if (!url) return '';
      const bytes = await (await fetch(url)).arrayBuffer();
      return face.replace(/src:[^;]+;/, `src: url(data:font/woff2;base64,${toBase64(bytes)}) format('woff2');`);
    })
  );
  return embedded.join('\n');
}

/** The page's fonts as embeddable CSS; empty when they cannot be fetched. */
export function embeddedFontCss(): Promise<string> {
  if (!fontCss) fontCss = fetchFontCss().catch(() => '');
  return fontCss;
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A kártya rajza nem tölthető be.'));
    image.src = src;
  });

/** Rasterises a card's SVG. Scale 2 gives 2000×1260: sharp on a phone, a few megabytes. */
export async function cardToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-export="skip"]').forEach((node) => node.remove());
  clone.removeAttribute('class');
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(CARD_W));
  clone.setAttribute('height', String(CARD_H));
  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = await embeddedFontCss();
  clone.insertBefore(style, clone.firstChild);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], {type: 'image/svg+xml;charset=utf-8'}));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W * scale;
    canvas.height = CARD_H * scale;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Nincs rajzfelület.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('A PNG nem készült el.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Whether this browser can hand a picture to another app (phones, mostly). */
export function canShareFiles(): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({files: [new File([new Uint8Array(1)], 'x.png', {type: 'image/png'})]});
  } catch {
    return false;
  }
}

/** Shares the picture; false when the browser cannot, so the caller falls back to a download. */
export async function shareBlob(blob: Blob, fileName: string, title: string): Promise<boolean> {
  const file = new File([blob], fileName, {type: 'image/png'});
  if (!canShareFiles() || !navigator.canShare({files: [file]})) return false;
  try {
    await navigator.share({files: [file], title});
    return true;
  } catch (err) {
    return (err as Error).name === 'AbortError';
  }
}
