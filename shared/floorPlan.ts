/**
 * The floor plan: the room as data, shared by the site and the server.
 *
 * A plan is a rectangle in plan units (any unit, the drawing scales), with
 * zones (named areas), features (bar, stage, walls, sofas, doors — the
 * scenery) and tables (what a guest can book). Seats are not listed one by
 * one: a table says how many it has and on which sides, and the drawing
 * places them. Dependency-free on purpose, like shared/signature.ts.
 */

export type TableShape = 'round' | 'square' | 'rect' | 'booth';
export type TableSide = 'top' | 'right' | 'bottom' | 'left';
export type HouseTier = 'silver' | 'gold' | 'black' | 'royal';
export type SeatStyle = 'chair' | 'armchair';
export type FeatureKind = 'wall' | 'sofa' | 'bar' | 'stage' | 'speaker' | 'dance' | 'door' | 'stairs' | 'pillar' | 'plant' | 'seat' | 'stool' | 'restroom' | 'area' | 'text';

export interface FloorZone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the name is written; defaults to the top-left corner. */
  labelX?: number;
  labelY?: number;
}

export interface FloorFeature {
  id: string;
  kind: FeatureKind;
  label?: string;
  /** Centre for shapes; for a polygon bar, where the label goes. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Degrees, clockwise, around the centre. */
  rotation?: number;
  /** Walls, sofas and curved bars: a polyline of [x, y] points, drawn smoothed; `w` is the sofa's or counter's thickness. */
  points?: [number, number][];
  /** Bars: which side the stools sit on ("none" for none). A rectangle names a side; a path bar says left or right of its direction. */
  stoolSide?: TableSide | 'none';
  /** Bars: how many stools; default from the length. */
  stools?: number;
}

export interface FloorTable {
  /** Stable id, used on bookings ("T7"). Never reuse one for another table. */
  id: string;
  /** What people see ("7", "VIP 1"). */
  label: string;
  zone?: string;
  shape: TableShape;
  /** Centre. */
  x: number;
  y: number;
  /** Size; a round table's w is its diameter (h is ignored). */
  w: number;
  h: number;
  rotation?: number;
  /** Capacity. */
  seats: number;
  /** Smallest party the table is given to. Default 1. */
  minGuests?: number;
  /** Which sides carry seats. Default: all four (booth: left, top, right). */
  seatSides?: TableSide[];
  /** Exactly how many seats sit on each side; must add up to `seats`. */
  seatCounts?: Partial<Record<TableSide, number>>;
  /** How the seats are drawn. Default chair. */
  seatStyle?: SeatStyle;
  /** Booths draw a bench around the seated sides; false when the room's sofa is drawn as a feature. */
  bench?: boolean;
  /** Seats are drawn around the table unless false (a lounge whose sofa is a feature). */
  drawSeats?: boolean;
  /** House tier needed to book it. */
  minTier?: HouseTier;
  tags?: string[];
  /** Shown to the guest when the table is selected. */
  note?: string;
  /** Inactive tables are drawn but cannot be booked. Default true. */
  active?: boolean;
}

export interface FloorPlan {
  version: 1;
  name: string;
  width: number;
  height: number;
  zones: FloorZone[];
  features: FloorFeature[];
  tables: FloorTable[];
}

/** How long a booking holds a table, from its start. */
export const RESERVATION_SLOT_MINUTES = 150;

export const TABLE_SHAPES: TableShape[] = ['round', 'square', 'rect', 'booth'];
export const TABLE_SIDES: TableSide[] = ['top', 'right', 'bottom', 'left'];
export const SEAT_STYLES: SeatStyle[] = ['chair', 'armchair'];
export const FEATURE_KINDS: FeatureKind[] = ['wall', 'sofa', 'bar', 'stage', 'speaker', 'dance', 'door', 'stairs', 'pillar', 'plant', 'seat', 'stool', 'restroom', 'area', 'text'];
export const HOUSE_TIERS: HouseTier[] = ['silver', 'gold', 'black', 'royal'];

/** Kinds drawn from a list of points rather than a box. */
const LINE_KINDS: FeatureKind[] = ['wall', 'sofa'];

const TIER_RANK: Record<string, number> = {none: 0, silver: 1, gold: 2, black: 3, royal: 4};
export const tierRank = (tier: string | undefined | null): number => TIER_RANK[tier || 'none'] || 0;

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

