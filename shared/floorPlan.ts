/**
 * The floor plan: the room as data, shared by the site and the server.
 *
 * A plan is a rectangle in plan units (any unit, the drawing scales), with
 * zones (named areas), features (bar, stage, walls, doors, plants — the
 * scenery) and tables (what a guest can book). Seats are not listed one by
 * one: a table says how many it has and on which sides, and the drawing
 * places them. Dependency-free on purpose, like shared/signature.ts.
 */

export type TableShape = 'round' | 'square' | 'rect' | 'booth';
export type TableSide = 'top' | 'right' | 'bottom' | 'left';
export type HouseTier = 'silver' | 'gold' | 'black' | 'royal';
export type FeatureKind = 'wall' | 'bar' | 'stage' | 'dance' | 'door' | 'pillar' | 'plant' | 'restroom' | 'area' | 'text';

export interface FloorZone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloorFeature {
  id: string;
  kind: FeatureKind;
  label?: string;
  /** Centre for shapes; ignored by walls. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Degrees, clockwise, around the centre. */
  rotation?: number;
  /** Walls: a polyline of [x, y] points. */
  points?: [number, number][];
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
export const FEATURE_KINDS: FeatureKind[] = ['wall', 'bar', 'stage', 'dance', 'door', 'pillar', 'plant', 'restroom', 'area', 'text'];
export const HOUSE_TIERS: HouseTier[] = ['silver', 'gold', 'black', 'royal'];

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
    return {
      id: str(zone.id, `zones[${index}].id`, {max: 40, required: true}),
      name: str(zone.name, `zones[${index}].name`, {max: 60, required: true}),
      x: num(zone.x, `zones[${index}].x`),
      y: num(zone.y, `zones[${index}].y`),
      w: num(zone.w, `zones[${index}].w`, {min: 1}),
      h: num(zone.h, `zones[${index}].h`, {min: 1})
    };
  });

  const features: FloorFeature[] = list(raw.features, 'features').map((entry, index) => {
    const feature = record(entry, `features[${index}]`);
    const kind = str(feature.kind, `features[${index}].kind`, {required: true}) as FeatureKind;
    if (!FEATURE_KINDS.includes(kind)) throw new PlanError(`features[${index}].kind: ismeretlen (${FEATURE_KINDS.join(', ')}).`);
    const out: FloorFeature = {id: str(feature.id, `features[${index}].id`, {max: 40}) || `f${index + 1}`, kind};
    const label = str(feature.label, `features[${index}].label`, {max: 60});
    if (label) out.label = label;
    if (kind === 'wall') {
      const points = list(feature.points, `features[${index}].points`).map((point, p) => {
        if (!Array.isArray(point) || point.length !== 2) throw new PlanError(`features[${index}].points[${p}]: [x, y] pár kell.`);
        return [num(point[0], `features[${index}].points[${p}][0]`), num(point[1], `features[${index}].points[${p}][1]`)] as [number, number];
      });
      if (points.length < 2) throw new PlanError(`features[${index}].points: legalább két pont kell.`);
      out.points = points;
    } else {
      out.x = num(feature.x, `features[${index}].x`);
      out.y = num(feature.y, `features[${index}].y`);
      if (kind !== 'text') {
        out.w = num(feature.w, `features[${index}].w`, {min: 1, fallback: kind === 'pillar' || kind === 'plant' ? 24 : 80});
        out.h = num(feature.h, `features[${index}].h`, {min: 1, fallback: kind === 'pillar' || kind === 'plant' ? out.w : 40});
      }
      const rotation = num(feature.rotation, `features[${index}].rotation`, {fallback: 0});
      if (rotation) out.rotation = rotation;
    }
    return out;
  });

  const ids = new Set<string>();
  const tables: FloorTable[] = list(raw.tables, 'tables').map((entry, index) => {
    const table = record(entry, `tables[${index}]`);
    const id = str(table.id, `tables[${index}].id`, {max: 40, required: true});
    if (ids.has(id)) throw new PlanError(`tables[${index}].id: "${id}" kétszer szerepel.`);
    ids.add(id);
    const shape = (str(table.shape, `tables[${index}].shape`) || 'round') as TableShape;
    if (!TABLE_SHAPES.includes(shape)) throw new PlanError(`tables[${index}].shape: ismeretlen (${TABLE_SHAPES.join(', ')}).`);
    const w = num(table.w, `tables[${index}].w`, {min: 8, max: 2000, fallback: shape === 'round' ? 48 : 80});
    const h = shape === 'round' ? w : num(table.h, `tables[${index}].h`, {min: 8, max: 2000, fallback: shape === 'square' ? w : 56});
    const seats = num(table.seats, `tables[${index}].seats`, {min: 1, max: 40});
    const minGuests = num(table.minGuests, `tables[${index}].minGuests`, {min: 1, max: 40, fallback: 1});
    if (minGuests > seats) throw new PlanError(`tables[${index}].minGuests: nem lehet több a székek számánál.`);
    const out: FloorTable = {
      id,
      label: str(table.label, `tables[${index}].label`, {max: 24}) || id,
      shape,
      x: num(table.x, `tables[${index}].x`),
      y: num(table.y, `tables[${index}].y`),
      w,
      h,
      seats
    };
    const zone = str(table.zone, `tables[${index}].zone`, {max: 40});
    if (zone) {
      if (!zones.some((entry) => entry.id === zone)) throw new PlanError(`tables[${index}].zone: nincs "${zone}" nevű zóna.`);
      out.zone = zone;
    }
    const rotation = num(table.rotation, `tables[${index}].rotation`, {fallback: 0});
    if (rotation) out.rotation = rotation;
    if (minGuests > 1) out.minGuests = minGuests;
    const sides = list(table.seatSides, `tables[${index}].seatSides`).map((side) => {
      if (typeof side !== 'string' || !TABLE_SIDES.includes(side as TableSide)) throw new PlanError(`tables[${index}].seatSides: top, right, bottom vagy left.`);
      return side as TableSide;
    });
    if (sides.length) out.seatSides = sides;
    const minTier = str(table.minTier, `tables[${index}].minTier`, {max: 12});
    if (minTier) {
      if (!HOUSE_TIERS.includes(minTier as HouseTier)) throw new PlanError(`tables[${index}].minTier: silver, gold, black vagy royal.`);
      out.minTier = minTier as HouseTier;
    }
    const tags = list(table.tags, `tables[${index}].tags`).map((tag, t) => str(tag, `tables[${index}].tags[${t}]`, {max: 30})).filter(Boolean);
    if (tags.length) out.tags = tags.slice(0, 6);
    const note = str(table.note, `tables[${index}].note`, {max: 200});
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

const SEAT_GAP = 13;

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
  const sides: TableSide[] = table.seatSides?.length ? table.seatSides : table.shape === 'booth' ? ['left', 'top', 'right'] : ['top', 'bottom', 'right', 'left'];
  const length = (side: TableSide) => (side === 'top' || side === 'bottom' ? table.w : table.h);
  // Seats go to the sides in proportion to their length, longest sides first.
  const total = sides.reduce((sum, side) => sum + length(side), 0) || 1;
  const counts = sides.map((side) => Math.floor((n * length(side)) / total));
  let left = n - counts.reduce((sum, count) => sum + count, 0);
  const order = sides.map((side, index) => ({index, remainder: (n * length(side)) / total - counts[index]})).sort((a, b) => b.remainder - a.remainder);
  for (const entry of order) {
    if (left <= 0) break;
    counts[entry.index] += 1;
    left -= 1;
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
/* The default room — test data until the real plan arrives           */
/* ------------------------------------------------------------------ */

export const DEFAULT_FLOOR_PLAN: FloorPlan = {
  version: 1,
  name: 'Red Moon Pub',
  width: 1000,
  height: 720,
  zones: [
    {id: 'main', name: 'Nagyterem', x: 190, y: 40, w: 500, h: 640},
    {id: 'floor', name: 'Táncparkett', x: 710, y: 40, w: 250, h: 330},
    {id: 'lounge', name: 'Lounge', x: 710, y: 400, w: 250, h: 280}
  ],
  features: [
    {id: 'walls', kind: 'wall', points: [[20, 20], [980, 20], [980, 700], [20, 700], [20, 20]]},
    {id: 'lounge-wall', kind: 'wall', points: [[700, 390], [980, 390]]},
    {id: 'bar', kind: 'bar', label: 'PULT', x: 95, y: 340, w: 90, h: 400},
    {id: 'stage', kind: 'stage', label: 'DJ', x: 835, y: 85, w: 220, h: 90},
    {id: 'dance', kind: 'dance', label: 'TÁNCPARKETT', x: 835, y: 250, w: 230, h: 180},
    {id: 'door', kind: 'door', label: 'BEJÁRAT', x: 500, y: 700, w: 90, h: 20},
    {id: 'wc', kind: 'restroom', label: 'WC', x: 100, y: 640, w: 120, h: 80},
    {id: 'wardrobe', kind: 'area', label: 'RUHATÁR', x: 100, y: 75, w: 120, h: 70},
    {id: 'pillar-1', kind: 'pillar', x: 420, y: 330, w: 22, h: 22},
    {id: 'pillar-2', kind: 'pillar', x: 420, y: 470, w: 22, h: 22},
    {id: 'plant-1', kind: 'plant', x: 690, y: 60, w: 28, h: 28},
    {id: 'plant-2', kind: 'plant', x: 200, y: 660, w: 28, h: 28},
    {id: 'plant-3', kind: 'plant', x: 960, y: 675, w: 28, h: 28}
  ],
  tables: [
    {id: 'T1', label: '1', zone: 'main', shape: 'round', x: 260, y: 110, w: 46, h: 46, seats: 2, tags: ['ablak']},
    {id: 'T2', label: '2', zone: 'main', shape: 'round', x: 370, y: 110, w: 46, h: 46, seats: 2, tags: ['ablak']},
    {id: 'T3', label: '3', zone: 'main', shape: 'round', x: 480, y: 110, w: 46, h: 46, seats: 2, tags: ['ablak']},
    {id: 'T4', label: '4', zone: 'main', shape: 'round', x: 590, y: 110, w: 46, h: 46, seats: 2, tags: ['ablak']},
    {id: 'T5', label: '5', zone: 'main', shape: 'rect', x: 270, y: 250, w: 96, h: 56, seats: 4},
    {id: 'T6', label: '6', zone: 'main', shape: 'rect', x: 440, y: 250, w: 96, h: 56, seats: 4},
    {id: 'T7', label: '7', zone: 'main', shape: 'rect', x: 610, y: 250, w: 96, h: 56, seats: 4},
    {id: 'T8', label: '8', zone: 'main', shape: 'square', x: 270, y: 400, w: 64, h: 64, seats: 4},
    {id: 'T9', label: '9', zone: 'main', shape: 'rect', x: 520, y: 400, w: 150, h: 60, seats: 6, minGuests: 4, tags: ['társaság']},
    {id: 'T10', label: '10', zone: 'main', shape: 'round', x: 280, y: 550, w: 88, h: 88, seats: 6, minGuests: 3},
    {id: 'T11', label: '11', zone: 'main', shape: 'rect', x: 520, y: 560, w: 190, h: 64, seats: 8, minGuests: 5, tags: ['csapat'], note: 'A ház leghosszabb asztala, a bejárat mellett.'},
    {id: 'B1', label: 'LOUNGE 1', zone: 'lounge', shape: 'booth', x: 835, y: 505, w: 170, h: 80, seats: 6, minGuests: 2, minTier: 'gold', tags: ['privát'], note: 'Saját kiszolgálás, a színpadra néző sarok.'},
    {id: 'B2', label: 'LOUNGE 2', zone: 'lounge', shape: 'booth', x: 835, y: 635, w: 150, h: 70, seats: 4, minGuests: 2, minTier: 'silver', tags: ['privát']}
  ]
};
