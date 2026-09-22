/**
 * Blip categories.
 *
 * The GTA tile pack ships no blip sprites, so markers are drawn as CSS instead
 * of PNGs. That also means they can animate, scale with zoom and stay crisp.
 */

export type BlipKind = 'hq' | 'bar' | 'parking' | 'meeting' | 'danger' | 'info' | 'event' | 'custom';

export interface BlipStyle {
  kind: BlipKind;
  label: string;
  /** Single glyph rendered inside the marker disc. */
  glyph: string;
  /** Ring / glow colour. */
  color: string;
  /** Larger, permanently pulsing markers for the places that matter most. */
  major?: boolean;
}

export const BLIP_STYLES: Record<BlipKind, BlipStyle> = {
  hq: {kind: 'hq', label: 'Főhadiszállás', glyph: '月', color: '#ff2b4f', major: true},
  bar: {kind: 'bar', label: 'Bár / Pub', glyph: '🍸', color: '#e3284e'},
  event: {kind: 'event', label: 'Rendezvény', glyph: '★', color: '#ff8a3d', major: true},
  meeting: {kind: 'meeting', label: 'Találkozó', glyph: '◈', color: '#5ac8fa'},
  parking: {kind: 'parking', label: 'Parkoló', glyph: 'P', color: '#9b8cff'},
  danger: {kind: 'danger', label: 'Veszély', glyph: '!', color: '#ff3b30'},
  info: {kind: 'info', label: 'Infó', glyph: 'i', color: '#63e7a9'},
  custom: {kind: 'custom', label: 'Egyéb', glyph: '●', color: '#c9c0c4'}
};

export const BLIP_KINDS = Object.keys(BLIP_STYLES) as BlipKind[];

export const blipStyle = (kind: string | undefined): BlipStyle =>
  BLIP_STYLES[(kind || 'custom') as BlipKind] || BLIP_STYLES.custom;

/** Escapes text before it goes into marker/popup HTML. */
export const escapeHtml = (value: string): string =>
  String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char] as string)
  );

/** Marker HTML for a Leaflet divIcon. Styled by `.rm-blip*` in chrome.css. */
export function blipMarkerHtml(kind: string, label: string): string {
  const style = blipStyle(kind);
  return `
    <div class="rm-blip${style.major ? ' is-major' : ''}" style="--blip-color:${style.color}">
      <span class="rm-blip-pulse"></span>
      <span class="rm-blip-ring"></span>
      <span class="rm-blip-disc">${style.glyph}</span>
      <span class="rm-blip-label">${escapeHtml(label)}</span>
    </div>
  `;
}
