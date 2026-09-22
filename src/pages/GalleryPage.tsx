import React, {useMemo, useState} from 'react';
import {Expand} from 'lucide-react';
import {SectionHead} from '../components/ui/SectionHead';
import {NeonHeading} from '../components/ui/NeonHeading';
import {BtnLink} from '../components/ui/Btn';
import {Magnetic} from '../components/ui/Magnetic';
import {Reveal} from '../components/ui/Reveal';
import {SplitReveal} from '../components/ui/SplitReveal';
import {CountUp} from '../components/ui/CountUp';
import {Embers} from '../components/effects/Embers';
import {Lightbox, type LightboxItem} from '../components/ui/Lightbox';
import {useParallax} from '../hooks/useParallax';

type ShotTag = 'ter' | 'este' | 'jel';

interface Shot extends LightboxItem {
  no: string;
  tag: ShotTag;
  /** Extra grid span classes — the archive reads as a magazine spread. */
  span?: string;
}

const TAG_LABEL: Record<ShotTag, string> = {
  ter: 'A TÉR',
  este: 'AZ ESTE',
  jel: 'A JEL'
};

/**
 * The legacy gallery faked six photos with CSS gradients. These are the real
 * assets that ship with the project; the grid still keeps the 2×3 rhythm.
 */
const SHOTS: Shot[] = [
  {
    no: '01',
    tag: 'ter',
    title: 'A BÁR',
    caption: 'Vörös fények, sötét fa, és az este első pohara.',
    src: '/assets/red-moon-cinematic-v27.webp',
    span: 'md:col-span-2 md:row-span-2'
  },
  {
    no: '02',
    tag: 'este',
    title: 'THE CROWD',
    caption: 'Amikor a zene átveszi az irányítást.',
    src: '/assets/gallery/red-moon-dj-crowd.webp'
  },
  {
    no: '03',
    tag: 'jel',
    title: 'RED MOON',
    caption: 'A jel, ami alatt minden este kezdődik.',
    src: '/assets/red-moon-logo.png'
  },
  {
    no: '04',
    tag: 'este',
    title: 'AFTER DARK',
    caption: 'SeeCity naplemente után.',
    src: '/assets/red-moon-cinematic-v27',
    span: 'md:col-span-2'
  },
  {
    no: '05',
    tag: 'ter',
    title: 'SEE CITY',
    caption: 'A hely a térképen — a Red Moon koordinátái.',
    src: '/assets/red-moon-map-v8.png'
  },
  {
    no: '06',
    tag: 'jel',
    title: 'NEON NIGHT',
    caption: 'Fekete és vörös. Neonfények. Zene.',
    src: '/assets/red-moon-cinematic.png'
  }
];

const TAGS = Object.keys(TAG_LABEL) as ShotTag[];

