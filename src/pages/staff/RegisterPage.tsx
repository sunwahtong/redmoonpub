import React, {useMemo, useState} from 'react';
import {Banknote, CreditCard, Minus, Plus, ReceiptText, Search, ShoppingCart, Trash2} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn, BtnLink} from '../../components/ui/Btn';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, assetUrl, formatHuf} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {sectionLabel} from '../../lib/sections';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  minStock: number;
  image?: string;
  active: boolean;
  category: string;
  section: string;
}

interface Shift {
  id: string;
  status: string;
}

type PaymentMethod = 'cash' | 'transfer';

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const RegisterPage: React.FC = () => {
  const {data: productData, refresh: refreshProducts} = useLiveData<{products: Product[]}>('/api/products', {
    intervalMs: 30000
  });
  const {data: shiftData, refresh: refreshShift} = useLiveData<{shift: Shift | null}>('/api/shifts/current', {
    intervalMs: 20000
  });

  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [message, setMessage] = useState<{kind: 'ok' | 'error'; text: string} | null>(null);
  const [busy, setBusy] = useState(false);
  /** Last completed sale, so a receipt can be issued for it. */
  const [lastSale, setLastSale] = useState<{saleId: string; total: number} | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const products = useMemo(
    () => (productData?.products || []).filter((product) => product.active && ['drink', 'food'].includes(product.category)),
    [productData]
  );

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return products;
    return products.filter((product) => normalize(product.name).includes(needle));
  }, [products, query]);

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => {
          const product = products.find((item) => item.id === id);
          return product ? {product, qty} : null;
        })
        .filter((line): line is {product: Product; qty: number} => !!line),
    [cart, products]
  );

  const total = lines.reduce((sum, line) => sum + line.product.price * line.qty, 0);
  const shiftOpen = shiftData?.shift?.status === 'open';

  const add = (product: Product) => {
    setCart((current) => {
      const next = (current[product.id] || 0) + 1;
      // Never let the cart exceed what is physically on the shelf.
      if (next > product.stock) {
        setMessage({kind: 'error', text: `Nincs több készlet: ${product.name} (${product.stock} db).`});
        playSfx('error');
        return current;
      }
      return {...current, [product.id]: next};
    });
  };

  const sub = (id: string) =>
    setCart((current) => {
      const next = (current[id] || 0) - 1;
      if (next <= 0) {
        const {[id]: _removed, ...rest} = current;
        return rest;
      }
      return {...current, [id]: next};
    });

  const checkout = async () => {
    if (!lines.length || busy) return;
    setBusy(true);
    setMessage(null);

    try {
      const result = await apiSend<{sales: {id: string}[]; total: number}>('/api/sales', 'POST', {
        items: lines.map((line) => ({productId: line.product.id, qty: line.qty})),
        paymentMethod: payment
      });
      setLastSale(result.sales?.[0] ? {saleId: result.sales[0].id, total: result.total} : null);
      setReceiptId(null);
      setCart({});
      setMessage({kind: 'ok', text: `Eladás rögzítve · ${formatHuf(total)}`});
      playSfx('cash_close');
      refreshProducts();
      refreshShift();
    } catch (err) {
      setMessage({kind: 'error', text: (err as Error).message});
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  /** Receipts are issued per sale, after the fact — the register does not force one. */
  const issueReceipt = async () => {
    if (!lastSale) return;
    try {
      const result = await apiSend<{document: {id: string}}>('/api/receipts', 'POST', {saleId: lastSale.saleId});
      setReceiptId(result.document.id);
      setMessage({kind: 'ok', text: `Nyugta kiállítva · ${result.document.id}`});
      playSfx('success');
    } catch (err) {
      setMessage({kind: 'error', text: (err as Error).message});
      playSfx('error');
    }
  };

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / KASSZA</div>
        <NeonHeading as="h1" size={2} className="mb-8 mt-3.5">
          A <em>kassza.</em>
        </NeonHeading>

        {!shiftOpen && (
          <div className="mb-6 border border-[#35151c] bg-[rgba(213,31,60,0.08)] p-6">
            <strong className="block text-[12px] text-white">Nincs nyitott műszak.</strong>
            <p className="mt-2 text-[11px] text-[#8d8584]">Eladás előtt nyisd meg a műszakot.</p>
            <div className="mt-4">
              <BtnLink to="/staff/shift" variant="red">
                MŰSZAK ↗
              </BtnLink>
            </div>
          </div>
        )}

        {message && (
          <p className={`mb-6 text-[11px] ${message.kind === 'ok' ? 'text-emerald-400' : 'text-[color:var(--rm-red)]'}`}>
            {message.text}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          {/* Product grid */}
          <div className="lg:col-span-2">
            <label className="relative mb-3.5 flex items-center">
              <Search size={14} className="absolute left-4 text-[#6d5d64]"/>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="TERMÉK KERESÉSE…"
                className="w-full border border-[color:var(--rm-line)] bg-black/50 py-3 pl-10 pr-4 text-[10px] tracking-[0.15em] text-white outline-none focus:border-[color:var(--rm-red)]"
              />
            </label>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {visible.map((product) => {
                const low = product.stock <= product.minStock;
                const out = product.stock <= 0;
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={out || !shiftOpen}
                    onClick={() => add(product)}
                    className={`rm-card flex flex-col p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                      cart[product.id] ? 'border-[color:var(--rm-red)]' : ''
                    }`}
                  >
                    <div className="relative mb-3 flex h-20 items-center justify-center">
                      {product.image ? (
                        <img
                          src={assetUrl(product.image)}
                          alt=""
                          loading="lazy"
                          className="max-h-20 object-contain"
                        />
                      ) : (
                        <span className="font-heading text-2xl text-[rgba(213,31,60,0.6)]">月</span>
                      )}
                      {cart[product.id] && (
                        <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[color:var(--rm-red)] text-[10px] font-bold text-white">
                          {cart[product.id]}
                        </span>
                      )}
                    </div>
                    <strong className="line-clamp-2 text-[11px] leading-tight text-white">{product.name}</strong>
                    <span className="mt-1 text-[9px] text-[#777]">{sectionLabel(product.section)}</span>
                    <span className="mt-2 font-heading text-[14px] text-[color:var(--rm-red)]">
                      {formatHuf(product.price)}
                    </span>
                    <span className={`mt-1 text-[9px] ${low ? 'text-[color:var(--rm-red)]' : 'text-[#777]'}`}>
                      {out ? 'ELFOGYOTT' : `${product.stock} db`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cart */}
          <div className="rm-card flex h-fit flex-col p-0 lg:sticky lg:top-[84px]">
            <div className="flex items-center justify-between border-b border-[color:var(--rm-line)] px-6 py-4">
              <span className="rm-label">KOSÁR</span>
              <ShoppingCart size={13} className="text-[#777]"/>
            </div>

            <div className="max-h-[320px] overflow-y-auto">
              {!lines.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">A kosár üres.</p>}
              {lines.map((line) => (
                <div key={line.product.id} className="flex items-center gap-2 border-b border-white/[0.04] px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[11px] text-white">{line.product.name}</strong>
                    <span className="text-[9px] text-[#777]">{formatHuf(line.product.price * line.qty)}</span>
                  </div>
                  <button type="button" onClick={() => sub(line.product.id)} aria-label="Kevesebb" className="text-[#777] hover:text-white">
                    <Minus size={12}/>
                  </button>
                  <span className="w-5 text-center text-[11px] tabular-nums text-white">{line.qty}</span>
                  <button type="button" onClick={() => add(line.product)} aria-label="Több" className="text-[#777] hover:text-white">
                    <Plus size={12}/>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCart((current) => {
                      const {[line.product.id]: _removed, ...rest} = current;
                      return rest;
                    })}
                    aria-label="Törlés"
                    className="text-[#777] hover:text-[color:var(--rm-red)]"
                  >
                    <Trash2 size={12}/>
                  </button>
                </div>
              ))}
            </div>

            <div className="border-t border-[color:var(--rm-line)] p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[9px] tracking-[0.2em] text-[#777]">VÉGÖSSZEG</span>
                <strong className="font-heading text-[24px] text-white">{formatHuf(total)}</strong>
              </div>

              <div className="mb-4 flex gap-2">
                {([
                  {id: 'cash' as const, label: 'KÉSZPÉNZ', icon: Banknote},
                  {id: 'transfer' as const, label: 'ÁTUTALÁS', icon: CreditCard}
                ]).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPayment(option.id)}
                    aria-pressed={payment === option.id}
                    className={`flex flex-1 items-center justify-center gap-2 border px-3 py-2.5 text-[9px] font-bold tracking-[0.15em] transition-all ${
                      payment === option.id
                        ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.12)] text-white'
                        : 'border-white/10 text-[#8f8887] hover:border-white/30'
                    }`}
                  >
                    <option.icon size={12}/> {option.label}
                  </button>
                ))}
              </div>

              <Btn
                variant="red"
                onClick={checkout}
                disabled={!lines.length || busy || !shiftOpen}
                className="w-full justify-center"
              >
                {busy ? 'RÖGZÍTÉS…' : 'ELADÁS RÖGZÍTÉSE'}
              </Btn>

              {lastSale && (
                <Btn
                  onClick={issueReceipt}
                  disabled={!!receiptId}
                  className="mt-3 w-full justify-center"
                >
                  <ReceiptText size={13}/> {receiptId ? `NYUGTA: ${receiptId}` : 'NYUGTA KIÁLLÍTÁSA'}
                </Btn>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
