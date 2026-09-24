/**
 * Blip categories.
 *
 * The GTA tile pack ships no blip sprites, so markers are drawn as CSS instead
 * of PNGs. That also means they can animate, scale with zoom and stay crisp.
 * Mirrors BLIP_KINDS in server/routes/house.ts.
 */

export type BlipKind = 'hq' | 'bar' | 'event' | 'meeting' | 'parking' | 'food' | 'shop' | 'garage' | 'hospital' | 'police' | 'danger' | 'info' | 'custom';

/** Three families, for the legend and the filter row. */
export type BlipGroup = 'haz' | 'varos' | 'jelzes';

export interface BlipStyle {
  kind: BlipKind;
  label: string;
  /** Single glyph rendered inside the marker disc. */
  glyph: string;
  /** Ring / glow colour. */
  color: string;
  group: BlipGroup;
  /** One line for the legend. */
  hint: string;
  /** Larger, permanently pulsing markers for the places that matter most. */
  major?: boolean;
}

export const BLIP_GROUP_LABEL: Record<BlipGroup, string> = {
  haz: 'A HÁZ KÖRÜL',
  varos: 'A VÁROS',
  jelzes: 'JELZÉSEK'
};

export const BLIP_GROUPS: BlipGroup[] = ['haz', 'varos', 'jelzes'];

export const BLIP_STYLES: Record<BlipKind, BlipStyle> = {
  hq: {kind: 'hq', label: 'Red Moon', glyph: '月', color: '#ff2b4f', group: 'haz', hint: 'A ház maga. Ide jössz.', major: true},
  event: {kind: 'event', label: 'Rendezvény', glyph: '★', color: '#ff8a3d', group: 'haz', hint: 'Ahol egy este a házon kívül történik.', major: true},
  meeting: {kind: 'meeting', label: 'Találkozó', glyph: '◈', color: '#5ac8fa', group: 'haz', hint: 'Gyülekező, indulás előtt.'},
  parking: {kind: 'parking', label: 'Parkoló', glyph: 'P', color: '#9b8cff', group: 'haz', hint: 'Ahol nyugodtan hagyod a kocsit.'},
  bar: {kind: 'bar', label: 'Bár', glyph: '酒', color: '#e3284e', group: 'varos', hint: 'Más házak, ha már arra jársz.'},
  food: {kind: 'food', label: 'Étel', glyph: '食', color: '#ffb347', group: 'varos', hint: 'Ahol enni lehet, előtte vagy utána.'},
  shop: {kind: 'shop', label: 'Bolt', glyph: '店', color: '#f2d16b', group: 'varos', hint: 'Bolt, üzlet, beszerzés.'},
  garage: {kind: 'garage', label: 'Garázs', glyph: '車', color: '#8fa3b8', group: 'varos', hint: 'Szerelő, garázs, tankolás.'},
  hospital: {kind: 'hospital', label: 'Kórház', glyph: '+', color: '#ff6b81', group: 'varos', hint: 'Ha nagy a baj.'},
  police: {kind: 'police', label: 'Rendőrség', glyph: '警', color: '#4c8dff', group: 'varos', hint: 'Jobb tudni, hol van.'},
  danger: {kind: 'danger', label: 'Veszély', glyph: '!', color: '#ff3b30', group: 'jelzes', hint: 'Kerüld, főleg éjjel.'},
  info: {kind: 'info', label: 'Infó', glyph: 'i', color: '#63e7a9', group: 'jelzes', hint: 'Jó tudni.'},
  custom: {kind: 'custom', label: 'Egyéb', glyph: '●', color: '#c9c0c4', group: 'jelzes', hint: 'Ami sehova máshova nem fér.'}
};

export const BLIP_KINDS = Object.keys(BLIP_STYLES) as BlipKind[];

export const blipStyle = (kind: string | undefined): BlipStyle =>
  BLIP_STYLES[(kind || 'custom') as BlipKind] || BLIP_STYLES.custom;

/** Escapes text before it goes into marker/popup HTML. */
export const escapeHtml = (value: string): string =>
  String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char] as string)
  );

/** Marker HTML for a Leaflet divIcon. Styled by `.rm-blip*` in blips.css. */
export function blipMarkerHtml(kind: string, label: string, selected = false): string {
  const style = blipStyle(kind);
  return `
    <div class="rm-blip${style.major ? ' is-major' : ''}${selected ? ' is-selected' : ''}" style="--blip-color:${style.color}">
      <span class="rm-blip-pulse"></span>
      <span class="rm-blip-ring"></span>
      <span class="rm-blip-disc">${style.glyph}</span>
      <span class="rm-blip-label">${escapeHtml(label)}</span>
    </div>
  `;
}

/** Straight-line distance in map units, for "what is near the house". */
export const blipDistance = (a: {x: number; y: number}, b: {x: number; y: number}): number => Math.hypot(a.x - b.x, a.y - b.y);
