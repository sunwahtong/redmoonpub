import {formatHuf} from './api';
import type {DocumentKind, DocumentPayload} from './documents';
import type {SupplyOrder} from './orders';

/**
 * Turns console data into the shape the document engine renders.
 *
 * Kept apart from `documents.ts` on purpose: that file knows how to lay a
 * document out and nothing about the business, this one knows the business
 * and nothing about layout. Adding a document type means adding a builder.
 */

export interface SaleRow {
  id: string;
  at: string;
  product?: string;
  productId: string;
  qty: number;
  unitPrice?: number;
  total: number;
  paymentMethod: string;
  user?: string;
  soldByName?: string;
  shiftId: string;
}

export interface ShiftRow {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  startedByName?: string;
  closedByName?: string;
  openingCash?: number;
  closingCash?: number | null;
  revenue?: number;
  cashRevenue?: number;
  transferRevenue?: number;
  salesCount?: number;
  items?: number;
  notes?: string;
  closure?: {
    employeeBreakdown?: {name: string; workedMs: number; sales: number; items: number; revenue: number}[];
  } | null;
}

export interface StockRow {
  id: string;
  name: string;
  stock: number;
  minStock: number;
  perDay: number;
  daysLeft: number | null;
  price: number;
}

export interface StoredDocument {
  id: string;
  type: 'receipt' | 'invoice' | string;
  createdAt: string;
  createdByName: string;
  shiftId: string;
  saleId: string;
  customer?: {name?: string; address?: string; taxNumber?: string};
  seller?: {name?: string; owner?: string};
  items: {product: string; qty: number; unitPrice: number; total: number}[];
  total: number;
  paymentMethod: 'cash' | 'transfer' | string;
}

export type Period = 'today' | 'week' | 'month' | 'all';

export const PERIOD_LABEL: Record<Period, string> = {
  today: 'Mai nap',
  week: 'Elmúlt 7 nap',
  month: 'Elmúlt 30 nap',
  all: 'Teljes időszak'
};

const dateFormat = new Intl.DateTimeFormat('hu-HU', {year: 'numeric', month: 'long', day: 'numeric'});
const timeFormat = new Intl.DateTimeFormat('hu-HU', {hour: '2-digit', minute: '2-digit'});

/** Inclusive lower bound for a period, or null when everything counts. */
export function periodStart(period: Period): Date | null {
  if (period === 'all') return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - 6);
  if (period === 'month') start.setDate(start.getDate() - 29);
  return start;
}

/** Human period line printed under the document title. */
export function periodText(period: Period): string {
  const start = periodStart(period);
  if (!start) return 'Teljes időszak';
  const today = dateFormat.format(new Date());
  if (period === 'today') return today;
  return `${dateFormat.format(start)} — ${today}`;
}

const within = (value: string, start: Date | null): boolean => !start || new Date(value).getTime() >= start.getTime();

const PAYMENT_LABEL: Record<string, string> = {cash: 'Készpénz', transfer: 'Átutalás'};

/** Tételes eladási lista. */
export function buildTransactions(sales: SaleRow[], period: Period): DocumentPayload {
  const start = periodStart(period);
  const rows = sales.filter((sale) => within(sale.at, start)).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const total = rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  const cash = rows.filter((row) => row.paymentMethod === 'cash').reduce((sum, row) => sum + (Number(row.total) || 0), 0);

  return {
    kind: 'transactions',
    period: periodText(period),
    preamble: 'Az alábbi kimutatás a megjelölt időszakban rögzített eladási tételeket tartalmazza, a rögzítés sorrendjében.',
    columns: [
      {key: 'date', label: 'Dátum'},
      {key: 'time', label: 'Idő'},
      {key: 'product', label: 'Tétel'},
      {key: 'qty', label: 'Db', numeric: true},
      {key: 'total', label: 'Összeg', numeric: true},
      {key: 'payment', label: 'Fizetés'},
      {key: 'user', label: 'Rögzítette'}
    ],
    rows: rows.map((sale) => ({
      date: dateFormat.format(new Date(sale.at)),
      time: timeFormat.format(new Date(sale.at)),
      product: sale.product || sale.productId,
      qty: sale.qty,
      total: formatHuf(sale.total),
      payment: PAYMENT_LABEL[sale.paymentMethod] || sale.paymentMethod,
      user: sale.soldByName || sale.user || '—'
    })),
    summary: [
      {label: 'Tételek száma', value: String(rows.length)},
      {label: 'Ebből készpénz', value: formatHuf(cash)},
      {label: 'Ebből átutalás', value: formatHuf(total - cash)},
      {label: 'Összesen', value: formatHuf(total), strong: true}
    ],
    notes: ['Az összegek az általános forgalmi adót tartalmazzák.']
  };
}

