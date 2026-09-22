import React, {useMemo, useState} from 'react';
import {FileDown, FileText, Printer, ReceiptText, Search} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn} from '../../components/ui/Btn';
import {useLiveData} from '../../hooks/useLiveData';
import {formatDate, formatHuf, formatTime} from '../../lib/api';
import {toast} from '../../stores/useToastStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {HOUSE} from '../../lib/house';
import {
  DOCUMENT_DESCRIPTION,
  DOCUMENT_LABEL,
  issuerFromUser,
  openDocument,
  type DocumentKind
} from '../../lib/documents';
import {
  buildInventory,
  buildOrderAudit,
  buildPayroll,
  buildShiftReport,
  buildTransactions,
  DOCUMENT_REQUIREMENTS,
  PERIOD_LABEL,
  type Period,
  type SaleRow,
  type ShiftRow,
  type StockRow
} from '../../lib/documentBuilders';
import type {SupplyOrder} from '../../lib/orders';

const KINDS: DocumentKind[] = ['transactions', 'shift-report', 'payroll', 'order-audit', 'inventory'];
const PERIODS: Period[] = ['today', 'week', 'month', 'all'];

/** Kanji mark per document type, matching the card treatment elsewhere. */
const KIND_GLYPH: Record<DocumentKind, string> = {
  transactions: '取',
  'shift-report': '番',
  payroll: '給',
  'order-audit': '査',
  inventory: '庫'
};

interface DocumentItem {
  product: string;
  qty: number;
  unitPrice: number;
  total: number;
}

interface StoredDocument {
  id: string;
  type: 'receipt' | 'invoice' | string;
  createdAt: string;
  createdByName: string;
  shiftId: string;
  saleId: string;
  customer?: {name: string; address?: string; taxNumber?: string};
  seller?: {name: string; owner?: string};
  items: DocumentItem[];
  total: number;
  paymentMethod: 'cash' | 'transfer';
}

