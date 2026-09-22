import React, {useMemo, useState} from 'react';
import {AlertTriangle, PackagePlus, Search, SlidersHorizontal} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn} from '../../components/ui/Btn';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatDate, formatHuf, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {sectionLabel} from '../../lib/sections';
import {useAuthStore, roleAtLeast} from '../../stores/useAuthStore';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  minStock: number;
  active: boolean;
  category: string;
  section: string;
}

interface RestockLog {
  id: string;
  at: string;
  user: string;
  product: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  source: string;
  note?: string;
}

interface Line {
  qty: string;
  unitCost: string;
}

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const InventoryPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const isOwner = roleAtLeast(user?.role, 'owner');

  const {data: productData, refresh: refreshProducts} = useLiveData<{products: Product[]}>('/api/products', {
    intervalMs: 30000
  });
  const {data: logData, refresh: refreshLogs} = useLiveData<{logs: RestockLog[]}>('/api/restock/logs', {
    intervalMs: 60000
  });

  const [query, setQuery] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [source, setSource] = useState('nagyker');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{kind: 'ok' | 'error'; text: string} | null>(null);
  const [busy, setBusy] = useState(false);

  const products = useMemo(
    () => (productData?.products || []).filter((product) => product.active),
    [productData]
  );

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return products.filter((product) => {
      if (onlyLow && product.stock > product.minStock) return false;
      if (!needle) return true;
      return normalize(product.name).includes(needle);
    });
  }, [products, query, onlyLow]);

  const basket = useMemo(
    () =>
      Object.entries(lines)
        .map(([productId, line]) => {
          const product = products.find((item) => item.id === productId);
          const qty = Math.floor(Number(line.qty));
          const unitCost = Number(line.unitCost) || 0;
          if (!product || !Number.isInteger(qty) || qty < 1) return null;
          return {product, qty, unitCost};
        })
        .filter((entry): entry is {product: Product; qty: number; unitCost: number} => !!entry),
    [lines, products]
  );

  const basketTotal = basket.reduce((sum, entry) => sum + entry.qty * entry.unitCost, 0);

  const setLine = (productId: string, patch: Partial<Line>) =>
    setLines((current) => ({
      ...current,
      [productId]: {...{qty: '', unitCost: ''}, ...current[productId], ...patch}
    }));

  const submitRestock = async () => {
    if (!basket.length || busy) return;
    setBusy(true);
    setMessage(null);

    try {
      await apiSend('/api/restock', 'POST', {
        source,
        note,
        items: basket.map((entry) => ({
          productId: entry.product.id,
          qty: entry.qty,
          unitCost: entry.unitCost
        }))
      });
      setLines({});
      setNote('');
      setMessage({kind: 'ok', text: `Feltöltés rögzítve · ${formatHuf(basketTotal)}`});
      playSfx('success');
      refreshProducts();
      refreshLogs();
    } catch (err) {
      setMessage({kind: 'error', text: (err as Error).message});
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  /** Owner-only: overwrite the counted stock rather than adding to it. */
  const setOpeningStock = async (product: Product) => {
    const input = window.prompt(`${product.name} — nyitókészlet (jelenleg ${product.stock} db):`, String(product.stock));
    if (input === null) return;
    const stock = Math.floor(Number(input));
    if (!Number.isInteger(stock) || stock < 0) {
      setMessage({kind: 'error', text: 'Érvénytelen készletérték.'});
      return;
    }

    try {
      await apiSend('/api/inventory/adjust', 'POST', {productId: product.id, stock});
      playSfx('success');
      refreshProducts();
      setMessage({kind: 'ok', text: `${product.name}: nyitókészlet ${stock} db.`});
    } catch (err) {
      setMessage({kind: 'error', text: (err as Error).message});
      playSfx('error');
    }
  };

  const field =
    'w-full border border-white/10 bg-black/50 p-2.5 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]';

  const lowCount = products.filter((product) => product.stock <= product.minStock).length;

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / RAKTÁR</div>
        <NeonHeading as="h1" size={2} className="mb-8 mt-3.5">
          A <em>készlet.</em>
        </NeonHeading>

        {message && (
          <p className={`mb-6 text-[11px] ${message.kind === 'ok' ? 'text-emerald-400' : 'text-[color:var(--rm-red)]'}`}>
            {message.text}
          </p>
        )}

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative flex w-full items-center sm:max-w-xs">
            <Search size={14} className="absolute left-4 text-[#6d5d64]"/>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="TERMÉK KERESÉSE…"
              className="w-full border border-[color:var(--rm-line)] bg-black/50 py-3 pl-10 pr-4 text-[10px] tracking-[0.15em] text-white outline-none focus:border-[color:var(--rm-red)]"
            />
          </label>

          <button
            type="button"
            onClick={() => setOnlyLow((value) => !value)}
            aria-pressed={onlyLow}
            className={`flex items-center gap-2 border px-4 py-2.5 text-[9px] font-bold tracking-[0.2em] transition-all ${
              onlyLow
                ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.12)] text-white'
                : 'border-white/10 text-[#8f8887] hover:border-white/30'
            }`}
          >
            <AlertTriangle size={12}/> CSAK FOGYÓBAN ({lowCount})
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          {/* Stock table */}
          <div className="rm-card p-0 lg:col-span-2">
            <div className="border-b border-[color:var(--rm-line)] px-6 py-4">
              <span className="rm-label">KÉSZLET ({visible.length})</span>
            </div>

            <div className="max-h-[520px] overflow-y-auto">
              {visible.map((product) => {
                const low = product.stock <= product.minStock;
                const line = lines[product.id];
                return (
                  <div key={product.id} className="border-b border-white/[0.04] px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-[11px] text-white">{product.name}</strong>
                        <span className="text-[9px] text-[#777]">
                          {sectionLabel(product.section)} · {formatHuf(product.price)}
                        </span>
                      </div>
                      <span className={`text-[11px] tabular-nums ${low ? 'text-[color:var(--rm-red)]' : 'text-white'}`}>
                        {product.stock} / {product.minStock}
                      </span>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => setOpeningStock(product)}
                          aria-label="Nyitókészlet beállítása"
                          className="text-[#777] transition-colors hover:text-white"
                        >
                          <SlidersHorizontal size={12}/>
                        </button>
                      )}
                    </div>

                    <div className="mt-2 flex gap-2">
                      <input
                        type="number"
                        min={1}
                        placeholder="db"
                        value={line?.qty ?? ''}
                        onChange={(event) => setLine(product.id, {qty: event.target.value})}
                        className={`${field} max-w-[90px]`}
                      />
                      <input
                        type="number"
                        min={0}
                        placeholder="beszerzési ár / db"
                        value={line?.unitCost ?? ''}
                        onChange={(event) => setLine(product.id, {unitCost: event.target.value})}
                        className={`${field} max-w-[170px]`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Restock basket + history */}
          <div className="flex flex-col gap-3.5">
            <div className="rm-card p-6">
              <span className="rm-label">FELTÖLTÉS</span>
              <h2 className="mb-4 mt-2 font-heading text-[20px] text-white">
                {basket.length} tétel
              </h2>

              {basket.map((entry) => (
                <div key={entry.product.id} className="flex justify-between border-b border-white/[0.04] py-2 text-[10px]">
                  <span className="truncate pr-2 text-white">{entry.product.name}</span>
                  <span className="shrink-0 text-[#777]">
                    {entry.qty} × {formatHuf(entry.unitCost)}
                  </span>
                </div>
              ))}

              <label className="mt-4 flex flex-col gap-1.5">
                <span className="text-[8px] tracking-[0.25em] text-[#777]">BESZERZÉS HELYE</span>
                <input value={source} onChange={(event) => setSource(event.target.value)} maxLength={60} className={field}/>
              </label>

              <label className="mt-3 flex flex-col gap-1.5">
                <span className="text-[8px] tracking-[0.25em] text-[#777]">MEGJEGYZÉS</span>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} className={field}/>
              </label>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-[9px] tracking-[0.2em] text-[#777]">KÖLTSÉG</span>
                <strong className="font-heading text-[20px] text-white">{formatHuf(basketTotal)}</strong>
              </div>

              <Btn
                variant="red"
                onClick={submitRestock}
                disabled={!basket.length || busy}
                className="mt-4 w-full justify-center"
              >
                <PackagePlus size={13}/> {busy ? 'RÖGZÍTÉS…' : 'FELTÖLTÉS RÖGZÍTÉSE'}
              </Btn>
            </div>

            <div className="rm-card p-0">
              <div className="border-b border-[color:var(--rm-line)] px-6 py-4">
                <span className="rm-label">ELŐZMÉNYEK</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {!logData?.logs.length && (
                  <p className="px-6 py-4 text-[11px] text-[#8d8584]">Nincs feltöltési előzmény.</p>
                )}
                {logData?.logs.slice(0, 40).map((log) => (
                  <div key={log.id} className="border-b border-white/[0.04] px-6 py-3">
                    <div className="flex justify-between text-[10px]">
                      <strong className="truncate pr-2 text-white">{log.product}</strong>
                      <span className="shrink-0 text-[color:var(--rm-red)]">+{log.qty}</span>
                    </div>
                    <span className="mt-1 block text-[9px] text-[#777]">
                      {formatDate(log.at)} {formatTime(log.at)} · {log.user} · {formatHuf(log.totalCost)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