export const GalleryPage: React.FC = () => {
  const backdropRef = useParallax<HTMLDivElement>(75);
  const [filter, setFilter] = useState<ShotTag | 'all'>('all');
  const [active, setActive] = useState<number | null>(null);

  const visible = useMemo(
    () => (filter === 'all' ? SHOTS : SHOTS.filter((shot) => shot.tag === filter)),
    [filter]
  );

  const counts = useMemo(() => {
    const result: Record<string, number> = {all: SHOTS.length};
    for (const tag of TAGS) result[tag] = SHOTS.filter((shot) => shot.tag === tag).length;
    return result;
  }, []);

  return (
    <main>
      {/* HERO */}
      <section className="relative flex min-h-[560px] items-end overflow-hidden border-b border-[color:var(--rm-line)] px-[8vw] pb-16 pt-[170px]">
        <div
          ref={backdropRef}
          className="pointer-events-none absolute inset-x-0 -top-24 bottom-[-90px] bg-[url('/assets/red-moon-cinematic-v27.webp')] bg-cover bg-center opacity-[0.34]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(5,3,4,0.96),rgba(5,3,4,0.45))]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(0deg,var(--rm-bg),transparent)]"
          aria-hidden="true"
        />
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
          <p className="max-w-[540px] text-sm leading-[1.9] text-[#aaa]">
            A Red Moon pillanatai — tegnap, ma és a következő este.
          </p>

          <div className="mt-9 flex flex-wrap items-end gap-x-12 gap-y-6">
            <div>
              <strong className="block font-heading text-[38px] leading-none text-white">
                <CountUp to={SHOTS.length}/>
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
                className={`border px-4 py-2.5 text-[9px] font-bold tracking-[0.2em] transition-all ${
                  isActive
                    ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.14)] text-white shadow-[0_0_22px_rgba(213,31,60,0.22)]'
                    : 'border-[color:var(--rm-line)] text-[#8f8887] hover:border-white/25 hover:text-white'
                }`}
              >
                {tag === 'all' ? 'MIND' : TAG_LABEL[tag]}
                <span className="ml-2 text-[8px] text-[#6d5d64]">{counts[tag]}</span>
              </button>
            );
          })}
        </div>

        <div className="grid auto-rows-[230px] grid-cols-1 gap-3 md:grid-cols-4">
          {visible.map((shot, index) => (
            <Reveal
              key={shot.no}
              delay={index * 70}
              /* Spans only apply to the full set: once filtered, a two-column
                 tile next to a single survivor leaves a hole in the grid. */
              className={`h-full ${filter === 'all' ? shot.span || '' : ''}`}
            >
              <button
                type="button"
                onClick={() => setActive(index)}
                className="group relative h-full w-full overflow-hidden border border-[color:var(--rm-line)] bg-[#09090b] text-left transition-all duration-500 hover:border-[rgba(213,31,60,0.55)] hover:shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
              >
                <img
                  src={shot.src}
                  alt={shot.title}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover opacity-65 transition-all duration-[900ms] ease-out group-hover:scale-[1.07] group-hover:opacity-100"
                />
                <div
                  className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/25 to-transparent"
                  aria-hidden="true"
                />

                {/* Ruby wash that arrives with the hover, so the still warms up
                    rather than only brightening. */}
                <div
                  className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(227,40,78,0.3),transparent_65%)] opacity-0 transition-opacity duration-700 group-hover:opacity-100"
                  aria-hidden="true"
                />

                <span className="absolute left-5 top-5 border border-white/15 bg-black/50 px-2.5 py-1 text-[7px] font-bold tracking-[0.2em] text-[#ddd] backdrop-blur-sm">
                  {TAG_LABEL[shot.tag]}
                </span>

                <div className="absolute inset-x-0 bottom-0 p-5">
                  <div className="flex items-end justify-between gap-3">
                    <span className="text-[8px] font-bold tracking-[0.2em] text-[#ddd]">
                      {shot.no} · {shot.title}
                    </span>
                    <Expand
                      size={15}
                      className="shrink-0 text-rm-red opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    />
                  </div>

                  {/* The caption stays out of the way until asked for. */}
                  <p className="mt-0 max-h-0 overflow-hidden text-[10px] leading-[1.7] text-[#c9c2c1] opacity-0 transition-all duration-500 group-hover:mt-2.5 group-hover:max-h-24 group-hover:opacity-100">
                    {shot.caption}
                  </p>
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
                Pillanatok a Red Moonból: fények, társaság, zene és azok az esték, amelyekhez jó visszatérni. Az
                archívum minden rendezvény után bővül.
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
              <p className="mt-4 text-[11px] leading-[1.8] text-[#8d8584]">
                Fekete és vörös. Neonfények. Zene. SeeCity naplemente után.
              </p>
              <div className="mt-8">
                <BtnLink to="/club">RED MOON CLUB ↗</BtnLink>
              </div>
            </article>
          </div>
        </div>
      </section>

      <Lightbox items={visible} index={active} onClose={() => setActive(null)} onNavigate={setActive}/>
    </main>
  );
};