/** Egy műszak zárási jegyzőkönyve. */
export function buildShiftReport(shift: ShiftRow): DocumentPayload {
  const breakdown = shift.closure?.employeeBreakdown || [];
  const opening = Number(shift.openingCash) || 0;
  const closing = Number(shift.closingCash) || 0;
  const revenue = Number(shift.revenue) || 0;
  const expected = opening + (Number(shift.cashRevenue) || 0);

  return {
    kind: 'shift-report',
    period: `${dateFormat.format(new Date(shift.startedAt))} · ${timeFormat.format(new Date(shift.startedAt))}${
      shift.endedAt ? ` — ${timeFormat.format(new Date(shift.endedAt))}` : ''
    }`,
    preamble: `A(z) ${shift.id} azonosítójú műszak zárási adatai. Nyitotta: ${shift.startedByName || '—'}. Zárta: ${shift.closedByName || '—'}.`,
    columns: [
      {key: 'name', label: 'Dolgozó'},
      {key: 'hours', label: 'Óra', numeric: true},
      {key: 'sales', label: 'Eladás', numeric: true},
      {key: 'items', label: 'Tétel', numeric: true},
      {key: 'revenue', label: 'Bevétel', numeric: true}
    ],
    rows: breakdown.map((entry) => ({
      name: entry.name,
      hours: (entry.workedMs / 3600000).toFixed(1),
      sales: entry.sales,
      items: entry.items,
      revenue: formatHuf(entry.revenue)
    })),
    summary: [
      {label: 'Nyitó kassza', value: formatHuf(opening)},
      {label: 'Készpénzes bevétel', value: formatHuf(Number(shift.cashRevenue) || 0)},
      {label: 'Átutalásos bevétel', value: formatHuf(Number(shift.transferRevenue) || 0)},
      {label: 'Elvárt záró kassza', value: formatHuf(expected)},
      {label: 'Tényleges záró kassza', value: formatHuf(closing)},
      {label: 'Műszak bevétele', value: formatHuf(revenue), strong: true}
    ],
    notes: [
      closing === expected ? 'A záró kassza megegyezik az elvárt összeggel.' : `Eltérés az elvárt záró kasszához képest: ${formatHuf(closing - expected)}.`,
      ...(shift.notes ? [`Műszak megjegyzése: ${shift.notes}`] : [])
    ]
  };
}

