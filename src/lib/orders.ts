/** Supply order vocabulary. Mirrors the enums in server.cjs. */

export type OrderStatus = 'open' | 'claimed' | 'progress' | 'completed' | 'cancelled';

export interface OrderLine {
  productId: string;
  product: string;
  qty: number;
  unitCost: number;
  lineEstimate: number;
}

export interface SupplyOrder {
  id: string;
  code: string;
  at: string;
  createdById: string;
  createdByName: string;
  items: OrderLine[];
  estimatedTotal: number;
  source: string;
  note: string;
  status: OrderStatus;
  claimedById: string | null;
  claimedByName: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  completedById: string | null;
  completedByName: string | null;
  completedAt: string | null;
  actualTotal: number | null;
  variance: number | null;
  varianceNote: string;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  open: 'Kiírva',
  claimed: 'Elvállalva',
  progress: 'Úton',
  completed: 'Teljesítve',
  cancelled: 'Visszavonva'
};

export const ORDER_STATUS_CLASS: Record<OrderStatus, string> = {
  open: 'border-amber-500/40 text-amber-300',
  claimed: 'border-sky-500/40 text-sky-300',
  progress: 'border-[color:var(--rm-line-red)] text-[color:var(--rm-red)]',
  completed: 'border-emerald-500/40 text-emerald-300',
  cancelled: 'border-white/15 text-[#8f8887]'
};

/** Steps shown on an order card, in the order they happen. */
export const ORDER_STEPS: {status: OrderStatus; label: string}[] = [
  {status: 'open', label: 'KIÍRVA'},
  {status: 'claimed', label: 'ELVÁLLALVA'},
  {status: 'progress', label: 'ÚTON'},
  {status: 'completed', label: 'TELJESÍTVE'}
];

/** An order somebody still has to act on. */
export const isActive = (status: OrderStatus): boolean =>
  status === 'open' || status === 'claimed' || status === 'progress';

/**
 * How far off the estimate a run landed, as a share of the estimate.
 *
 * Returns null when there is nothing to compare — an estimate of zero has no
 * meaningful percentage, and a percentage of nothing reads as a 100% overspend.
 */
export function variancePercent(order: SupplyOrder): number | null {
  if (order.actualTotal === null || !order.estimatedTotal) return null;
  return ((order.actualTotal - order.estimatedTotal) / order.estimatedTotal) * 100;
}

/**
 * Prices move, so a small gap is normal and a large one is a question.
 * Anything past this share of the estimate is flagged for an audit.
 */
export const VARIANCE_TOLERANCE_PERCENT = 10;

export function varianceSeverity(order: SupplyOrder): 'none' | 'minor' | 'major' {
  const percent = variancePercent(order);
  if (percent === null || Math.abs(percent) < 0.5) return 'none';
  return Math.abs(percent) > VARIANCE_TOLERANCE_PERCENT ? 'major' : 'minor';
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export type StaffJob = 'bartender' | 'biztonsag' | 'dj' | 'uzletvezeto' | '';

/**
 * What a person does, as opposed to what they may do.
 *
 * `role` is the permission ladder (staff < manager < owner). `job` is the post
 * they hold — a bartender and a doorman are both `staff`, but only one of them
 * leaves the building to fetch stock.
 */
export const JOB_LABEL: Record<StaffJob, string> = {
  '': 'Nincs megadva',
  bartender: 'Bartender',
  biztonsag: 'Biztonság',
  dj: 'DJ',
  uzletvezeto: 'Manager'
};

export const JOB_GLYPH: Record<StaffJob, string> = {
  '': '·',
  bartender: '酒',
  biztonsag: '守',
  dj: '音',
  uzletvezeto: '長'
};

export const JOBS = Object.keys(JOB_LABEL) as StaffJob[];
