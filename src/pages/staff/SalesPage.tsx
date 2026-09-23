import React, {useMemo, useState} from 'react';
import {Banknote, CreditCard, FileText, Trash2, X} from 'lucide-react';
import {Btn} from '../../components/ui/Btn';
import {Chips, PageHeader, Panel, SearchField, Stat} from '../../components/ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatDate, formatHuf, formatTime} from '../../lib/api';
import {SECTION_LABELS, SECTION_ORDER, sectionLabel} from '../../lib/sections';
import {playSfx} from '../../lib/sfx';
import {dialog} from '../../stores/useDialogStore';
import {toast} from '../../stores/useToastStore';
import {useAuthStore, roleAtLeast} from '../../stores/useAuthStore';
import type {DrinkSection} from '../../types';

interface Sale {
  id: string;
  at: string;
  shiftId: string;
  productId: string;
  product?: string;
  category: 'drink' | 'food' | string;
  section: DrinkSection | string;
  qty: number;
  total: number;
  paymentMethod: 'cash' | 'transfer';
  soldByName?: string;
  user?: string;
  cartId?: string;
  documentId?: string | null;
}

interface InvoiceTarget {
  saleId: string;
  cartLabel: string;
  total: number;
}

type Kind = 'all' | 'drink' | 'food' | DrinkSection;
type Period = 'today' | 'week' | 'month' | 'all';

const PERIOD_LABEL: Record<Period, string> = {today: 'MA', week: '7 NAP', month: '30 NAP', all: 'MINDEN'};

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function periodStart(period: Period): number {
  if (period === 'all') return 0;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - 6);
  if (period === 'month') start.setDate(start.getDate() - 29);
  return start.getTime();
}

/**
 * Sales, read the way the bar thinks about them: by what was sold — drinks
 * or food, and the section of the menu — over a period, then as the carts
 * they were rung up in.
 */
