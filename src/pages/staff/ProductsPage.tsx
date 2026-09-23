import React, {useMemo, useState} from 'react';
import {Check, Eye, EyeOff, ImagePlus, PackagePlus, Pencil, Search, X} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn} from '../../components/ui/Btn';
import {Select} from '../../components/ui/Select';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatHuf} from '../../lib/api';
import {uploadMedia} from '../../lib/media';
import {playSfx} from '../../lib/sfx';
import {SECTION_LABELS, SECTION_ORDER, sectionLabel} from '../../lib/sections';
import {useAuthStore, roleAtLeast} from '../../stores/useAuthStore';
import type {DrinkSection} from '../../types';

interface Product {
  id: string;
  name: string;
  category: 'drink' | 'food';
  section: DrinkSection;
  price: number;
  stock: number;
  minStock: number;
  image: string;
  imagePublicId?: string;
  subtitle: string;
  active: boolean;
}

interface Draft {
  name: string;
  price: string;
  minStock: string;
  section: DrinkSection;
  subtitle: string;
}

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const ProductsPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const isOwner = roleAtLeast(user?.role, 'owner');

  const {data, refresh} = useLiveData<{products: Product[]}>('/api/products', {intervalMs: 30000});

  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{kind: 'ok' | 'error'; text: string} | null>(null);

  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newStock, setNewStock] = useState('0');
  const [newMinStock, setNewMinStock] = useState('5');
  const [newSection, setNewSection] = useState<DrinkSection>('beer');
  const [newCategory, setNewCategory] = useState<'drink' | 'food'>('drink');
  const [newImage, setNewImage] = useState('');
  const [newImagePublicId, setNewImagePublicId] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);

  /** A picture for a product: uploaded to the media library, stored by URL. */
  const pickImage = async (event: React.ChangeEvent<HTMLInputElement>, productId: string | null) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(productId || 'new');
    try {
      const media = await uploadMedia('image', 'product', file);
      if (productId) await apiSend(`/api/products/${productId}`, 'PATCH', {image: media.url, imagePublicId: media.publicId});
      else {
        setNewImage(media.url);
        setNewImagePublicId(media.publicId);
      }
      setMessage({kind: 'ok', text: 'Kép feltöltve.'});
      playSfx('success');
      refresh();
    } catch (err) {
      setMessage({kind: 'error', text: (err as Error).message});
      playSfx('error');
    } finally {
      setUploading(null);
      event.target.value = '';
    }
  };

  const products = useMemo(() => data?.products || [], [data]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return products;
    return products.filter((product) => normalize(product.name).includes(needle));
  }, [products, query]);

  const run = async (action: () => Promise<unknown>, okText: string) => {
    setMessage(null);
    try {
      await action();
      setMessage({kind: 'ok', text: okText});
      playSfx('success');
      refresh();
    } catch (err) {
      setMessage({kind: 'error', text: (err as Error).message});
      playSfx('error');
    }
  };

  const startEdit = (product: Product) => {
    setEditingId(product.id);
    setDraft({
      name: product.name,
      price: String(product.price),
      minStock: String(product.minStock),
      section: product.section,
      subtitle: product.subtitle || ''
    });
  };

  const saveEdit = (product: Product) => {
    if (!draft) return;
    const patch: Record<string, unknown> = {
      name: draft.name,
      minStock: Number(draft.minStock),
      section: draft.section
    };
    // Price and subtitle are owner-only on the server. Sending either as a
    // manager returns 403 and loses the rest of the edit, so only include them
    // when allowed and actually changed.
    if (isOwner && Number(draft.price) !== product.price) patch.price = Number(draft.price);
    if (isOwner && draft.subtitle !== (product.subtitle || '')) patch.subtitle = draft.subtitle;

    run(async () => {
      await apiSend(`/api/products/${product.id}`, 'PATCH', patch);
      setEditingId(null);
      setDraft(null);
    }, `${draft.name} mentve.`);
  };

  const toggleActive = (product: Product) =>
    run(
      () => apiSend(`/api/products/${product.id}`, 'PATCH', {active: !product.active}),
      `${product.name}: ${product.active ? 'inaktív' : 'aktív'}.`
    );

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    run(async () => {
      await apiSend('/api/products', 'POST', {
        name: newName,
        category: newCategory,
        section: newSection,
        price: Number(newPrice),
        stock: Number(newStock),
        minStock: Number(newMinStock),
        image: newImage,
        imagePublicId: newImagePublicId
      });
      setNewName('');
      setNewPrice('');
      setNewStock('0');
      setNewMinStock('5');
      setNewImage('');
      setNewImagePublicId('');
    }, 'Termék létrehozva.');
  };

  const field =
    'w-full border border-white/10 bg-black/50 p-2.5 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]';

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / TERMÉKEK</div>
        <NeonHeading as="h1" size={2} className="mb-8 mt-3.5">
          Az <em>itallap mögött.</em>
        </NeonHeading>

        {message && (
          <p className={`mb-6 text-[11px] ${message.kind === 'ok' ? 'text-emerald-400' : 'text-[color:var(--rm-red)]'}`}>
            {message.text}
          </p>
        )}

        {!isOwner && (
          <p className="mb-6 border border-[#35151c] bg-[rgba(213,31,60,0.08)] p-4 text-[11px] text-[#8d8584]">
            Az eladási árat és a termék alcímét csak tulajdonos módosíthatja.
          </p>
        )}

        <label className="relative mb-6 flex w-full items-center sm:max-w-xs">
          <Search size={14} className="absolute left-4 text-[#6d5d64]"/>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="TERMÉK KERESÉSE…"
            className="w-full border border-[color:var(--rm-line)] bg-black/50 py-3 pl-10 pr-4 text-[10px] tracking-[0.15em] text-white outline-none focus:border-[color:var(--rm-red)]"
          />
        </label>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <div className="rm-card p-0 lg:col-span-2">
            <div className="border-b border-[color:var(--rm-line)] px-6 py-4">
              <span className="rm-label">TERMÉKEK ({visible.length})</span>
            </div>

            <div className="max-h-[560px] overflow-y-auto">
              {visible.map((product) => {
                const editing = editingId === product.id;
                return (
                  <div
                    key={product.id}
                    className={`border-b border-white/[0.04] px-6 py-3 ${product.active ? '' : 'opacity-50'}`}
                  >
                    {editing && draft ? (
                      <div className="flex flex-col gap-2">
                        <input
                          value={draft.name}
                          onChange={(event) => setDraft({...draft, name: event.target.value})}
                          className={field}
                        />
                        <div className="flex flex-wrap gap-2">
                          <input
                            type="number"
                            min={0}
                            value={draft.price}
                            disabled={!isOwner}
                            onChange={(event) => setDraft({...draft, price: event.target.value})}
                            placeholder="ár"
                            className={`${field} max-w-[110px] disabled:opacity-40`}
                          />
                          <input
                            type="number"
                            min={0}
                            value={draft.minStock}
                            onChange={(event) => setDraft({...draft, minStock: event.target.value})}
                            placeholder="min. készlet"
                            className={`${field} max-w-[120px]`}
                          />
                          <Select
                            value={draft.section}
                            options={SECTION_ORDER.map((section) => ({value: section, label: SECTION_LABELS[section]}))}
                            onChange={(value) => setDraft({...draft, section: value})}
                            className="max-w-[190px]"
                            size="sm"
                            aria-label="Szekció"
                          />
                        </div>
                        <input
                          value={draft.subtitle}
                          disabled={!isOwner}
                          onChange={(event) => setDraft({...draft, subtitle: event.target.value})}
                          placeholder="alcím"
                          className={`${field} disabled:opacity-40`}
                        />
                        <div className="flex gap-2">
                          <Btn variant="red" onClick={() => saveEdit(product)}>
                            <Check size={12}/> MENTÉS
                          </Btn>
                          <Btn
                            onClick={() => {
                              setEditingId(null);
                              setDraft(null);
                            }}
                          >
                            <X size={12}/> MÉGSE
                          </Btn>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <strong className="block truncate text-[11px] text-white">{product.name}</strong>
                          <span className="text-[9px] text-[#777]">
                            {sectionLabel(product.section)} · {product.stock} db · min. {product.minStock}
                          </span>
                        </div>
                        <span className="shrink-0 font-heading text-[14px] text-[color:var(--rm-red)]">
                          {formatHuf(product.price)}
                        </span>
                        <label className="cursor-pointer text-[#777] transition-colors hover:text-white" aria-label="Kép feltöltése" title="Kép feltöltése">
                          <input type="file" accept="image/*" onChange={(event) => pickImage(event, product.id)} className="hidden" disabled={uploading === product.id}/>
                          <ImagePlus size={12}/>
                        </label>
                        <button
                          type="button"
                          onClick={() => startEdit(product)}
                          aria-label="Szerkesztés"
                          className="text-[#777] transition-colors hover:text-white"
                        >
                          <Pencil size={12}/>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(product)}
                          aria-label={product.active ? 'Inaktiválás' : 'Aktiválás'}
                          className="text-[#777] transition-colors hover:text-[color:var(--rm-red)]"
                        >
                          {product.active ? <Eye size={13}/> : <EyeOff size={13}/>}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <form onSubmit={create} className="rm-card flex h-fit flex-col gap-3 p-7">
            <span className="rm-label">ÚJ TERMÉK</span>
            <h2 className="mb-1 font-heading text-[20px] text-white">Felvétel</h2>

            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Név"
              required
              className={field}
            />

            <div className="grid grid-cols-2 gap-2">
              <Select
                value={newCategory}
                options={[
                  {value: 'drink' as const, label: 'Ital', glyph: '酒'},
                  {value: 'food' as const, label: 'Étel', glyph: '食'}
                ]}
                onChange={setNewCategory}
                aria-label="Kategória"
              />
              <Select
                value={newSection}
                options={SECTION_ORDER.map((section) => ({value: section, label: SECTION_LABELS[section]}))}
                onChange={setNewSection}
                aria-label="Szekció"
              />
            </div>

            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={newPrice}
                onChange={(event) => setNewPrice(event.target.value)}
                placeholder="Ár"
                required
                className={field}
              />
              <input
                type="number"
                min={0}
                value={newStock}
                onChange={(event) => setNewStock(event.target.value)}
                placeholder="Készlet"
                className={field}
              />
              <input
                type="number"
                min={0}
                value={newMinStock}
                onChange={(event) => setNewMinStock(event.target.value)}
                placeholder="Min."
                className={field}
              />
            </div>

            <div className="flex gap-2">
              <input
                value={newImage}
                onChange={(event) => {
                  setNewImage(event.target.value);
                  setNewImagePublicId('');
                }}
                placeholder="assets/menu/drinks/kep.png"
                className={field}
              />
              <label className="rm-btn is-ghost !px-3 !py-2 !text-[8px] cursor-pointer">
                <input type="file" accept="image/*" onChange={(event) => pickImage(event, null)} className="hidden" disabled={uploading === 'new'}/>
                <ImagePlus size={12}/> {uploading === 'new' ? '…' : 'KÉP'}
              </label>
            </div>

            <Btn type="submit" variant="red" className="mt-2 justify-center">
              <PackagePlus size={13}/> LÉTREHOZÁS
            </Btn>
          </form>
        </div>
      </section>
    </main>
  );
};
