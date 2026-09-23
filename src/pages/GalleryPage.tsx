import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Expand} from 'lucide-react';
import {SectionHead} from '../components/ui/SectionHead';
import {NeonHeading} from '../components/ui/NeonHeading';
import {BtnLink} from '../components/ui/Btn';
import {Magnetic} from '../components/ui/Magnetic';
import {Reveal} from '../components/ui/Reveal';
import {SplitReveal} from '../components/ui/SplitReveal';
import {CountUp} from '../components/ui/CountUp';
import {Skeleton} from '../components/ui/Skeleton';
import {Embers} from '../components/effects/Embers';
import {Lightbox} from '../components/ui/Lightbox';
import {useLiveData} from '../hooks/useLiveData';
import {useParallax} from '../hooks/useParallax';
import {assetUrl} from '../lib/api';
import {backgroundImage} from '../lib/media';
import {columnsFor, layoutGallery} from '../lib/galleryLayout';
import type {GalleryItem, GalleryTag} from '../types';

const TAG_LABEL: Record<GalleryTag, string> = {
  ter: 'A TÉR',
  este: 'AZ ESTE',
  jel: 'A JEL'
};

const TAGS = Object.keys(TAG_LABEL) as GalleryTag[];

/**
 * The gallery, as the owner curates it in the console. The wall lays itself
 * out from the number of pictures and their proportions; nothing is
 * hard-coded any more.
 */
