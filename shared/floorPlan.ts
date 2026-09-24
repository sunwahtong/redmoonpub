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
  /** Walls and sofas: a polyline of [x, y] points. A bar may be a polygon instead of a rectangle. */
  points?: [number, number][];
  /** Bars: which side the stools sit on ("none" for none). Default: the long side facing the room. */
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
      return out;
    }
    if (kind === 'bar' && feature.points !== undefined) {
      // A polygon bar; x/y only say where the label goes.
      out.points = pointList(feature.points, `${path}.points`, 3);
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
/* The room, traced from the house's blueprint                         */
/* ------------------------------------------------------------------ */

/** The big bar's stools, along its angled front. */
const MAIN_BAR_STOOLS: [number, number][] = [
  [881, 108], [862, 150], [851, 190], [846, 225], [843, 263], [848, 300],
  [858, 345], [866, 385], [872, 420], [886, 462], [912, 505], [937, 538]
];

export const DEFAULT_FLOOR_PLAN: FloorPlan = {
  version: 1,
  name: 'Red Moon Pub',
  width: 1060,
  height: 1600,
  zones: [
    {id: 'main', name: 'Nagyterem', x: 52, y: 38, w: 958, h: 562, labelX: 230, labelY: 66},
    {id: 'club', name: 'Klub & Tánctér', x: 52, y: 600, w: 958, h: 505, labelX: 430, labelY: 640},
    {id: 'lounge', name: 'Lounge & Kis bár', x: 52, y: 1105, w: 958, h: 455, labelX: 430, labelY: 1132}
  ],
  features: [
    {id: 'walls', kind: 'wall', points: [[52, 38], [1010, 38], [1010, 1560], [52, 1560], [52, 38]]},
    {id: 'divider-left', kind: 'wall', points: [[52, 600], [410, 600]]},
    {id: 'divider-right', kind: 'wall', points: [[650, 600], [1010, 600]]},
    {id: 'stairs', kind: 'stairs', label: 'LÉPCSŐ / ÁTJÁRÓ', x: 530, y: 582, w: 240, h: 36},
    {id: 'wc-women', kind: 'restroom', label: 'NŐI WC', x: 96, y: 114, w: 88, h: 152},
    {id: 'wc-men', kind: 'restroom', label: 'FÉRFI WC', x: 96, y: 268, w: 88, h: 154},
    {id: 'wc-door-women', kind: 'door', label: 'AJTÓ', x: 143, y: 130, w: 26, h: 5, rotation: 90},
    {id: 'wc-door-men', kind: 'door', label: 'AJTÓ', x: 143, y: 255, w: 26, h: 5, rotation: 90},
    {id: 'wc-seat-1', kind: 'seat', x: 157, y: 160},
    {id: 'wc-seat-2', kind: 'seat', x: 157, y: 185},
    {id: 'wc-seat-3', kind: 'seat', x: 157, y: 210},
    {id: 'wc-seat-4', kind: 'seat', x: 157, y: 235},
    {id: 'pillar', kind: 'pillar', label: 'OSZLOP', x: 495, y: 395, w: 100, h: 66},
    {id: 'pillar-seat-1', kind: 'seat', x: 572, y: 378},
    {id: 'pillar-seat-2', kind: 'seat', x: 572, y: 410},
    {id: 'pillar-seats', kind: 'text', label: '2 SZÉK', x: 616, y: 394},
    {id: 'bar-main', kind: 'bar', label: 'PUN · NAGY PULT', points: [[918, 95], [1005, 95], [1005, 555], [918, 555], [872, 300]], x: 962, y: 325, rotation: 90, stoolSide: 'none'},
    ...MAIN_BAR_STOOLS.map(([x, y], index) => ({id: `bar-main-stool-${index + 1}`, kind: 'stool' as const, x, y})),
    {id: 'dance', kind: 'dance', label: 'TÁNCPARKETT', x: 579, y: 845, w: 302, h: 280},
    {id: 'dj', kind: 'stage', label: 'DJ PULT', x: 876, y: 847, w: 152, h: 90},
    {id: 'speaker-top', kind: 'speaker', label: 'HANGFAL', x: 876, y: 735, w: 60, h: 60},
    {id: 'speaker-bottom', kind: 'speaker', label: 'HANGFAL', x: 876, y: 955, w: 60, h: 60},
    {
      id: 'sofa-club',
      kind: 'sofa',
      points: [[55, 668], [150, 650], [250, 652], [330, 680], [368, 730], [345, 742], [250, 736], [150, 748], [118, 790], [120, 850], [160, 882], [260, 878], [340, 896], [368, 940], [345, 1010], [250, 1018], [150, 1026], [118, 1058], [140, 1084], [250, 1092], [368, 1080]]
    },
    {
      id: 'sofa-lounge',
      kind: 'sofa',
      points: [[275, 1348], [300, 1250], [355, 1165], [420, 1200], [470, 1280], [520, 1335], [575, 1300], [620, 1220], [680, 1152], [735, 1190], [762, 1262], [820, 1330], [880, 1348], [930, 1338]]
    },
    {id: 'office', kind: 'area', label: 'IRODA', x: 123, y: 1430, w: 143, h: 260},
    {id: 'office-door', kind: 'door', label: 'AJTÓ', x: 186, y: 1300, w: 22, h: 5},
    {id: 'bar-small', kind: 'bar', label: 'PUK · KIS PULT', x: 679, y: 1496, w: 502, h: 48, stoolSide: 'top', stools: 7},
    {id: 'bar-small-stool-side', kind: 'stool', x: 382, y: 1497}
  ],
  tables: [
    {id: 'T1', label: '1', zone: 'main', shape: 'rect', x: 288, y: 188, w: 113, h: 165, seats: 8, minGuests: 4, seatCounts: {top: 1, left: 3, right: 3, bottom: 1}, seatStyle: 'armchair', tags: ['fotelek', 'nagy társaság'], note: 'Hét fotel és egy szék — a nagyterem legnagyobb asztala.'},
    {id: 'T2', label: '2', zone: 'main', shape: 'rect', x: 610, y: 148, w: 100, h: 85, seats: 4, minGuests: 2, seatCounts: {top: 1, right: 1, bottom: 1, left: 1}, seatStyle: 'armchair', tags: ['fotelek'], note: 'Négy fotel a terem közepén.'},
    {id: 'T3', label: '3', zone: 'main', shape: 'rect', x: 225, y: 394, w: 85, h: 68, seats: 2, seatCounts: {left: 1, right: 1}, seatStyle: 'armchair', tags: ['fotelek', 'kettesben'], note: 'Két fotel.'},
    {id: 'T4', label: '4', zone: 'main', shape: 'rect', x: 340, y: 478, w: 85, h: 67, seats: 3, seatCounts: {top: 1, right: 1, bottom: 1}, seatStyle: 'armchair', tags: ['fotelek'], note: 'Három fotel.'},
    {id: 'T5', label: '5', zone: 'main', shape: 'rect', x: 225, y: 521, w: 85, h: 67, seats: 3, seatCounts: {top: 1, left: 1, bottom: 1}, tags: ['vegyes'], note: 'Két szék és egy fotel.'},
    {id: 'B1', label: 'LOUNGE 1', zone: 'club', shape: 'booth', x: 252, y: 790, w: 118, h: 62, seats: 6, minGuests: 3, minTier: 'gold', seatCounts: {top: 2, left: 2, bottom: 2}, bench: false, tags: ['vip', 'hullámkanapé'], note: 'A hullámkanapé felső öble, a tánctér felé.'},
    {id: 'B2', label: 'LOUNGE 2', zone: 'club', shape: 'booth', x: 252, y: 965, w: 118, h: 62, seats: 6, minGuests: 3, minTier: 'gold', seatCounts: {top: 2, right: 2, bottom: 2}, bench: false, tags: ['vip', 'hullámkanapé'], note: 'A hullámkanapé alsó öble, a tánctér felé.'},
    {id: 'B3', label: 'LOUNGE 3', zone: 'lounge', shape: 'booth', x: 521, y: 1233, w: 120, h: 60, seats: 6, minGuests: 3, minTier: 'silver', seatCounts: {left: 1, bottom: 4, right: 1}, bench: false, tags: ['vip', 'lounge'], note: 'A lounge kanapéjának öble, a kis pult előtt.'},
    {id: 'B4', label: 'LOUNGE 4', zone: 'lounge', shape: 'booth', x: 840, y: 1266, w: 120, h: 60, seats: 6, minGuests: 3, minTier: 'silver', seatCounts: {left: 2, bottom: 3, right: 1}, bench: false, tags: ['vip', 'lounge'], note: 'A lounge kanapéjának jobb oldali öble.'}
  ]
};