class PlanError extends Error {}

const num = (value: unknown, path: string, {min = -Infinity, max = Infinity, fallback}: {min?: number; max?: number; fallback?: number} = {}): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new PlanError(`${path}: szám kell.`);
  if (n < min || n > max) throw new PlanError(`${path}: ${min}–${max} között legyen.`);
  return n;
};

const str = (value: unknown, path: string, {max = 80, required = false}: {max?: number; required?: boolean} = {}): string => {
  if (value === undefined || value === null) {
    if (required) throw new PlanError(`${path}: kötelező.`);
    return '';
  }
  if (typeof value !== 'string') throw new PlanError(`${path}: szöveg kell.`);
  const clean = value.trim();
  if (required && !clean) throw new PlanError(`${path}: kötelező.`);
  if (clean.length > max) throw new PlanError(`${path}: legfeljebb ${max} karakter.`);
  return clean;
};

const list = (value: unknown, path: string): unknown[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PlanError(`${path}: lista kell.`);
  return value;
};

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlanError(`${path}: objektum kell.`);
  return value as Record<string, unknown>;
};

const pointList = (value: unknown, path: string, least: number): [number, number][] => {
  const points = list(value, path).map((point, p) => {
    if (!Array.isArray(point) || point.length !== 2) throw new PlanError(`${path}[${p}]: [x, y] pár kell.`);
    return [num(point[0], `${path}[${p}][0]`), num(point[1], `${path}[${p}][1]`)] as [number, number];
  });
  if (points.length < least) throw new PlanError(`${path}: legalább ${least} pont kell.`);
  return points;
};

/** Default size of a box feature, by kind. */
export const featureSize = (kind: FeatureKind): [number, number] => {
  if (kind === 'pillar' || kind === 'plant') return [24, 24];
  if (kind === 'seat') return [14, 14];
  if (kind === 'stool') return [12, 12];
  if (kind === 'speaker') return [50, 50];
  return [80, 40];
};

/**
 * Checks a plan (parsed JSON) and returns it in canonical shape, or throws
 * an Error whose message says what is wrong and where. Same code on both
 * sides, so the console's preview and the server agree.
 */