/** Bérelszámolás a zárt műszakok alapján. */
export function buildPayroll(shifts: ShiftRow[], period: Period, hourlyWage: number): DocumentPayload {
  const start = periodStart(period);
  const closed = shifts.filter((shift) => shift.status === 'closed' && within(shift.startedAt, start));

  const people = new Map<string, {name: string; hours: number; shifts: number; sales: number; revenue: number}>();
  for (const shift of closed) {
    for (const entry of shift.closure?.employeeBreakdown || []) {
      const person = people.get(entry.name) || {name: entry.name, hours: 0, shifts: 0, sales: 0, revenue: 0};
      person.hours += entry.workedMs / 3600000;
      person.shifts += 1;
      person.sales += entry.sales;
      person.revenue += entry.revenue;
      people.set(entry.name, person);
    }
  }

  const rows = [...people.values()].sort((a, b) => b.hours - a.hours);
  const wageTotal = rows.reduce((sum, row) => sum + row.hours * hourlyWage, 0);

  return {
    kind: 'payroll',
    period: periodText(period),
    preamble: `A kifizetendő összeg a ledolgozott órák és a ${formatHuf(hourlyWage)} órabér szorzata. Az elszámolás a lezárt műszakok adatain alapul.`,
    columns: [
      {key: 'name', label: 'Dolgozó'},
      {key: 'shifts', label: 'Műszak', numeric: true},
      {key: 'hours', label: 'Óra', numeric: true},
      {key: 'sales', label: 'Eladás', numeric: true},
      {key: 'revenue', label: 'Hozott bevétel', numeric: true},
      {key: 'wage', label: 'Kifizetendő', numeric: true}
    ],
    rows: rows.map((row) => ({
      name: row.name,
      shifts: row.shifts,
      hours: row.hours.toFixed(1),
      sales: row.sales,
      revenue: formatHuf(row.revenue),
      wage: formatHuf(Math.round(row.hours * hourlyWage))
    })),
    summary: [
      {label: 'Dolgozók száma', value: String(rows.length)},
      {label: 'Ledolgozott óra', value: rows.reduce((sum, row) => sum + row.hours, 0).toFixed(1)},
      {label: 'Kifizetendő összesen', value: formatHuf(Math.round(wageTotal)), strong: true}
    ],
    notes: ['Az órabér egységesen került alkalmazásra; egyedi megállapodások nincsenek rögzítve a rendszerben.', 'A kifizetés a dokumentum aláírását követően esedékes.']
  };
}

/** Beszerzési audit: becsült és tényleges érték, eltéréssel. */
export function buildOrderAudit(orders: SupplyOrder[], period: Period): DocumentPayload {
  const start = periodStart(period);
  const rows = orders
    .filter((order) => order.status === 'completed' && order.completedAt && within(order.completedAt, start))
    .sort((a, b) => new Date(b.completedAt as string).getTime() - new Date(a.completedAt as string).getTime());
  const estimated = rows.reduce((sum, order) => sum + (Number(order.estimatedTotal) || 0), 0);
  const actual = rows.reduce((sum, order) => sum + (Number(order.actualTotal) || 0), 0);

  return {
    kind: 'order-audit',
    period: periodText(period),
    preamble: 'Az alábbi kimutatás a lezárt beszerzéseket tartalmazza. A becsült érték a kiírás pillanatában rögzített összeg, a tényleges érték a beszerzést végző által bejelentett összeg.',
    columns: [
      {key: 'code', label: 'Azonosító'},
      {key: 'date', label: 'Lezárva'},
      {key: 'runner', label: 'Beszerző'},
      {key: 'items', label: 'Tétel', numeric: true},
      {key: 'estimated', label: 'Becsült', numeric: true},
      {key: 'actual', label: 'Tényleges', numeric: true},
      {key: 'variance', label: 'Eltérés', numeric: true}
    ],
    rows: rows.map((order) => ({
      code: order.code,
      date: dateFormat.format(new Date(order.completedAt as string)),
      runner: order.completedByName || '—',
      items: order.items.length,
      estimated: formatHuf(order.estimatedTotal),
      actual: formatHuf(order.actualTotal || 0),
      variance: `${(order.variance || 0) > 0 ? '+' : ''}${formatHuf(order.variance || 0)}`
    })),
    summary: [
      {label: 'Beszerzések száma', value: String(rows.length)},
      {label: 'Becsült összesen', value: formatHuf(estimated)},
      {label: 'Tényleges összesen', value: formatHuf(actual)},
      {label: 'Összesített eltérés', value: `${actual - estimated > 0 ? '+' : ''}${formatHuf(actual - estimated)}`, strong: true}
    ],
    notes: ['A beszerzési árak ingadozása miatt kisebb eltérés szokványos.', 'A tartósan vagy jelentősen eltérő tételek külön vizsgálat tárgyát képezik.']
  };
}

