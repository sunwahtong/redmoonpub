import React, {useMemo, useState} from 'react';
import {Banknote, CreditCard, FileText, Search, Trash2, X} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn} from '../../components/ui/Btn';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatDate, formatHuf, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {dialog} from '../../stores/useDialogStore';
import {useAuthStore, roleAtLeast} from '../../stores/useAuthStore';

interface Sale {
  id: string;
  at: string;
  shiftId: string;
  productId: string;
  product?: string;
  qty: number;
  total: number;
  paymentMethod: 'cash' | 'transfer';
  soldByName?: string;
  user?: string;
  cartId?: string;
  cartNumber?: number;
  documentId?: string | null;
}

interface InvoiceTarget {
  saleId: string;
  cartLabel: string;
  total: number;
}

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const SalesPage: React.FC = () => {
  const {data, refresh} = useLiveData<{sales: Sale[]}>('/api/sales', {intervalMs: 30000});
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState<'all' | 'cash' | 'transfer'>('all');

  const user = useAuthStore((state) => state.user);
  const canDelete = roleAtLeast(user?.role, 'manager');

  /* Invoice dialog. The endpoint has existed since the legacy back end but had
     no way to reach it, so no invoice could ever be issued from the console. */
  const [invoice, setInvoice] = useState<InvoiceTarget | null>(null);
  const [customer, setCustomer] = useState({name: '', address: '', taxNumber: ''});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const sales = useMemo(() => data?.sales || [], [data]);

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
      const result = await apiSend<{document: {id: string}; alreadyExists?: boolean}>(
        '/api/documents',
        'POST',
        {saleId: invoice.saleId, customer}
      );
      setNotice(
        result.alreadyExists
          ? `Ehhez a kosárhoz már tartozik számla: ${result.document.id}`
          : `Számla elkészült: ${result.document.id}`
      );
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
    try {
      await apiSend(`/api/sales/cart/${encodeURIComponent(cartId)}`, 'DELETE');
      setNotice(`${label} törölve, a készlet visszaállítva.`);
      playSfx('delete');
      refresh();
    } catch (err) {
      setNotice((err as Error).message);
      playSfx('error');
    }
  };

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return sales.filter((sale) => {
      if (method !== 'all' && sale.paymentMethod !== method) return false;
      if (!needle) return true;
      return normalize(`${sale.product || ''} ${sale.soldByName || sale.user || ''} ${sale.shiftId}`).includes(needle);
    });
  }, [sales, query, method]);

  const totals = useMemo(
    () => ({
      revenue: visible.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
      items: visible.reduce((sum, sale) => sum + Number(sale.qty || 0), 0)
    }),
    [visible]
  );

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

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / ELADÁSOK</div>
        <NeonHeading as="h1" size={2} className="mb-8 mt-3.5">
          Az <em>eladások.</em>
        </NeonHeading>

        <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <div className="rm-card p-5">
            <span className="text-[8px] tracking-[0.25em] text-[#777]">BEVÉTEL</span>
            <strong className="mt-2 block font-heading text-[24px] text-white">{formatHuf(totals.revenue)}</strong>
          </div>
          <div className="rm-card p-5">
            <span className="text-[8px] tracking-[0.25em] text-[#777]">TÉTELEK</span>
            <strong className="mt-2 block font-heading text-[24px] text-white">{totals.items}</strong>
          </div>
          <div className="rm-card p-5">
            <span className="text-[8px] tracking-[0.25em] text-[#777]">KOSARAK</span>
            <strong className="mt-2 block font-heading text-[24px] text-white">{carts.length}</strong>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative flex w-full items-center sm:max-w-xs">
            <Search size={14} className="absolute left-4 text-[#6d5d64]"/>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="TERMÉK, ELADÓ VAGY MŰSZAK…"
              className="w-full border border-[color:var(--rm-line)] bg-black/50 py-3 pl-10 pr-4 text-[10px] tracking-[0.15em] text-white outline-none focus:border-[color:var(--rm-red)]"
            />
          </label>

          <div className="flex gap-2">
            {(
              [
                {id: 'all', label: 'ÖSSZES'},
                {id: 'cash', label: 'KÉSZPÉNZ'},
                {id: 'transfer', label: 'ÁTUTALÁS'}
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setMethod(option.id)}
                aria-pressed={method === option.id}
                className={`border px-4 py-2.5 text-[9px] font-bold tracking-[0.2em] transition-all ${
                  method === option.id
                    ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.12)] text-white'
                    : 'border-white/10 text-[#8f8887] hover:border-white/30'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rm-card p-0">
          <div className="border-b border-[color:var(--rm-line)] px-6 py-4">
            <span className="rm-label">KOSARAK ({carts.length})</span>
          </div>

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
                    {first.paymentMethod === 'cash' ? (
                      <Banknote size={12} className="text-[#777]"/>
                    ) : (
                      <CreditCard size={12} className="text-[#777]"/>
                    )}
                    <strong className="font-heading text-[16px] text-[color:var(--rm-red)]">
                      {formatHuf(cartTotal)}
                    </strong>
                  </div>
                </div>

                <div className="mt-2 flex flex-col gap-1">
                  {lines.map((line) => (
                    <div key={line.id} className="flex justify-between text-[10px] text-[#8d8584]">
                      <span className="truncate pr-2">
                        {line.qty} × {line.product || line.productId}
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
                    <button
                      type="button"
                      onClick={() => openInvoice({saleId: first.id, cartLabel, total: cartTotal})}
                      className="inline-flex items-center gap-1.5 border border-white/10 px-3 py-1.5 text-[9px] font-bold tracking-[0.18em] text-[#8f8887] transition-colors hover:border-[color:var(--rm-red)] hover:text-white"
                    >
                      <FileText size={11}/>
                      SZÁMLA KÉRÉSE
                    </button>
                  )}

                  {canDelete && first.cartId && (
                    <button
                      type="button"
                      onClick={() => deleteCart(first.cartId as string, cartLabel)}
                      className="inline-flex items-center gap-1.5 border border-white/10 px-3 py-1.5 text-[9px] font-bold tracking-[0.18em] text-[#8f8887] transition-colors hover:border-[color:var(--rm-red)] hover:text-white"
                    >
                      <Trash2 size={11}/>
                      KOSÁR TÖRLÉSE
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {notice && (
          <p
            role="status"
            className="mt-4 border border-[color:var(--rm-line)] bg-black/50 px-4 py-3 text-[10px] tracking-[0.15em] text-[#c9c2c1]"
          >
            {notice}
          </p>
        )}
      </section>

      {invoice && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm">
          <form
            onSubmit={submitInvoice}
            className="w-full max-w-md border border-[color:var(--rm-line)] bg-[#09090b] p-7"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="rm-label">SZÁMLA KIÁLLÍTÁSA</span>
                <h3 className="mt-2 font-heading text-[22px] text-white">
                  {invoice.cartLabel} · {formatHuf(invoice.total)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInvoice(null)}
                aria-label="Bezárás"
                className="text-[#8f8887] transition-colors hover:text-white"
              >
                <X size={16}/>
              </button>
            </div>

            <p className="mt-3 text-[10px] leading-[1.8] text-[#8d8584]">
              A számla a kosár összes tételét tartalmazza. Egy kosárhoz csak egy számla tartozhat.
            </p>

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
                  <input
                    value={customer[field.key]}
                    onChange={(event) => setCustomer((current) => ({...current, [field.key]: event.target.value}))}
                    required={field.required}
                    maxLength={120}
                    className="border border-[color:var(--rm-line)] bg-black/50 px-3.5 py-2.5 text-[11px] text-white outline-none focus:border-[color:var(--rm-red)]"
                  />
                </label>
              ))}
            </div>

            {error && <p className="mt-4 text-[10px] text-[color:var(--rm-red)]">{error}</p>}

            <div className="mt-6 flex gap-2.5">
              <Btn type="submit" disabled={busy}>
                {busy ? 'KIÁLLÍTÁS…' : 'SZÁMLA KIÁLLÍTÁSA'}
              </Btn>
              <button
                type="button"
                onClick={() => setInvoice(null)}
                className="border border-white/10 px-5 py-2.5 text-[9px] font-bold tracking-[0.2em] text-[#8f8887] transition-colors hover:border-white/30 hover:text-white"
              >
                MÉGSE
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
};