export function normalizeFloorPlan(input: unknown): FloorPlan {
  const raw = record(input, 'plan');
  const width = num(raw.width, 'width', {min: 200, max: 10000});
  const height = num(raw.height, 'height', {min: 200, max: 10000});
  const name = str(raw.name, 'name', {max: 80}) || 'Red Moon';

  const zones: FloorZone[] = list(raw.zones, 'zones').map((entry, index) => {
    const zone = record(entry, `zones[${index}]`);
    const out: FloorZone = {
      id: str(zone.id, `zones[${index}].id`, {max: 40, required: true}),
      name: str(zone.name, `zones[${index}].name`, {max: 60, required: true}),
      x: num(zone.x, `zones[${index}].x`),
      y: num(zone.y, `zones[${index}].y`),
      w: num(zone.w, `zones[${index}].w`, {min: 1}),
      h: num(zone.h, `zones[${index}].h`, {min: 1})
    };
    if (zone.labelX !== undefined) out.labelX = num(zone.labelX, `zones[${index}].labelX`);
    if (zone.labelY !== undefined) out.labelY = num(zone.labelY, `zones[${index}].labelY`);
    return out;
  });

  const features: FloorFeature[] = list(raw.features, 'features').map((entry, index) => {
    const feature = record(entry, `features[${index}]`);
    const path = `features[${index}]`;
    const kind = str(feature.kind, `${path}.kind`, {required: true}) as FeatureKind;
    if (!FEATURE_KINDS.includes(kind)) throw new PlanError(`${path}.kind: ismeretlen (${FEATURE_KINDS.join(', ')}).`);
    const out: FloorFeature = {id: str(feature.id, `${path}.id`, {max: 40}) || `f${index + 1}`, kind};
    const label = str(feature.label, `${path}.label`, {max: 60});
    if (label) out.label = label;
    const rotation = num(feature.rotation, `${path}.rotation`, {fallback: 0});
    if (rotation) out.rotation = rotation;

    if (LINE_KINDS.includes(kind)) {
      out.points = pointList(feature.points, `${path}.points`, 2);
      if (kind === 'sofa') out.w = num(feature.w, `${path}.w`, {min: 8, max: 200, fallback: 34});
      return out;
    }
    if (kind === 'bar' && feature.points !== undefined) {
      // A curved counter along a path; x/y only say where the label goes.
      out.points = pointList(feature.points, `${path}.points`, 2);
      out.w = num(feature.w, `${path}.w`, {min: 8, max: 400, fallback: 60});
      if (feature.x !== undefined) out.x = num(feature.x, `${path}.x`);
      if (feature.y !== undefined) out.y = num(feature.y, `${path}.y`);
    } else {
      out.x = num(feature.x, `${path}.x`);
      out.y = num(feature.y, `${path}.y`);
      if (kind !== 'text') {
        const [dw, dh] = featureSize(kind);
        out.w = num(feature.w, `${path}.w`, {min: 1, fallback: dw});
        out.h = num(feature.h, `${path}.h`, {min: 1, fallback: kind === 'pillar' || kind === 'plant' || kind === 'seat' || kind === 'stool' || kind === 'speaker' ? out.w : dh});
      }
    }
    if (kind === 'bar') {
      const side = str(feature.stoolSide, `${path}.stoolSide`, {max: 8});
      if (side) {
        if (side !== 'none' && !TABLE_SIDES.includes(side as TableSide)) throw new PlanError(`${path}.stoolSide: top, right, bottom, left vagy none.`);
        out.stoolSide = side as TableSide | 'none';
      }
      if (feature.stools !== undefined) out.stools = num(feature.stools, `${path}.stools`, {min: 0, max: 60});
    }
    return out;
  });

  const ids = new Set<string>();
  const tables: FloorTable[] = list(raw.tables, 'tables').map((entry, index) => {
    const table = record(entry, `tables[${index}]`);
    const path = `tables[${index}]`;
    const id = str(table.id, `${path}.id`, {max: 40, required: true});
    if (ids.has(id)) throw new PlanError(`${path}.id: "${id}" kétszer szerepel.`);
    ids.add(id);
    const shape = (str(table.shape, `${path}.shape`) || 'round') as TableShape;
    if (!TABLE_SHAPES.includes(shape)) throw new PlanError(`${path}.shape: ismeretlen (${TABLE_SHAPES.join(', ')}).`);
    const w = num(table.w, `${path}.w`, {min: 8, max: 2000, fallback: shape === 'round' ? 48 : 80});
    const h = shape === 'round' ? w : num(table.h, `${path}.h`, {min: 8, max: 2000, fallback: shape === 'square' ? w : 56});
    const seats = num(table.seats, `${path}.seats`, {min: 1, max: 40});
    const minGuests = num(table.minGuests, `${path}.minGuests`, {min: 1, max: 40, fallback: 1});
    if (minGuests > seats) throw new PlanError(`${path}.minGuests: nem lehet több a székek számánál.`);
    const out: FloorTable = {
      id,
      label: str(table.label, `${path}.label`, {max: 24}) || id,
      shape,
      x: num(table.x, `${path}.x`),
      y: num(table.y, `${path}.y`),
      w,
      h,
      seats
    };
    const zone = str(table.zone, `${path}.zone`, {max: 40});
    if (zone) {
      if (!zones.some((entry) => entry.id === zone)) throw new PlanError(`${path}.zone: nincs "${zone}" nevű zóna.`);
      out.zone = zone;
    }
    const rotation = num(table.rotation, `${path}.rotation`, {fallback: 0});
    if (rotation) out.rotation = rotation;
    if (minGuests > 1) out.minGuests = minGuests;
    const sides = list(table.seatSides, `${path}.seatSides`).map((side) => {
      if (typeof side !== 'string' || !TABLE_SIDES.includes(side as TableSide)) throw new PlanError(`${path}.seatSides: top, right, bottom vagy left.`);
      return side as TableSide;
    });
    if (sides.length) out.seatSides = sides;
    if (table.seatCounts !== undefined) {
      const counts = record(table.seatCounts, `${path}.seatCounts`);
      const out2: Partial<Record<TableSide, number>> = {};
      let sum = 0;
      for (const [side, value] of Object.entries(counts)) {
        if (!TABLE_SIDES.includes(side as TableSide)) throw new PlanError(`${path}.seatCounts: top, right, bottom vagy left.`);
        const count = num(value, `${path}.seatCounts.${side}`, {min: 0, max: 40});
        if (count) out2[side as TableSide] = count;
        sum += count;
      }
      if (sum !== seats) throw new PlanError(`${path}.seatCounts: összesen ${sum}, de seats = ${seats}.`);
      out.seatCounts = out2;
    }
    const seatStyle = str(table.seatStyle, `${path}.seatStyle`, {max: 12});
    if (seatStyle) {
      if (!SEAT_STYLES.includes(seatStyle as SeatStyle)) throw new PlanError(`${path}.seatStyle: chair vagy armchair.`);
      out.seatStyle = seatStyle as SeatStyle;
    }
    if (table.bench === false) out.bench = false;
    if (table.drawSeats === false) out.drawSeats = false;
    const minTier = str(table.minTier, `${path}.minTier`, {max: 12});
    if (minTier) {
      if (!HOUSE_TIERS.includes(minTier as HouseTier)) throw new PlanError(`${path}.minTier: silver, gold, black vagy royal.`);
      out.minTier = minTier as HouseTier;
    }
    const tags = list(table.tags, `${path}.tags`).map((tag, t) => str(tag, `${path}.tags[${t}]`, {max: 30})).filter(Boolean);
    if (tags.length) out.tags = tags.slice(0, 6);
    const note = str(table.note, `${path}.note`, {max: 200});
    if (note) out.note = note;
    if (table.active === false) out.active = false;
    return out;
  });
  if (!tables.length) throw new PlanError('tables: legalább egy asztal kell.');

  return {version: 1, name, width, height, zones, features, tables};
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export interface SeatSpot {
  x: number;
  y: number;
  /** Degrees, the direction the seat faces away from the table. */
  angle: number;
}

const SEAT_GAP = 14;

/** Where the seats sit, relative to the table's centre, before rotation. */
export function seatPositions(table: FloorTable): SeatSpot[] {
  const n = Math.max(0, Math.min(40, Math.round(table.seats)));
  if (!n) return [];
  if (table.shape === 'round') {
    const r = table.w / 2 + SEAT_GAP;
    return Array.from({length: n}, (_, i) => {
      const angle = -90 + (360 / n) * i;
      const rad = (angle * Math.PI) / 180;
      return {x: Math.cos(rad) * r, y: Math.sin(rad) * r, angle};
    });
  }
  const length = (side: TableSide) => (side === 'top' || side === 'bottom' ? table.w : table.h);
  let sides: TableSide[];
  let counts: number[];
  if (table.seatCounts) {
    sides = TABLE_SIDES.filter((side) => (table.seatCounts?.[side] || 0) > 0);
    counts = sides.map((side) => table.seatCounts?.[side] || 0);
  } else {
    sides = table.seatSides?.length ? table.seatSides : table.shape === 'booth' ? ['left', 'top', 'right'] : ['top', 'bottom', 'right', 'left'];
    // Seats go to the sides in proportion to their length, longest sides first.
    const total = sides.reduce((sum, side) => sum + length(side), 0) || 1;
    counts = sides.map((side) => Math.floor((n * length(side)) / total));
    let left = n - counts.reduce((sum, count) => sum + count, 0);
    const order = sides.map((side, index) => ({index, remainder: (n * length(side)) / total - counts[index]})).sort((a, b) => b.remainder - a.remainder);
    for (const entry of order) {
      if (left <= 0) break;
      counts[entry.index] += 1;
      left -= 1;
    }
  }
  const spots: SeatSpot[] = [];
  sides.forEach((side, index) => {
    const count = counts[index];
    for (let i = 0; i < count; i += 1) {
      const t = (i + 1) / (count + 1);
      if (side === 'top') spots.push({x: -table.w / 2 + table.w * t, y: -table.h / 2 - SEAT_GAP, angle: -90});
      else if (side === 'bottom') spots.push({x: -table.w / 2 + table.w * t, y: table.h / 2 + SEAT_GAP, angle: 90});
      else if (side === 'left') spots.push({x: -table.w / 2 - SEAT_GAP, y: -table.h / 2 + table.h * t, angle: 180});
      else spots.push({x: table.w / 2 + SEAT_GAP, y: -table.h / 2 + table.h * t, angle: 0});
    }
  });
  return spots;
}

/** A smooth curve through the points (Catmull-Rom as cubic Béziers), as an SVG path. */
export function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

export interface TableWindow {
  tableId: string;
  from: string;
  to: string;
}

export type TableState = 'free' | 'taken' | 'unfit' | 'locked' | 'inactive';

/** [aFrom, aTo) and [bFrom, bTo) share a moment. */
export const windowsOverlap = (aFrom: number, aTo: number, bFrom: number, bTo: number): boolean => aFrom < bTo && bFrom < aTo;

/** The windows on a table that touch [at, at + slot). */
export function tableClashes(table: FloorTable, at: Date, slotMinutes: number, windows: TableWindow[]): TableWindow[] {
  const from = at.getTime();
  const to = from + slotMinutes * 60000;
  return windows.filter((window) => window.tableId === table.id && windowsOverlap(from, to, new Date(window.from).getTime(), new Date(window.to).getTime()));
}

/** What a table is to this party at this time. */
export function tableState(table: FloorTable, at: Date, slotMinutes: number, windows: TableWindow[], guests?: number, tier?: string): TableState {
  if (table.active === false) return 'inactive';
  if (tableClashes(table, at, slotMinutes, windows).length) return 'taken';
  if (guests !== undefined && (guests > table.seats || guests < (table.minGuests || 1))) return 'unfit';
  if (table.minTier && tier !== undefined && tierRank(tier) < tierRank(table.minTier)) return 'locked';
  return 'free';
}

/* ------------------------------------------------------------------ */
/* The house's room — laid out from the blueprint, drawn our way       */
/* ------------------------------------------------------------------ */

/** Points along a circle arc, screen angles (0° right, 90° down). */
export function arcPoints(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, steps = 16): [number, number][] {
  return Array.from({length: steps + 1}, (_, i) => {
    const angle = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    return [Math.round(cx + Math.cos(angle) * r), Math.round(cy + Math.sin(angle) * r)] as [number, number];
  });
}

/** A lounge: a crescent sofa around a low table; `gap` is the screen angle the opening faces. */
const lounge = (id: string, label: string, zone: string, x: number, y: number, gap: number, minTier: HouseTier): {sofa: FloorFeature; table: FloorTable} => ({
  sofa: {id: `${id}-sofa`, kind: 'sofa', points: arcPoints(x, y, 94, gap + 56, gap + 304, 18), w: 30},
  table: {id, label, zone, shape: 'booth', x, y, w: 118, h: 60, seats: 10, minTier, drawSeats: false, bench: false, tags: ['vip', 'kanapé'], note: 'Prémium kanapé a ház belső körének — a saját asztal körül, legfeljebb tíz főnek.'}
});

const L1 = lounge('L1', 'LOUNGE 1', 'club', 250, 735, 0, 'gold');
const L2 = lounge('L2', 'LOUNGE 2', 'club', 250, 965, 0, 'gold');
const L3 = lounge('L3', 'LOUNGE 3', 'lounge', 520, 1240, 270, 'silver');
const L4 = lounge('L4', 'LOUNGE 4', 'lounge', 800, 1240, 270, 'silver');

export const DEFAULT_FLOOR_PLAN: FloorPlan = {
  version: 1,
  name: 'Red Moon Pub',
  width: 1000,
  height: 1500,
  zones: [
    {id: 'main', name: 'Nagyterem', x: 40, y: 40, w: 920, h: 520, labelX: 215, labelY: 78},
    {id: 'club', name: 'Klub & Tánctér', x: 40, y: 580, w: 920, h: 500, labelX: 410, labelY: 622},
    {id: 'lounge', name: 'Lounge & Kis bár', x: 40, y: 1080, w: 920, h: 380, labelX: 410, labelY: 1120}
  ],
  features: [
    {id: 'walls', kind: 'wall', points: [[40, 40], [960, 40], [960, 1460], [40, 1460], [40, 40]]},
    {id: 'divider-left', kind: 'wall', points: [[40, 580], [440, 580]]},
    {id: 'divider-right', kind: 'wall', points: [[660, 580], [960, 580]]},
    {id: 'stairs', kind: 'stairs', label: 'LÉPCSŐ · ÁTJÁRÓ', x: 550, y: 580, w: 200, h: 44},
    {id: 'wc-women', kind: 'restroom', label: 'NŐI', x: 95, y: 120, w: 110, h: 150},
    {id: 'wc-men', kind: 'restroom', label: 'FÉRFI', x: 95, y: 285, w: 110, h: 150},
    {id: 'wc-door-women', kind: 'door', label: '', x: 152, y: 120, w: 22, h: 4, rotation: 90},
    {id: 'wc-door-men', kind: 'door', label: '', x: 152, y: 285, w: 22, h: 4, rotation: 90},
    {id: 'wait-1', kind: 'seat', x: 195, y: 100},
    {id: 'wait-2', kind: 'seat', x: 195, y: 140},
    {id: 'wait-3', kind: 'seat', x: 195, y: 180},
    {id: 'wait-4', kind: 'seat', x: 195, y: 220},
    {id: 'pillar', kind: 'pillar', label: 'OSZLOP', x: 560, y: 410, w: 100, h: 64},
    {id: 'pillar-seat-1', kind: 'seat', x: 634, y: 393},
    {id: 'pillar-seat-2', kind: 'seat', x: 634, y: 427},
    {id: 'bar-main', kind: 'bar', label: 'PUN · NAGY PULT', points: [[918, 90], [890, 200], [876, 310], [890, 420], [918, 530]], w: 66, stools: 12, stoolSide: 'right', x: 924, y: 310, rotation: 90},
    {id: 'dance', kind: 'dance', label: 'TÁNCPARKETT', x: 560, y: 830, w: 300, h: 270},
    {id: 'dj', kind: 'stage', label: 'DJ', x: 860, y: 830, w: 150, h: 90},
    {id: 'speaker-top', kind: 'speaker', label: 'HANGFAL', x: 860, y: 700, w: 56, h: 56},
    {id: 'speaker-bottom', kind: 'speaker', label: 'HANGFAL', x: 860, y: 960, w: 56, h: 56},
    L1.sofa,
    L2.sofa,
    L3.sofa,
    L4.sofa,
    {id: 'office', kind: 'area', label: 'IRODA', x: 125, y: 1330, w: 150, h: 210},
    {id: 'office-door', kind: 'door', label: '', x: 185, y: 1225, w: 22, h: 4},
    {id: 'bar-small', kind: 'bar', label: 'PUK · KIS PULT', points: [[430, 1430], [890, 1430]], w: 50, stools: 8, stoolSide: 'left', x: 660, y: 1430}
  ],
  tables: [
    {id: 'T1', label: '1', zone: 'main', shape: 'rect', x: 330, y: 200, w: 120, h: 170, seats: 8, minGuests: 4, seatCounts: {top: 1, left: 3, right: 3, bottom: 1}, seatStyle: 'armchair', tags: ['fotelek', 'nagy társaság'], note: 'Hét fotel és egy szék — a nagyterem legnagyobb asztala.'},
    {id: 'T2', label: '2', zone: 'main', shape: 'rect', x: 650, y: 150, w: 100, h: 84, seats: 4, minGuests: 2, seatCounts: {top: 1, right: 1, bottom: 1, left: 1}, seatStyle: 'armchair', tags: ['fotelek'], note: 'Négy fotel a terem közepén.'},
    {id: 'T3', label: '3', zone: 'main', shape: 'rect', x: 245, y: 420, w: 84, h: 64, seats: 2, seatCounts: {left: 1, right: 1}, seatStyle: 'armchair', tags: ['fotelek', 'kettesben'], note: 'Két fotel, egymással szemben.'},
    {id: 'T4', label: '4', zone: 'main', shape: 'rect', x: 390, y: 500, w: 84, h: 64, seats: 3, seatCounts: {top: 1, right: 1, bottom: 1}, seatStyle: 'armchair', tags: ['fotelek'], note: 'Három fotel.'},
    {id: 'T5', label: '5', zone: 'main', shape: 'rect', x: 245, y: 528, w: 84, h: 64, seats: 3, seatCounts: {top: 1, left: 1, bottom: 1}, tags: ['vegyes'], note: 'Két szék és egy fotel.'},
    L1.table,
    L2.table,
    L3.table,
    L4.table
  ]
};