/** Készletjegyzék a kifutási előrejelzéssel. */
export function buildInventory(products: StockRow[]): DocumentPayload {
  const rows = [...products].sort((a, b) => {
    if (a.daysLeft === null && b.daysLeft === null) return a.name.localeCompare(b.name, 'hu');
    if (a.daysLeft === null) return 1;
    if (b.daysLeft === null) return -1;
    return a.daysLeft - b.daysLeft;
  });

  return {
    kind: 'inventory',
    period: dateFormat.format(new Date()),
    preamble: 'A készletjegyzék a kiállítás pillanatában nyilvántartott mennyiségeket tartalmazza. A kifutási előrejelzés az elmúlt két hét fogyása alapján készült.',
    columns: [
      {key: 'name', label: 'Tétel'},
      {key: 'stock', label: 'Készlet', numeric: true},
      {key: 'minStock', label: 'Minimum', numeric: true},
      {key: 'perDay', label: 'Napi fogyás', numeric: true},
      {key: 'daysLeft', label: 'Kifutás', numeric: true},
      {key: 'value', label: 'Eladási érték', numeric: true}
    ],
    rows: rows.map((product) => ({
      name: product.name,
      stock: product.stock,
      minStock: product.minStock,
      perDay: product.perDay.toFixed(2),
      daysLeft: product.daysLeft === null ? 'nincs adat' : `${product.daysLeft} nap`,
      value: formatHuf(product.stock * product.price)
    })),
    summary: [
      {label: 'Tételfajták', value: String(rows.length)},
      {label: 'Minimum alatt', value: String(rows.filter((row) => row.stock <= row.minStock).length)},
      {label: 'Készlet eladási értéke', value: formatHuf(rows.reduce((sum, row) => sum + row.stock * row.price, 0)), strong: true}
    ],
    notes: ['A „nincs adat” jelölésű tételeknél az elmúlt két hétben nem volt mérhető fogyás.']
  };
}

/** Nyugta vagy számla egy tárolt bizonylatból. */
export function buildStoredDocument(document: StoredDocument): DocumentPayload {
  const invoice = document.type === 'invoice';
  const customer = document.customer || {};
  return {
    kind: invoice ? 'invoice' : 'receipt',
    reference: document.id,
    period: `${dateFormat.format(new Date(document.createdAt))} · ${timeFormat.format(new Date(document.createdAt))} · műszak ${document.shiftId}`,
    parties: [
      {label: 'Eladó', lines: [document.seller?.name || 'Red Moon Pub', ...(document.seller?.owner ? [document.seller.owner] : [])]},
      {
        label: 'Vevő',
        lines: [customer.name || 'Vásárló', ...(customer.address ? [customer.address] : []), ...(customer.taxNumber ? [`Adószám: ${customer.taxNumber}`] : [])]
      }
    ],
    columns: [
      {key: 'product', label: 'Tétel'},
      {key: 'qty', label: 'Db', numeric: true},
      {key: 'unitPrice', label: 'Egységár', numeric: true},
      {key: 'total', label: 'Összesen', numeric: true}
    ],
    rows: document.items.map((item) => ({product: item.product, qty: item.qty, unitPrice: formatHuf(item.unitPrice), total: formatHuf(item.total)})),
    summary: [
      {label: 'Fizetés módja', value: PAYMENT_LABEL[document.paymentMethod] || document.paymentMethod},
      {label: 'Kiállította', value: document.createdByName},
      {label: 'Fizetendő', value: formatHuf(document.total), strong: true}
    ],
    notes: ['Áraink az általános forgalmi adót tartalmazzák.'],
    countersign: invoice
  };
}

/** Which documents need which data, so the page can say what is missing. */
export const DOCUMENT_REQUIREMENTS: Record<DocumentKind, string> = {
  transactions: 'eladás',
  'shift-report': 'lezárt műszak',
  payroll: 'lezárt műszak',
  'order-audit': 'lezárt beszerzés',
  inventory: 'termék',
  receipt: 'nyugta',
  invoice: 'számla'
};
