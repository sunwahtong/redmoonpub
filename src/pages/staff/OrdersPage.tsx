import React, {useMemo, useState} from 'react';
import {Check, Package, Plus, Trash2, Truck, X} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn} from '../../components/ui/Btn';
import {Skeleton} from '../../components/ui/Skeleton';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatDate, formatHuf, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {
  isActive,
  ORDER_STATUS_CLASS,
  ORDER_STATUS_LABEL,
  ORDER_STEPS,
  varianceSeverity,
  variancePercent,
  type SupplyOrder
} from '../../lib/orders';
import type {PublicProduct} from '../../types';

interface Draft {
  productId: string;
  qty: number;
  unitCost: number;
}

type Filter = 'active' | 'mine' | 'all';

/** Pipeline strip: which of the four steps this order has passed. */
const Pipeline: React.FC<{order: SupplyOrder}> = ({order}) => {
  const index = ORDER_STEPS.findIndex((step) => step.status === order.status);
  return (
    <div className="rm-pipe mt-4">
      {ORDER_STEPS.map((step, position) => {
        const state = position < index ? 'done' : position === index ? 'current' : 'todo';
        return (
          <React.Fragment key={step.status}>
            {position > 0 && <span className="rm-pipe-link" data-state={position <= index ? 'done' : 'todo'}/>}
            <span className="rm-pipe-step" data-state={state}>
              <span className="rm-pipe-dot"/>
              {step.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export const OrdersPage: React.FC = () => {
  const {data, loading, refresh} = useLiveData<{
    orders: SupplyOrder[];
    canCreate: boolean;
    canRun: boolean;
  }>('/api/orders', {intervalMs: 20000});
  const {data: productData} = useLiveData<{products: PublicProduct[]}>('/api/public-products');

  const [filter, setFilter] = useState<Filter>('active');
  const [composing, setComposing] = useState(false);
  const [lines, setLines] = useState<Draft[]>([]);
  const [source, setSource] = useState('Nagyker');
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Order being closed out, and the amount actually paid. */
  const [closing, setClosing] = useState<SupplyOrder | null>(null);
  const [actualTotal, setActualTotal] = useState('');
  const [varianceNote, setVarianceNote] = useState('');

  const orders = useMemo(() => data?.orders || [], [data]);
  const products = productData?.products || [];
  const canCreate = !!data?.canCreate;
  const canRun = !!data?.canRun;

  const visible = useMemo(() => {
    if (filter === 'all') return orders;
    if (filter === 'active') return orders.filter((order) => isActive(order.status));
    return orders.filter((order) => order.claimedById && isActive(order.status));
  }, [orders, filter]);

  const draftTotal = lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0);

  const counts = useMemo(
    () => ({
      open: orders.filter((order) => order.status === 'open').length,
      running: orders.filter((order) => ['claimed', 'progress'].includes(order.status)).length,
      spend: orders
        .filter((order) => order.status === 'completed')
        .reduce((sum, order) => sum + (Number(order.actualTotal) || 0), 0)
    }),
    [orders]
  );

  const act = async (order: SupplyOrder, action: 'claim' | 'start' | 'cancel') => {
    if (busyId) return;
    setBusyId(order.id);
    try {
      await apiSend(`/api/orders/${encodeURIComponent(order.id)}/${action}`, 'POST', {});
      toast.success(`${order.code} · ${action === 'cancel' ? 'visszavonva' : 'frissítve'}`);
      playSfx(action === 'cancel' ? 'decline' : 'accept');
      refresh();
    } catch (err) {
      toast.error('A művelet nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusyId(null);
    }
  };

  const submitDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!lines.length) return;
    try {
      await apiSend('/api/orders', 'POST', {items: lines, source, note});
      toast.success('Beszerzés kiírva');
      playSfx('success');
      setLines([]);
      setNote('');
      setComposing(false);
      refresh();
    } catch (err) {
      toast.error('A beszerzés nem ment el', (err as Error).message);
      playSfx('error');
    }
  };

  const submitClose = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!closing) return;
    const amount = Number(actualTotal);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Adj meg érvényes összeget');
      return;
    }
    setBusyId(closing.id);
    try {
      await apiSend(`/api/orders/${encodeURIComponent(closing.id)}/complete`, 'POST', {
        actualTotal: amount,
        varianceNote
      });
      toast.success(`${closing.code} teljesítve`, 'A készlet feltöltve.');
      playSfx('success');
      setClosing(null);
      setActualTotal('');
      setVarianceNote('');
      refresh();
    } catch (err) {
      toast.error('A lezárás nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusyId(null);
    }
  };

  const openClose = (order: SupplyOrder) => {
    setClosing(order);
    // Pre-fill with the estimate: most runs land on it, and the point of the
    // field is the exception, not the routine.
    setActualTotal(String(order.estimatedTotal));
    setVarianceNote('');
    playSfx('open');
  };

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / BESZERZÉS</div>
        <NeonHeading as="h1" size={2} className="mb-3 mt-3.5">
          A <em>beszerzések.</em>
        </NeonHeading>
        <p className="rm-lead mb-10 text-[12px]">
          A ház maga hozza az árut. Az üzletvezető kiírja, mi kell és mibe kerül; aki elvégzi, beírja, mibe került
          valójában. A kettő különbsége itt marad.
        </p>

        <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          {[
            {label: 'KIÍRVA', value: String(counts.open), glyph: '待'},
            {label: 'FOLYAMATBAN', value: String(counts.running), glyph: '運'},
            {label: 'ÖSSZES KIADÁS', value: formatHuf(counts.spend), glyph: '銭'}
          ].map((stat) => (
            <div key={stat.label} className="rm-stat p-6">
              <span className="rm-stat-glyph" aria-hidden="true">
                {stat.glyph}
              </span>
              <span className="relative block text-[8px] tracking-[0.25em] text-[#777]">{stat.label}</span>
              <strong className="relative mt-2 block font-heading text-[26px] leading-none text-white">
                {stat.value}
              </strong>
            </div>
          ))}
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {(
              [
                {id: 'active', label: 'AKTÍV'},
                {id: 'mine', label: 'FOLYAMATBAN'},
                {id: 'all', label: 'ÖSSZES'}
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                aria-pressed={filter === option.id}
                className={`border px-4 py-2.5 text-[9px] font-bold tracking-[0.2em] transition-all ${
                  filter === option.id
                    ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.12)] text-white'
                    : 'border-white/10 text-[#8f8887] hover:border-white/30'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {canCreate && (
            <Btn variant={composing ? 'outline' : 'red'} onClick={() => setComposing((value) => !value)}>
              {composing ? (
                <>
                  <X size={13}/> MÉGSE
                </>
              ) : (
                <>
                  <Plus size={13}/> ÚJ BESZERZÉS
                </>
              )}
            </Btn>
          )}
        </div>

        {/* ---------------------------------------------- COMPOSER */}
        {composing && canCreate && (
          <form onSubmit={submitDraft} className="mb-8 border border-[color:var(--rm-line-red)] bg-[#09090b] p-7">
            <span className="rm-label">ÚJ BESZERZÉS</span>
            <h2 className="mb-6 mt-2 font-heading text-[22px] text-white">Mit kell hozni?</h2>

            <div className="flex flex-col gap-2.5">
              {lines.map((line, index) => {
                const product = products.find((entry) => entry.id === line.productId);
                return (
                  <div
                    key={index}
                    className="grid grid-cols-[1fr_84px_120px_auto] items-end gap-2.5 border border-white/[0.06] bg-black/30 p-3"
                  >
                    <div>
                      <span className="text-[8px] tracking-[0.22em] text-[#777]">TÉTEL</span>
                      <p className="mt-1 truncate text-[11px] text-white">{product?.name || line.productId}</p>
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-[8px] tracking-[0.22em] text-[#777]">DB</span>
                      <input
                        type="number"
                        min={1}
                        value={line.qty}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((entry, position) =>
                              position === index ? {...entry, qty: Math.max(1, Number(event.target.value) || 1)} : entry
                            )
                          )
                        }
                        className="border border-white/10 bg-black/50 px-2.5 py-2 text-[11px] text-white outline-none focus:border-[color:var(--rm-red)]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[8px] tracking-[0.22em] text-[#777]">BECSÜLT EGYSÉGÁR</span>
                      <input
                        type="number"
                        min={0}
                        value={line.unitCost}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((entry, position) =>
                              position === index
                                ? {...entry, unitCost: Math.max(0, Number(event.target.value) || 0)}
                                : entry
                            )
                          )
                        }
                        className="border border-white/10 bg-black/50 px-2.5 py-2 text-[11px] text-white outline-none focus:border-[color:var(--rm-red)]"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setLines((current) => current.filter((_, position) => position !== index))}
                      aria-label="Tétel törlése"
                      className="p-2.5 text-[#777] transition-colors hover:text-[color:var(--rm-red)]"
                    >
                      <Trash2 size={13}/>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-2.5">
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-[8px] tracking-[0.22em] text-[#777]">TÉTEL HOZZÁADÁSA</span>
                <select
                  value=""
                  onChange={(event) => {
                    const id = event.target.value;
                    if (!id) return;
                    setLines((current) =>
                      current.some((line) => line.productId === id)
                        ? current
                        : [...current, {productId: id, qty: 6, unitCost: 0}]
                    );
                  }}
                  className="border border-white/10 bg-black/50 px-3 py-2.5 text-[11px] text-white outline-none focus:border-[color:var(--rm-red)]"
                >
                  <option value="">Válassz terméket…</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[8px] tracking-[0.22em] text-[#777]">BESZERZÉS HELYE</span>
                <input
                  value={source}
                  onChange={(event) => setSource(event.target.value.slice(0, 80))}
                  className="border border-white/10 bg-black/50 px-3 py-2.5 text-[11px] text-white outline-none focus:border-[color:var(--rm-red)]"
                />
              </label>
            </div>

            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-[8px] tracking-[0.22em] text-[#777]">MEGJEGYZÉS</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 400))}
                placeholder="Bármi, amit a futárnak tudnia kell"
                className="border border-white/10 bg-black/50 px-3 py-2.5 text-[11px] text-white outline-none placeholder:text-white/25 focus:border-[color:var(--rm-red)]"
              />
            </label>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-5">
              <div>
                <span className="text-[8px] tracking-[0.25em] text-[#777]">BECSÜLT ÖSSZEG</span>
                <strong className="mt-1 block font-heading text-[26px] leading-none text-[color:var(--rm-red)]">
                  {formatHuf(draftTotal)}
                </strong>
              </div>
              <Btn type="submit" variant="red" disabled={!lines.length}>
                KIÍRÁS <Package size={13}/>
              </Btn>
            </div>
          </form>
        )}

        {/* ---------------------------------------------- LIST */}
        {loading && (
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-44" count={3}/>
          </div>
        )}

        {!loading && (
          <div className="flex flex-col gap-2.5">
            {!visible.length && (
              <p className="rm-card p-6 text-[11px] text-[#8d8584]">Nincs beszerzés ezzel a szűréssel.</p>
            )}

            {visible.map((order) => {
              const severity = varianceSeverity(order);
              const percent = variancePercent(order);
              const mine = order.claimedById && order.status !== 'completed';
              return (
                <article key={order.id} className="rm-card p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <strong className="font-heading text-[20px] text-white">{order.code}</strong>
                        <span
                          className={`border px-2.5 py-1 text-[8px] tracking-[0.18em] ${ORDER_STATUS_CLASS[order.status]}`}
                        >
                          {ORDER_STATUS_LABEL[order.status].toUpperCase()}
                        </span>
                        <span className="text-[9px] tracking-[0.15em] text-[#6f6968]">{order.source}</span>
                      </div>

                      <p className="mt-2 text-[10px] text-[#8d8584]">
                        Kiírta: {order.createdByName} · {formatDate(order.at)} {formatTime(order.at)}
                        {order.claimedByName ? ` · Elvállalta: ${order.claimedByName}` : ''}
                        {order.completedByName ? ` · Teljesítette: ${order.completedByName}` : ''}
                      </p>

                      {order.note && (
                        <p className="mt-2.5 border-l border-[color:var(--rm-line-red)] pl-3 text-[11px] leading-[1.7] text-[#a09998]">
                          {order.note}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <span className="block text-[8px] tracking-[0.22em] text-[#777]">BECSÜLT</span>
                      <strong className="block font-heading text-[19px] leading-tight text-white">
                        {formatHuf(order.estimatedTotal)}
                      </strong>
                      {order.actualTotal !== null && (
                        <>
                          <span className="mt-2.5 block text-[8px] tracking-[0.22em] text-[#777]">TÉNYLEGES</span>
                          <strong className="block font-heading text-[19px] leading-tight text-[color:var(--rm-red)]">
                            {formatHuf(order.actualTotal)}
                          </strong>
                        </>
                      )}
                    </div>
                  </div>

                  <Pipeline order={order}/>

                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/[0.06] pt-4 text-[10px] text-[#8d8584]">
                    {order.items.map((line) => (
                      <span key={line.productId}>
                        {line.qty} × <b className="text-[#c9c2c1]">{line.product}</b>
                        <span className="text-[#6f6968]"> · {formatHuf(line.unitCost)}/db</span>
                      </span>
                    ))}
                  </div>

                  {order.variance !== null && severity !== 'none' && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <span className="rm-variance" data-severity={severity}>
                        <b className="font-heading text-[14px]">
                          {order.variance > 0 ? '+' : ''}
                          {formatHuf(order.variance)}
                        </b>
                        {percent !== null && (
                          <span className="text-[9px] tracking-[0.15em]">
                            {percent > 0 ? '+' : ''}
                            {percent.toFixed(1)}%
                          </span>
                        )}
                      </span>
                      {severity === 'major' && (
                        <span className="text-[9px] tracking-[0.15em] text-[color:var(--rm-red)]">
                          ELTÉRÉS A TŰRÉSHATÁRON KÍVÜL
                        </span>
                      )}
                      {order.varianceNote && (
                        <span className="text-[10px] text-[#8d8584]">„{order.varianceNote}”</span>
                      )}
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap gap-2">
                    {order.status === 'open' && canRun && (
                      <Btn variant="red" disabled={busyId === order.id} onClick={() => act(order, 'claim')}>
                        ELVÁLLALOM <Truck size={13}/>
                      </Btn>
                    )}
                    {order.status === 'claimed' && mine && (
                      <Btn variant="red" disabled={busyId === order.id} onClick={() => act(order, 'start')}>
                        ELINDULTAM
                      </Btn>
                    )}
                    {(order.status === 'claimed' || order.status === 'progress') && mine && (
                      <Btn disabled={busyId === order.id} onClick={() => openClose(order)}>
                        LEZÁRÁS <Check size={13}/>
                      </Btn>
                    )}
                    {canCreate && isActive(order.status) && (
                      <Btn disabled={busyId === order.id} onClick={() => act(order, 'cancel')}>
                        VISSZAVONÁS
                      </Btn>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------------------------------------------- CLOSE-OUT */}
      {closing && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm">
          <form onSubmit={submitClose} className="w-full max-w-md border border-[color:var(--rm-line)] bg-[#09090b] p-7">
            <div className="flex items-start justify-between">
              <div>
                <span className="rm-label">BESZERZÉS LEZÁRÁSA</span>
                <h3 className="mt-2 font-heading text-[22px] text-white">{closing.code}</h3>
              </div>
              <button
                type="button"
                onClick={() => setClosing(null)}
                aria-label="Bezárás"
                className="text-[#8f8887] transition-colors hover:text-white"
              >
                <X size={16}/>
              </button>
            </div>

            <p className="mt-3 text-[10px] leading-[1.8] text-[#8d8584]">
              Írd be, mennyit fizettél valójában. Ha eltér a becsülttől, az eltérés a beszerzés mellett marad.
            </p>

            <div className="mt-5 flex items-center justify-between border border-white/[0.07] bg-black/40 px-4 py-3">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">BECSÜLT</span>
              <strong className="font-heading text-[17px] text-white">{formatHuf(closing.estimatedTotal)}</strong>
            </div>

            <label className="mt-3 flex flex-col gap-2">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">TÉNYLEGESEN FIZETETT</span>
              <input
                type="number"
                min={0}
                value={actualTotal}
                onChange={(event) => setActualTotal(event.target.value)}
                required
                className="border border-white/10 bg-black/50 px-3.5 py-3 font-heading text-[19px] text-white outline-none focus:border-[color:var(--rm-red)]"
              />
            </label>

            {Number(actualTotal) !== closing.estimatedTotal && Number.isFinite(Number(actualTotal)) && (
              <>
                <p className="mt-3 text-[10px] text-[color:var(--rm-red)]">
                  Eltérés: {Number(actualTotal) - closing.estimatedTotal > 0 ? '+' : ''}
                  {formatHuf(Number(actualTotal) - closing.estimatedTotal)}
                </p>
                <label className="mt-3 flex flex-col gap-2">
                  <span className="text-[8px] tracking-[0.25em] text-[#777]">MIÉRT TÉR EL?</span>
                  <textarea
                    value={varianceNote}
                    onChange={(event) => setVarianceNote(event.target.value.slice(0, 400))}
                    rows={2}
                    placeholder="Pl. a rum ára ment fel"
                    className="border border-white/10 bg-black/50 px-3.5 py-2.5 text-[11px] text-white outline-none placeholder:text-white/25 focus:border-[color:var(--rm-red)]"
                  />
                </label>
              </>
            )}

            <div className="mt-6 flex gap-2.5">
              <Btn type="submit" variant="red" disabled={busyId === closing.id}>
                {busyId === closing.id ? 'LEZÁRÁS…' : 'LEZÁRÁS ÉS KÉSZLETRE VÉTEL'}
              </Btn>
              <button
                type="button"
                onClick={() => setClosing(null)}
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