export const GalleryPage: React.FC = () => {
  const backdropRef = useParallax<HTMLDivElement>(75);
  const {data, loading} = useLiveData<{items: GalleryItem[]}>('/api/public/gallery', {intervalMs: 120000, topics: ['content']});
  const [filter, setFilter] = useState<GalleryTag | 'all'>('all');
  const [active, setActive] = useState<number | null>(null);

  const items = useMemo(() => data?.items || [], [data]);
  const visible = useMemo(() => (filter === 'all' ? items : items.filter((item) => item.tag === filter)), [items, filter]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {all: items.length};
    for (const tag of TAGS) result[tag] = items.filter((item) => item.tag === tag).length;
    return result;
  }, [items]);

  const lightboxItems = useMemo(() => visible.map((item) => ({src: assetUrl(item.src), title: item.title, caption: item.caption})), [visible]);

  // The wall packs itself for the width it has (see lib/galleryLayout).
  const wallRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const node = wallRef.current;
    if (!node) return;
    const measure = () => setCols(columnsFor(node.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const placements = useMemo(() => layoutGallery(visible, cols), [visible, cols]);

  return (
    <main>
      {/* HERO */}
      <section className="relative flex min-h-[560px] items-end overflow-hidden border-b border-[color:var(--rm-line)] px-[8vw] pb-16 pt-[170px]">
        <div ref={backdropRef} style={backgroundImage(items[0]?.src || '/assets/red-moon-cinematic-v27.webp')} className="pointer-events-none absolute inset-x-0 -top-24 bottom-[-90px] bg-cover bg-center opacity-[0.34]" aria-hidden="true"/>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(5,3,4,0.96),rgba(5,3,4,0.45))]" aria-hidden="true"/>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(0deg,var(--rm-bg),transparent)]" aria-hidden="true"/>
        <Embers density={34}/>

        <div className="relative z-[2]">
          <div className="rm-label">RED MOON / 06</div>
          <h1 className="rm-heading rm-display-1 my-5">
            <SplitReveal text="THE"/>
            <br/>
            <em>
              <SplitReveal text="archive." delay={190}/>
            </em>
          </h1>
          <p className="max-w-[540px] text-sm leading-[1.9] text-[#aaa]">A Red Moon pillanatai — tegnap, ma és a következő este.</p>

          <div className="mt-9 flex flex-wrap items-end gap-x-12 gap-y-6">
            <div>
              <strong className="block font-heading text-[38px] leading-none text-white">
                <CountUp to={items.length}/>
              </strong>
              <span className="mt-2 block text-[8px] tracking-[0.22em] text-[#777]">FELVÉTEL</span>
            </div>
            <Magnetic>
              <BtnLink to="/events" variant="red">
                A KÖVETKEZŐ ESTE <span>↗</span>
              </BtnLink>
            </Magnetic>
          </div>
        </div>
      </section>

      <section className="rm-section">
        <SectionHead
          label="01 / A GYŰJTEMÉNY"
          title={
            <>
              Pillanatok a
              <br/>
              <em>vörös hold alatt.</em>
            </>
          }
          aside="Kattints bármelyik képre a teljes méretű nézethez. Nyilakkal lapozhatsz."
        />

        <div className="mb-10 flex flex-wrap gap-2">
          {(['all', ...TAGS] as const).map((tag) => {
            const isActive = filter === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setFilter(tag);
                  setActive(null);
                }}
                aria-pressed={isActive}
                className={`rm-chip${isActive ? ' is-active' : ''}`}
              >
                {tag === 'all' ? 'MIND' : TAG_LABEL[tag]}
                <span className="rm-chip-count">{counts[tag]}</span>
              </button>
            );
          })}
        </div>

        {loading && (
          <div className="rm-gallery-grid">
            <Skeleton className="h-full" count={6}/>
          </div>
        )}

        {!loading && !visible.length && <p className="text-[11px] text-[#8d8584]">A gyűjtemény hamarosan bővül.</p>}

        <div ref={wallRef} className="rm-gallery-grid" style={{gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`}}>
          {visible.map((item, index) => (
            <Reveal
              key={item.id}
              delay={Math.min(index, 8) * 60}
              className="rm-gallery-item h-full"
              style={{gridColumn: `${placements[index].col + 1} / span ${placements[index].w}`, gridRow: `${placements[index].row + 1} / span ${placements[index].h}`}}
            >
              <button type="button" onClick={() => setActive(index)} className="rm-gallery-tile group">
                <img src={assetUrl(item.src)} alt={item.title} loading="lazy" decoding="async"/>
                <div className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/25 to-transparent" aria-hidden="true"/>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(227,40,78,0.3),transparent_65%)] opacity-0 transition-opacity duration-700 group-hover:opacity-100" aria-hidden="true"/>

                <span className="absolute left-5 top-5 border border-white/15 bg-black/50 px-2.5 py-1 text-[7px] font-bold tracking-[0.2em] text-[#ddd] backdrop-blur-sm">{TAG_LABEL[item.tag]}</span>

                <div className="absolute inset-x-0 bottom-0 p-5">
                  <div className="flex items-end justify-between gap-3">
                    <span className="text-[8px] font-bold tracking-[0.2em] text-[#ddd]">
                      {String(index + 1).padStart(2, '0')} · {item.title}
                    </span>
                    <Expand size={15} className="shrink-0 text-rm-red opacity-0 transition-opacity duration-300 group-hover:opacity-100"/>
                  </div>
                  {item.caption && (
                    <p className="mt-0 max-h-0 overflow-hidden text-[10px] leading-[1.7] text-[#c9c2c1] opacity-0 transition-all duration-500 group-hover:mt-2.5 group-hover:max-h-24 group-hover:opacity-100">{item.caption}</p>
                  )}
                </div>
              </button>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-t border-[color:var(--rm-line)] bg-[#070709]">
        <div className="rm-section">
          <SectionHead
            label="02 / ÉLŐ ARCHÍVUM"
            title={
              <>
                Ma este a
                <br/>
                <em>Red Moonban.</em>
              </>
            }
          />

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
            <article className="relative min-h-[250px] overflow-hidden border border-[#35151c] bg-gradient-to-br from-[#16070b] to-[#09090b] p-9 lg:col-span-2">
              <span className="rm-glyph">月</span>
              <span className="rm-label relative z-[1]">ÉLŐ ARCHÍVUM</span>
              <NeonHeading as="h3" className="relative z-[1] mt-3">
                Ma este a <em>Red Moonban.</em>
              </NeonHeading>
              <p className="relative z-[1] mt-4 max-w-lg text-[11px] leading-[1.8] text-[#8d8584]">
                Pillanatok a Red Moonból: fények, társaság, zene és azok az esték, amelyekhez jó visszatérni. Az archívum minden rendezvény után bővül.
              </p>
              <div className="relative z-[1] mt-8">
                <BtnLink to="/events" variant="red">
                  RENDEZVÉNYEK ↗
                </BtnLink>
              </div>
            </article>

            <article className="rm-card min-h-[250px] p-9">
              <span className="rm-label">KÖVETKEZŐ</span>
              <NeonHeading as="h3" className="mt-3">
                Neonéjszakák.
              </NeonHeading>
              <p className="mt-4 text-[11px] leading-[1.8] text-[#8d8584]">Fekete és vörös. Neonfények. Zene. SeeCity naplemente után.</p>
              <div className="mt-8">
                <BtnLink to="/club">RED MOON CLUB ↗</BtnLink>
              </div>
            </article>
          </div>
        </div>
      </section>

      <Lightbox items={lightboxItems} index={active} onClose={() => setActive(null)} onNavigate={setActive}/>
    </main>
  );
};