export const SalesPage: React.FC = () => {
  const {data, refresh, mutate} = useLiveData<{sales: Sale[]}>('/api/sales', {intervalMs: 30000, topics: ['content']});
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState<'all' | 'cash' | 'transfer'>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [period, setPeriod] = useState<Period>('week');

  const user = useAuthStore((state) => state.user);
  const canDelete = roleAtLeast(user?.role, 'manager');

  const [invoice, setInvoice] = useState<InvoiceTarget | null>(null);
  const [customer, setCustomer] = useState({name: '', address: '', taxNumber: ''});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sales = useMemo(() => data?.sales || [], [data]);

  /** Everything in the period, before the type filter — so the chips can show counts. */
  const inPeriod = useMemo(() => {
    const start = periodStart(period);
    return sales.filter((sale) => new Date(sale.at).getTime() >= start);
  }, [sales, period]);

  const kindOptions = useMemo(() => {
    const count = (predicate: (sale: Sale) => boolean) => inPeriod.filter(predicate).length;
    const options: {id: Kind; label: string; count: number}[] = [
      {id: 'all', label: 'ÖSSZES', count: inPeriod.length},
      {id: 'drink', label: 'ITAL', count: count((sale) => sale.category !== 'food')},
      {id: 'food', label: 'ÉTEL', count: count((sale) => sale.category === 'food')}
    ];
    for (const section of SECTION_ORDER) {
      const n = count((sale) => sale.category !== 'food' && (sale.section || 'other') === section);
      if (n) options.push({id: section, label: SECTION_LABELS[section], count: n});
    }
    return options;
  }, [inPeriod]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return inPeriod.filter((sale) => {
      if (method !== 'all' && sale.paymentMethod !== method) return false;
      if (kind === 'drink' && sale.category === 'food') return false;
      if (kind === 'food' && sale.category !== 'food') return false;
      if (kind !== 'all' && kind !== 'drink' && kind !== 'food' && (sale.category === 'food' || (sale.section || 'other') !== kind)) return false;
      if (!needle) return true;
      return normalize(`${sale.product || ''} ${sale.soldByName || sale.user || ''} ${sale.shiftId}`).includes(needle);
    });
  }, [inPeriod, query, method, kind]);

  const totals = useMemo(
    () => ({
      revenue: visible.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
      items: visible.reduce((sum, sale) => sum + Number(sale.qty || 0), 0),
      cash: visible.filter((sale) => sale.paymentMethod === 'cash').reduce((sum, sale) => sum + Number(sale.total || 0), 0)
    }),
    [visible]
  );

  /** Revenue by menu section within the current filter — the "what sells" view. */
  const bySection = useMemo(() => {
    const map = new Map<string, {label: string; qty: number; revenue: number}>();
    for (const sale of visible) {
      const key = sale.category === 'food' ? 'food' : sale.section || 'other';
      const entry = map.get(key) || {label: key === 'food' ? 'ÉTEL' : sectionLabel(key), qty: 0, revenue: 0};
      entry.qty += Number(sale.qty || 0);
      entry.revenue += Number(sale.total || 0);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }, [visible]);

  const topProducts = useMemo(() => {
    const map = new Map<string, {name: string; qty: number; revenue: number}>();
    for (const sale of visible) {
      const entry = map.get(sale.productId) || {name: sale.product || sale.productId, qty: 0, revenue: 0};
      entry.qty += Number(sale.qty || 0);
      entry.revenue += Number(sale.total || 0);
      map.set(sale.productId, entry);
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [visible]);

  /** Sales are stored per line; group them back into the carts they were rung up as. */
  const carts = useMemo(() => {
    const groups = new Map<string, Sale[]>();
    for (const sale of visible) {
      const key = sale.cartId || sale.id;
      const bucket = groups.get(key);
      if (bucket) bucket.push(sale);
      else groups.set(key, [sale]);
    }
    return [...groups.entries()].map(([key, lines]) => ({key, lines}));
  }, [visible]);

  const openInvoice = (target: InvoiceTarget) => {
    setInvoice(target);
    setCustomer({name: '', address: '', taxNumber: ''});
    setError('');
    playSfx('open');
  };

  const submitInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!invoice || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiSend<{document: {id: string}; alreadyExists?: boolean}>('/api/documents', 'POST', {saleId: invoice.saleId, customer});
      toast.success(result.alreadyExists ? 'Már van számla' : 'Számla elkészült', result.document.id);
      setInvoice(null);
      playSfx('success');
      refresh();
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const deleteCart = async (cartId: string, label: string) => {
    const sure = await dialog.confirm({
      title: `Törlöd a(z) ${label} kosarat?`,
      message: 'Az eladás minden tétele törlődik, a készlet visszakerül a polcra, a nyugta megsemmisül. A számla, ha volt, megmarad.',
      confirmLabel: 'KOSÁR TÖRLÉSE',
      tone: 'danger'
    });
    if (!sure) return;
    // The cart leaves the list now; the server confirms.
    mutate((current) => (current ? {sales: current.sales.filter((sale) => sale.cartId !== cartId)} : current));
    try {
      await apiSend(`/api/sales/cart/${encodeURIComponent(cartId)}`, 'DELETE');
      toast.success(`${label} törölve`, 'A készlet visszaállítva.');
      playSfx('delete');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
      refresh();
    }
  };

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / ELADÁSOK"
          title={
            <>
              Az <em>eladások.</em>
            </>
          }
          lead="Mi fogyott, miből, mennyiért. Szűrj italra, ételre vagy az itallap egy szakaszára, ahogy a termékeknél is."
        />

        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Chips value={period} onChange={setPeriod} options={(Object.keys(PERIOD_LABEL) as Period[]).map((id) => ({id, label: PERIOD_LABEL[id]}))}/>
          <Chips
            value={method}
            onChange={setMethod}
            options={[
              {id: 'all', label: 'MINDEN FIZETÉS'},
              {id: 'cash', label: 'KÉSZPÉNZ'},
              {id: 'transfer', label: 'ÁTUTALÁS'}
            ]}
          />
        </div>

        <div className="mb-6 flex flex-col gap-3">
          <span className="text-[8px] tracking-[0.25em] text-[#777]">TÍPUS ÉS SZAKASZ</span>
          <Chips value={kind} onChange={setKind} options={kindOptions}/>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <Stat label="BEVÉTEL" value={formatHuf(totals.revenue)} glyph="金" hint={`${formatHuf(totals.cash)} készpénz`}/>
          <Stat label="TÉTELEK" value={totals.items} glyph="品"/>
          <Stat label="KOSARAK" value={carts.length} glyph="籠"/>
          <Stat label="ÁTLAG KOSÁR" value={carts.length ? formatHuf(Math.round(totals.revenue / carts.length)) : '—'} glyph="均"/>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <Panel padded={false} label="SZAKASZOK SZERINT">
            {!bySection.length && <p className="px-6 py-5 text-[11px] text-[#8d8584]">Nincs eladás ezzel a szűréssel.</p>}
            {bySection.map((row) => {
              const share = totals.revenue ? Math.round((row.revenue / totals.revenue) * 100) : 0;
              return (
                <div key={row.label} className="border-b border-white/[0.04] px-6 py-3 last:border-b-0">
                  <div className="flex items-center justify-between text-[11px]">
                    <strong className="text-white">{row.label}</strong>
                    <span className="font-heading text-[14px] text-[color:var(--rm-red)]">{formatHuf(row.revenue)}</span>
                  </div>
                  <div className="mt-2 h-1 bg-white/[0.06]">
                    <div className="h-full bg-[color:var(--rm-red)]" style={{width: `${share}%`}}/>
                  </div>
                  <span className="mt-1 block text-[9px] text-[#777]">
                    {row.qty} db · {share}%
                  </span>
                </div>
              );
            })}
          </Panel>

          <Panel padded={false} label="LEGTÖBBET FOGYOTT">
            {!topProducts.length && <p className="px-6 py-5 text-[11px] text-[#8d8584]">Nincs adat.</p>}
            {topProducts.map((row, index) => (
              <div key={row.name} className="flex items-center gap-3 border-b border-white/[0.04] px-6 py-3 last:border-b-0">
                <span className="w-5 font-heading text-[12px] text-[#5f5959]">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-white">{row.name}</span>
                <span className="text-[10px] text-[#8d8584]">{row.qty} db</span>
                <span className="w-24 text-right font-heading text-[13px] text-[color:var(--rm-red)]">{formatHuf(row.revenue)}</span>
              </div>
            ))}
          </Panel>
        </div>

        <div className="mb-4">
          <SearchField value={query} onChange={setQuery} placeholder="TERMÉK, ELADÓ VAGY MŰSZAK…" className="sm:max-w-xs"/>
        </div>

        <Panel padded={false} label={`KOSARAK (${carts.length})`}>
          {!carts.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">Nincs eladás ezzel a szűréssel.</p>}

          {carts.map(({key, lines}) => {
            const first = lines[0];
            const cartTotal = lines.reduce((sum, line) => sum + Number(line.total || 0), 0);
            const cartLabel = first.cartId ? `#${first.cartId}` : 'Eladás';
            const invoiceId = lines.map((line) => line.documentId).find(Boolean) || null;
            return (
              <div key={key} className="border-b border-white/[0.04] px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <strong className="text-[11px] text-white">
                      {cartLabel} · {first.shiftId}
                    </strong>
                    <span className="ml-2 text-[9px] text-[#777]">
                      {formatDate(first.at)} {formatTime(first.at)} · {first.soldByName || first.user || '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {first.paymentMethod === 'cash' ? <Banknote size={12} className="text-[#777]"/> : <CreditCard size={12} className="text-[#777]"/>}
                    <strong className="font-heading text-[16px] text-[color:var(--rm-red)]">{formatHuf(cartTotal)}</strong>
                  </div>
                </div>

                <div className="mt-2 flex flex-col gap-1">
                  {lines.map((line) => (
                    <div key={line.id} className="flex justify-between text-[10px] text-[#8d8584]">
                      <span className="truncate pr-2">
                        {line.qty} × {line.product || line.productId}
                        <span className="ml-2 text-[8px] tracking-[0.15em] text-[#5f5959]">{line.category === 'food' ? 'ÉTEL' : sectionLabel(line.section)}</span>
                      </span>
                      <span className="shrink-0">{formatHuf(line.total)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {invoiceId ? (
                    <span className="inline-flex items-center gap-1.5 border border-[color:var(--rm-line)] px-3 py-1.5 text-[9px] tracking-[0.18em] text-[#8d8584]">
                      <FileText size={11} className="text-[color:var(--rm-red)]"/>
                      SZÁMLA · {invoiceId}
                    </span>
                  ) : (
                    <button type="button" onClick={() => openInvoice({saleId: first.id, cartLabel, total: cartTotal})} className="rm-btn is-ghost !px-3 !py-1.5 !text-[8px]">
                      <FileText size={11}/> SZÁMLA KÉRÉSE
                    </button>
                  )}

                  {canDelete && first.cartId && (
                    <button type="button" onClick={() => deleteCart(first.cartId as string, cartLabel)} className="rm-btn !px-3 !py-1.5 !text-[8px]">
                      <Trash2 size={11}/> KOSÁR TÖRLÉSE
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </Panel>
      </section>

      {invoice && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm">
          <form onSubmit={submitInvoice} className="w-full max-w-md border border-[color:var(--rm-line)] bg-[#09090b] p-7">
            <div className="flex items-start justify-between">
              <div>
                <span className="rm-label">SZÁMLA KIÁLLÍTÁSA</span>
                <h3 className="mt-2 font-heading text-[22px] text-white">
                  {invoice.cartLabel} · {formatHuf(invoice.total)}
                </h3>
              </div>
              <button type="button" onClick={() => setInvoice(null)} aria-label="Bezárás" className="text-[#8f8887] transition-colors hover:text-white">
                <X size={16}/>
              </button>
            </div>

            <p className="mt-3 text-[10px] leading-[1.8] text-[#8d8584]">A számla a kosár összes tételét tartalmazza. Egy kosárhoz csak egy számla tartozhat.</p>

            <div className="mt-5 flex flex-col gap-3">
              {(
                [
                  {key: 'name', label: 'VEVŐ NEVE', required: true},
                  {key: 'address', label: 'CÍM', required: false},
                  {key: 'taxNumber', label: 'ADÓSZÁM', required: false}
                ] as const
              ).map((field) => (
                <label key={field.key} className="flex flex-col gap-1.5">
                  <span className="text-[8px] tracking-[0.25em] text-[#777]">{field.label}</span>
                  <input value={customer[field.key]} onChange={(event) => setCustomer((current) => ({...current, [field.key]: event.target.value}))} required={field.required} maxLength={120} className="rm-input"/>
                </label>
              ))}
            </div>

            {error && <p className="mt-4 text-[10px] text-[color:var(--rm-red)]">{error}</p>}

            <div className="mt-6 flex gap-2.5">
              <Btn type="submit" variant="red" disabled={busy}>
                {busy ? 'KIÁLLÍTÁS…' : 'SZÁMLA KIÁLLÍTÁSA'}
              </Btn>
              <Btn type="button" onClick={() => setInvoice(null)}>
                MÉGSE
              </Btn>
            </div>
          </form>
        </div>
      )}
    </main>
  );
};