const TYPE_LABEL: Record<string, string> = {receipt: 'NYUGTA', invoice: 'SZÁMLA'};
const PAYMENT_LABEL: Record<string, string> = {cash: 'Készpénz', transfer: 'Átutalás'};

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const DocumentsPage: React.FC = () => {
  const {data} = useLiveData<{documents: StoredDocument[]}>('/api/documents', {intervalMs: 30000});

  /* ---- Document generator ------------------------------------------------
     Everything a generated document needs, pulled once. The console screen
     wants the whole picture anyway, so four requests beat one per click. */
  const user = useAuthStore((state) => state.user);
  const {data: saleData} = useLiveData<{sales: SaleRow[]}>('/api/sales', {intervalMs: 0});
  const {data: shiftData} = useLiveData<{shifts: ShiftRow[]}>('/api/shifts', {intervalMs: 0});
  const {data: orderData} = useLiveData<{orders: SupplyOrder[]}>('/api/orders', {intervalMs: 0});
  const {data: storageData} = useLiveData<{products: StockRow[]}>('/api/analytics/storage', {intervalMs: 0});

  const [kind, setKind] = useState<DocumentKind>('transactions');
  const [period, setPeriod] = useState<Period>('week');
  const [shiftId, setShiftId] = useState('');

  const sales = useMemo(() => saleData?.sales || [], [saleData]);
  const shifts = useMemo(() => shiftData?.shifts || [], [shiftData]);
  const orders = useMemo(() => orderData?.orders || [], [orderData]);
  const stock = useMemo(() => storageData?.products || [], [storageData]);
  const closedShifts = useMemo(() => shifts.filter((shift) => shift.status === 'closed'), [shifts]);

  const issuer = useMemo(() => issuerFromUser(user), [user]);

  /** How many records the chosen document would actually print. */
  const available = useMemo(() => {
    switch (kind) {
      case 'transactions':
        return sales.length;
      case 'shift-report':
      case 'payroll':
        return closedShifts.length;
      case 'order-audit':
        return orders.filter((order) => order.status === 'completed').length;
      case 'inventory':
        return stock.length;
      default:
        return 0;
    }
  }, [kind, sales, closedShifts, orders, stock]);

  const generate = () => {
    let payload;
    if (kind === 'shift-report') {
      const shift = closedShifts.find((entry) => entry.id === shiftId) || closedShifts[0];
      if (!shift) {
        toast.error('Nincs lezárt műszak', 'Zárj le egy műszakot, mielőtt jegyzőkönyvet készítesz.');
        return;
      }
      payload = buildShiftReport(shift);
    } else if (kind === 'transactions') {
      payload = buildTransactions(sales, period);
    } else if (kind === 'payroll') {
      payload = buildPayroll(closedShifts, period);
    } else if (kind === 'order-audit') {
      payload = buildOrderAudit(orders, period);
    } else {
      payload = buildInventory(stock);
    }

    if (!openDocument(payload, issuer)) {
      toast.error('A böngésző blokkolta az ablakot', 'Engedélyezd a felugró ablakokat ehhez az oldalhoz.');
      return;
    }
    toast.success('Dokumentum elkészült', 'A nyomtatási ablakban mentheted PDF-be.');
  };

  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | 'receipt' | 'invoice'>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const documents = useMemo(() => data?.documents || [], [data]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return documents.filter((document) => {
      if (type !== 'all' && document.type !== type) return false;
      if (!needle) return true;
      return normalize(`${document.id} ${document.createdByName} ${document.shiftId}`).includes(needle);
    });
  }, [documents, query, type]);

  const open = visible.find((document) => document.id === openId) || null;

  /* Printing opens a clean window: the site's dark chrome, fixed navbar and
     cursor overlay have no place on a paper receipt. */
  const print = (document_: StoredDocument) => {
    const rows = document_.items
      .map(
        (item) =>
          `<tr><td>${item.product}</td><td style="text-align:right">${item.qty}</td><td style="text-align:right">${formatHuf(
            item.unitPrice
          )}</td><td style="text-align:right">${formatHuf(item.total)}</td></tr>`
      )
      .join('');

    const html = `<!doctype html><html lang="hu"><head><meta charset="utf-8"><title>${document_.id}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:520px;margin:32px auto;color:#111}
h1{font-size:18px;letter-spacing:.2em;margin:0 0 4px}
small{color:#666}
table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px}
th,td{padding:6px 4px;border-bottom:1px solid #ddd}
th{text-align:left;font-size:11px;letter-spacing:.1em;color:#666}
.total{margin-top:16px;text-align:right;font-size:18px;font-weight:700}
.meta{margin-top:18px;font-size:12px;color:#444;line-height:1.7}
</style></head><body>
<h1>RED MOON PUB</h1>
<small>${TYPE_LABEL[document_.type] || document_.type} · ${document_.id}</small>
<table><thead><tr><th>Tétel</th><th style="text-align:right">Db</th><th style="text-align:right">Egységár</th><th style="text-align:right">Összesen</th></tr></thead><tbody>${rows}</tbody></table>
<div class="total">${formatHuf(document_.total)}</div>
<div class="meta">
Fizetés: ${PAYMENT_LABEL[document_.paymentMethod] || document_.paymentMethod}<br>
Kiállította: ${document_.createdByName}<br>
Műszak: ${document_.shiftId}<br>
Dátum: ${formatDate(document_.createdAt)} ${formatTime(document_.createdAt)}<br>
Áraink az ÁFÁ-t tartalmazzák.
</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=640,height=800');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / BIZONYLATOK</div>
        <NeonHeading as="h1" size={2} className="mb-3 mt-3.5">
          Nyugták és <em>számlák.</em>
        </NeonHeading>
        <p className="rm-lead mb-12 text-[12px]">
          A ház kiállított bizonylatai, és a hivatalos kimutatások, amelyeket innen készíthetsz.
        </p>

        {/* ------------------------------------------------ GENERATOR */}
        <div className="mb-14 border border-[color:var(--rm-line-red)] bg-[#09090b] p-8 md:p-10">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <span className="rm-label">DOKUMENTUM KÉSZÍTÉSE</span>
              <h2 className="mt-2 font-heading text-[26px] leading-none text-white">Hivatalos kimutatás.</h2>
              <p className="mt-3 max-w-lg text-[11px] leading-[1.8] text-[#8d8584]">
                A kimutatás a ház fejlécével, a kiállító nevével és aláírásával készül. A megnyíló ablakban
                nyomtathatod, vagy PDF-be mentheted.
              </p>
            </div>
            <div className="text-right text-[10px] leading-[1.8] text-[#6f6968]">
              <strong className="block font-heading text-[14px] text-white">{HOUSE.name}</strong>
              {HOUSE.address}
              <br/>
              Nyilvántartási szám: {HOUSE.registration}
            </div>
          </div>

          <div className="rm-gilt my-8"/>

          {/* Type */}
          <span className="text-[8px] tracking-[0.25em] text-[#777]">TÍPUS</span>
          <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {KINDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                aria-pressed={kind === option}
                className={`group relative overflow-hidden border p-5 text-left transition-all ${
                  kind === option
                    ? 'border-[color:var(--rm-red)] bg-[rgba(227,40,78,0.08)]'
                    : 'border-white/10 hover:border-white/30'
                }`}
              >
                <span
                  className="pointer-events-none absolute -right-2 -top-3 font-heading text-[54px] leading-none text-[rgba(227,40,78,0.13)] transition-transform duration-500 group-hover:scale-110"
                  aria-hidden="true"
                >
                  {KIND_GLYPH[option]}
                </span>
                <span className="relative block text-[10px] font-bold tracking-[0.14em] text-white">
                  {DOCUMENT_LABEL[option]}
                </span>
                <span className="relative mt-2 block text-[10px] leading-[1.6] text-[#8d8584]">
                  {DOCUMENT_DESCRIPTION[option]}
                </span>
              </button>
            ))}
          </div>

          {/* Scope */}
          <div className="mt-7 flex flex-wrap items-end gap-6">
            {kind === 'shift-report' ? (
              <label className="flex min-w-[260px] flex-1 flex-col gap-2">
                <span className="text-[8px] tracking-[0.25em] text-[#777]">MŰSZAK</span>
                <select
                  value={shiftId}
                  onChange={(event) => setShiftId(event.target.value)}
                  className="border border-white/10 bg-black/50 px-3.5 py-3 text-[11px] text-white outline-none focus:border-[color:var(--rm-red)]"
                >
                  {!closedShifts.length && <option value="">Nincs lezárt műszak</option>}
                  {closedShifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.id} · {formatDate(shift.startedAt)} · {formatHuf(Number(shift.revenue) || 0)}
                    </option>
                  ))}
                </select>
              </label>
            ) : kind === 'inventory' ? (
              <p className="text-[10px] text-[#8d8584]">
                A készletjegyzék mindig az aktuális állapotot tartalmazza, időszak nélkül.
              </p>
            ) : (
              <div>
                <span className="text-[8px] tracking-[0.25em] text-[#777]">IDŐSZAK</span>
                <div className="mt-3 flex flex-wrap gap-2">
                  {PERIODS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setPeriod(option)}
                      aria-pressed={period === option}
                      className={`border px-4 py-2.5 text-[9px] font-bold tracking-[0.18em] transition-all ${
                        period === option
                          ? 'border-[color:var(--rm-red)] bg-[rgba(227,40,78,0.12)] text-white'
                          : 'border-white/10 text-[#8f8887] hover:border-white/30'
                      }`}
                    >
                      {PERIOD_LABEL[option].toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-6">
            <div className="text-[10px] leading-[1.7] text-[#8d8584]">
              Kiállító: <b className="text-white">{issuer.name}</b> · {issuer.title}
              <br/>
              <span className="text-[#6f6968]">
                {available
                  ? `${available} ${DOCUMENT_REQUIREMENTS[kind]} érhető el`
                  : `Nincs ${DOCUMENT_REQUIREMENTS[kind]} a rendszerben`}
              </span>
            </div>
            <Btn variant="red" onClick={generate} disabled={!available}>
              <FileDown size={13}/> DOKUMENTUM KÉSZÍTÉSE
            </Btn>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative flex w-full items-center sm:max-w-xs">
            <Search size={14} className="absolute left-4 text-[#6d5d64]"/>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="AZONOSÍTÓ, KIÁLLÍTÓ VAGY MŰSZAK…"
              className="w-full border border-[color:var(--rm-line)] bg-black/50 py-3 pl-10 pr-4 text-[10px] tracking-[0.15em] text-white outline-none focus:border-[color:var(--rm-red)]"
            />
          </label>

          <div className="flex gap-2">
            {(
              [
                {id: 'all', label: 'ÖSSZES'},
                {id: 'receipt', label: 'NYUGTA'},
                {id: 'invoice', label: 'SZÁMLA'}
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setType(option.id)}
                aria-pressed={type === option.id}
                className={`border px-4 py-2.5 text-[9px] font-bold tracking-[0.2em] transition-all ${
                  type === option.id
                    ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.12)] text-white'
                    : 'border-white/10 text-[#8f8887] hover:border-white/30'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <div className="rm-card p-0 lg:col-span-2">
            <div className="border-b border-[color:var(--rm-line)] px-6 py-4">
              <span className="rm-label">BIZONYLATOK ({visible.length})</span>
            </div>

            {!visible.length && (
              <p className="px-6 py-6 text-[11px] text-[#8d8584]">
                Nincs bizonylat. Nyugta a kasszában, eladás után készül.
              </p>
            )}

            <div className="max-h-[560px] overflow-y-auto">
              {visible.map((document_) => (
                <button
                  key={document_.id}
                  type="button"
                  onClick={() => setOpenId(document_.id)}
                  className={`flex w-full items-center gap-3 border-b border-white/[0.04] px-6 py-3 text-left transition-colors hover:bg-white/[0.02] ${
                    openId === document_.id ? 'bg-[rgba(213,31,60,0.08)]' : ''
                  }`}
                >
                  {document_.type === 'invoice' ? (
                    <FileText size={13} className="shrink-0 text-[color:var(--rm-red)]"/>
                  ) : (
                    <ReceiptText size={13} className="shrink-0 text-[#777]"/>
                  )}
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[11px] text-white">{document_.id}</strong>
                    <span className="text-[9px] text-[#777]">
                      {formatDate(document_.createdAt)} {formatTime(document_.createdAt)} · {document_.createdByName}
                    </span>
                  </div>
                  <span className="shrink-0 font-heading text-[14px] text-[color:var(--rm-red)]">
                    {formatHuf(document_.total)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rm-card h-fit p-7">
            <span className="rm-label">ELŐNÉZET</span>

            {!open ? (
              <p className="mt-3 text-[11px] text-[#8d8584]">Válassz egy bizonylatot a listából.</p>
            ) : (
              <>
                <h2 className="mb-1 mt-2 font-heading text-[20px] text-white">{open.id}</h2>
                <span className="text-[9px] tracking-[0.2em] text-[color:var(--rm-red)]">
                  {TYPE_LABEL[open.type] || open.type}
                </span>

                <div className="mt-5 flex flex-col gap-1.5">
                  {open.items.map((item, index) => (
                    <div key={`${item.product}-${index}`} className="flex justify-between text-[10px]">
                      <span className="truncate pr-2 text-white">
                        {item.qty} × {item.product}
                      </span>
                      <span className="shrink-0 text-[#8d8584]">{formatHuf(item.total)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-4">
                  <span className="text-[9px] tracking-[0.2em] text-[#777]">VÉGÖSSZEG</span>
                  <strong className="font-heading text-[20px] text-white">{formatHuf(open.total)}</strong>
                </div>

                <dl className="mt-4 flex flex-col gap-1.5 text-[10px] text-[#8d8584]">
                  <div className="flex justify-between">
                    <dt>Fizetés</dt>
                    <dd className="text-white">{PAYMENT_LABEL[open.paymentMethod] || open.paymentMethod}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Műszak</dt>
                    <dd className="text-white">{open.shiftId}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Kiállította</dt>
                    <dd className="text-white">{open.createdByName}</dd>
                  </div>
                </dl>

                <Btn variant="red" onClick={() => print(open)} className="mt-6 w-full justify-center">
                  <Printer size={13}/> NYOMTATÁS
                </Btn>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
};
