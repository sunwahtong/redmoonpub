import React, {useMemo, useState} from 'react';
import {Search, X} from 'lucide-react';
import {SectionHead} from '../components/ui/SectionHead';
import {Reveal} from '../components/ui/Reveal';
import {EmptyState} from '../components/ui/EmptyState';
import {Btn, BtnLink} from '../components/ui/Btn';
import {Skeleton} from '../components/ui/Skeleton';
import {SplitReveal} from '../components/ui/SplitReveal';
import {TiltCard} from '../components/ui/TiltCard';
import {Magnetic} from '../components/ui/Magnetic';
import {CountUp} from '../components/ui/CountUp';
import {Embers} from '../components/effects/Embers';
import {DrinkCard} from '../components/menu/DrinkCard';
import {useLiveData} from '../hooks/useLiveData';
import {useParallax} from '../hooks/useParallax';
import {assetUrl, formatHuf} from '../lib/api';
import {SECTION_ORDER, SECTION_LABELS} from '../lib/sections';
import type {DrinkSection, PublicProduct, SignatureDrink} from '../types';

type Filter = DrinkSection | 'all';

/** Strips accents so "sornyito" also matches "Sörnyitó". */
const normalize = (value: string): string =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const MenuPage: React.FC = () => {
  const {data, error, loading} = useLiveData<{products: PublicProduct[]}>('/api/public-products');
  const {data: signatureData} = useLiveData<{drinks: SignatureDrink[]}>('/api/public-signature-drinks');

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const products = useMemo(() => data?.products || [], [data]);
  const signature = signatureData?.drinks || [];

  const counts = useMemo(() => {
    const result: Record<string, number> = {all: products.length};
    for (const section of SECTION_ORDER) result[section] = 0;
    for (const product of products) {
      const key = SECTION_ORDER.includes(product.section) ? product.section : 'other';
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  }, [products]);

  /** Only offer a filter chip for sections that actually hold something. */
  const availableSections = SECTION_ORDER.filter((section) => counts[section] > 0);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return products.filter((product) => {
      if (filter !== 'all' && product.section !== filter) return false;
      if (!needle) return true;
      return normalize(`${product.name} ${product.subtitle || ''}`).includes(needle);
    });
  }, [products, filter, query]);

  const backdropRef = useParallax<HTMLDivElement>(80);

  /* Price band, shown in the hero. Reads as a promise about the bar rather
     than as a number nobody asked for. */
  const priceRange = useMemo(() => {
    if (!products.length) return null;
    const prices = products.map((product) => Number(product.price) || 0).filter(Boolean);
    if (!prices.length) return null;
    return {from: Math.min(...prices), to: Math.max(...prices)};
  }, [products]);

  return (
    <main>
      {/* HERO */}
      <section className="relative flex min-h-[560px] items-end overflow-hidden border-b border-[color:var(--rm-line)] px-[8vw] pb-16 pt-[170px]">
        <div
          ref={backdropRef}
          className="pointer-events-none absolute inset-x-0 -top-24 bottom-[-90px] bg-[url('/assets/red-moon-cinematic-v27.webp')] bg-cover bg-center opacity-40"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(5,3,4,0.97),rgba(5,3,4,0.5))]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(0deg,var(--rm-bg),transparent)]"
          aria-hidden="true"
        />
        <Embers density={36}/>

        <div className="relative z-[2] w-full">
          <div className="rm-label">RED MOON / 02 · SEE CITY</div>

          <h1 className="rm-heading rm-display-1 my-5">
            <SplitReveal text="ITAL"/>
            <br/>
            <em>
              <SplitReveal text="lap." delay={200}/>
            </em>
          </h1>

          <p className="max-w-[560px] text-sm leading-[1.9] text-[#aaa]">
            Gondosan válogatott italok, kifinomult részletek és egy éjszaka, amelynek saját ritmusa van.
          </p>

          <div className="mt-9 flex flex-wrap items-end gap-x-12 gap-y-6">
            <div>
              <strong className="block font-heading text-[38px] leading-none text-white">
                <CountUp to={products.length}/>
              </strong>
              <span className="mt-2 block text-[8px] tracking-[0.22em] text-[#777]">VÁLOGATOTT TÉTEL</span>
            </div>
            {priceRange && (
              <div>
                <strong className="block font-heading text-[38px] leading-none text-white">
                  {formatHuf(priceRange.from)}
                  <span className="mx-2 text-[color:var(--rm-red)]">—</span>
                  {formatHuf(priceRange.to)}
                </strong>
                <span className="mt-2 block text-[8px] tracking-[0.22em] text-[#777]">ÁRSÁV</span>
              </div>
            )}
            <Magnetic>
              <BtnLink to="/reservations" variant="red">
                ASZTALT FOGLALOK <span>↗</span>
              </BtnLink>
            </Magnetic>
          </div>
        </div>
      </section>

      {/* Sticky filter rail — the list is long, so the controls travel with it. */}
      <div className="rm-rail">
        <div className="flex flex-col gap-3 px-[8vw] py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {(['all', ...availableSections] as Filter[]).map((section) => {
              const active = filter === section;
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => setFilter(section)}
                  aria-pressed={active}
                  className={`border px-4 py-2.5 text-[9px] font-bold tracking-[0.2em] transition-all ${
                    active
                      ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.14)] text-white shadow-[0_0_22px_rgba(213,31,60,0.22)]'
                      : 'border-[color:var(--rm-line)] text-[#8f8887] hover:border-white/25 hover:text-white'
                  }`}
                >
                  {section === 'all' ? 'ÖSSZES' : SECTION_LABELS[section]}
                  <span className="ml-2 text-[8px] text-[#6d5d64]">{counts[section] ?? 0}</span>
                </button>
              );
            })}
          </div>

          <label className="relative flex w-full items-center lg:w-72">
            <Search size={14} className="absolute left-4 text-[#6d5d64]"/>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="KERESÉS AZ ITALLAPON…"
              className="w-full border border-[color:var(--rm-line)] bg-black/50 py-3 pl-10 pr-10 text-[10px] tracking-[0.15em] text-white outline-none transition-colors placeholder:text-[#6d5d64] focus:border-[color:var(--rm-red)]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Keresés törlése"
                className="absolute right-4 text-[#6d5d64] transition-colors hover:text-white"
              >
                <X size={14}/>
              </button>
            )}
          </label>
        </div>
      </div>

      <section className="rm-section">
        <SectionHead
          label={`A BÁR / ${products.length || '—'} VÁLOGATOTT TÉTEL`}
          title={
            <>
              Az este <em>íze.</em>
            </>
          }
          aside="Válogatásunk az este karakteréhez készült: klasszikus tételek, prémium palackok és Red Moon kedvencek egy helyen."
        />

        {/* Grid */}
        {loading && (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <Skeleton className="h-[430px]" count={8}/>
          </div>
        )}

        {!loading && error && (
          <EmptyState
            label="RED MOON / ITALLAP"
            title="Az itallap most nem érhető el."
            description="A kapcsolat a bár rendszerével megszakadt. Néhány másodperc múlva automatikusan újra próbálkozunk."
          />
        )}

        {!loading && !error && visible.length === 0 && (
          <EmptyState
            label="RED MOON / ITALLAP"
            title="Nincs találat."
            description="Erre a keresésre most nem tudunk italt ajánlani. Próbáld másik névvel, vagy nézd meg a teljes listát."
            action={
              <Btn
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                TELJES ITALLAP ↗
              </Btn>
            }
          />
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((product, index) => (
              <Reveal key={product.id} delay={Math.min(index, 8) * 60} className="h-full">
                <DrinkCard product={product} index={index}/>
              </Reveal>
            ))}
          </div>
        )}
      </section>

      {/* Signature picks, curated by the owners from the staff console */}
      {signature.length > 0 && (
        <section className="border-t border-[color:var(--rm-line)] bg-[#070709]">
          <div className="rm-section">
            <SectionHead
              label="RED MOON VÁLOGATÁS"
              title={
                <>
                  Kiemelt <em>italaink.</em>
                </>
              }
              aside="A ház aktuális kedvencei — amit ma este a pult mögül ajánlunk."
            />

            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
              {signature.map((drink, index) => (
                <Reveal key={drink.id} delay={index * 90} className="h-full">
                  <TiltCard className="h-full" max={7}>
                    <article className="rm-card group h-full overflow-hidden bg-gradient-to-b from-[#16070b] to-[#09090b] p-7 text-left">
                      <span className="rm-glyph">月</span>
                      <div className="rm-tilt-layer relative z-[1] text-[8px] tracking-[0.2em] text-[#777]">
                        0{drink.slot} / SIGNATURE
                      </div>

                      <div className="rm-tilt-layer relative my-6 flex h-44 items-center justify-center">
                        <div
                          className="absolute h-28 w-28 rounded-full bg-[rgba(213,31,60,0.28)] blur-2xl transition-transform duration-500 group-hover:scale-125"
                          aria-hidden="true"
                        />
                        {drink.image ? (
                          <img
                            src={assetUrl(drink.image)}
                            alt={drink.name}
                            loading="lazy"
                            className="z-10 max-h-40 object-contain drop-shadow-[0_12px_20px_rgba(0,0,0,0.6)] transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <span className="z-10 font-heading text-5xl text-[rgba(213,31,60,0.7)]">月</span>
                        )}
                      </div>

                      <div className="rm-tilt-layer relative z-[1]">
                        <span className="text-[8px] tracking-[0.2em] text-[color:var(--rm-red)]">RED MOON SELECTION</span>
                        <h3 className="mb-2 mt-2 font-heading text-[24px] leading-tight text-white">{drink.name}</h3>
                        <p className="text-[11px] leading-[1.7] text-[#938b8b]">
                          {drink.description || 'A Red Moon aktuális signature választása.'}
                        </p>
                      </div>
                    </article>
                  </TiltCard>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
};
