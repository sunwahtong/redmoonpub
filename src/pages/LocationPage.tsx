import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Compass, Link2, MapPin, Moon, Navigation} from 'lucide-react';
import {NeonHeading} from '../components/ui/NeonHeading';
import {BtnLink} from '../components/ui/Btn';
import {Reveal} from '../components/ui/Reveal';
import {GtaMap, type Blip} from '../components/location/GtaMap';
import {useLiveData} from '../hooks/useLiveData';
import {BLIP_GROUP_LABEL, BLIP_GROUPS, BLIP_KINDS, BLIP_STYLES, blipDistance, blipStyle} from '../lib/blips';
import {playSfx} from '../lib/sfx';
import {toast} from '../stores/useToastStore';

const FACTS = [
  {
    icon: MapPin,
    label: 'A HELY',
    title: 'See City belváros',
    description: 'A Red Moon fix pont a térképen — a vörös holdat keresd. Egy koppintás a jelölőn, és a térkép odavisz.'
  },
  {
    icon: Moon,
    label: 'NYITVA',
    title: 'Naplemente után',
    description: 'Az este a miénk. Amíg ég a vörös hold, a pult nyitva — a pontos állapotot a jobb alsó sarokban látod.'
  },
  {
    icon: Compass,
    label: 'NAVIGÁCIÓ',
    title: 'Küldd tovább',
    description: 'Minden jelölőnek saját linkje van. Másold ki, dobd be a chatbe — a másik pontosan oda érkezik a térképen.'
  }
];

/**
 * The map page: SeeCity's atlas, the house's markers on it, the way to the
 * house spelled out, and what the markers mean.
 */
export const LocationPage: React.FC = () => {
  const {data, refresh} = useLiveData<{blips: Blip[]}>('/api/public-map-blips', {intervalMs: 60000, topics: ['content']});
  const blips = useMemo(() => data?.blips || [], [data]);
  const hq = useMemo(() => blips.find((blip) => blip.kind === 'hq') || null, [blips]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [focusId, setFocusId] = useState<string | null>(null);

  /* /location?blip=<id> flies straight to a marker, so a spot can be shared in chat. */
  useEffect(() => {
    const wanted = searchParams.get('blip');
    if (!wanted) return;
    setFocusId(wanted);
    searchParams.delete('blip');
    setSearchParams(searchParams, {replace: true});
  }, [searchParams, setSearchParams]);

  const focused = useCallback(() => setFocusId(null), []);

  /** What is closest to the house, for the "around us" list. */
  const nearby = useMemo(() => {
    if (!hq) return [];
    return blips
      .filter((blip) => blip.id !== hq.id)
      .map((blip) => ({blip, distance: blipDistance(blip, hq)}))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
  }, [blips, hq]);

  const kindsOnMap = BLIP_KINDS.filter((kind) => blips.some((blip) => blip.kind === kind));

  const copyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/location?blip=${encodeURIComponent(id)}`);
      toast.success('A link a vágólapon.');
      playSfx('ui_click');
    } catch {
      toast.error('Nem sikerült másolni');
    }
  };

  return (
    <main className="pt-[68px]">
      <section className="border-b border-[color:var(--rm-line)] bg-[#050304] px-[var(--rm-gutter)] py-14">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="text-left">
            <div className="rm-label">RED MOON / 04</div>
            <NeonHeading as="h1" size={2} className="my-4">
              THE <em>MAP</em>
            </NeonHeading>
            <p className="max-w-md text-[13px] leading-[1.8] text-[#9e9795]">
              SeeCity teljes atlasza, a Red Moon pontos helyével és mindennel, ami a ház körül számít. Húzd, görgesd, nagyíts — és koppints egy jelölőre, hogy megtudd, mi az.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5 text-[9px] tracking-[0.18em] text-[#777]">
            <span className="border border-[color:var(--rm-line)] px-4 py-2.5">{blips.length} JELÖLŐ</span>
            <span className="border border-[color:var(--rm-line)] px-4 py-2.5">{kindsOnMap.length} FÉLE HELY</span>
            <span className="border border-[color:var(--rm-line)] px-4 py-2.5">+ / − ZOOM</span>
          </div>
        </div>
      </section>

      <GtaMap blips={blips} refresh={refresh} focusId={focusId} onFocused={focused}/>

      {/* ------------------------------------------------ THE WAY HERE */}
      <section className="border-t border-[color:var(--rm-line)] bg-[#070709]">
        <div className="rm-section grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <Reveal className="lg:col-span-2">
            <article className="rm-card relative h-full overflow-hidden p-8">
              <span className="pointer-events-none absolute -right-4 -top-8 font-heading text-[160px] leading-none text-white/[0.03]" aria-hidden="true">
                月
              </span>
              <span className="rm-label">HOGYAN TALÁLSZ IDE</span>
              {hq ? (
                <>
                  <h2 className="mt-3 font-heading text-[30px] leading-tight text-white">{hq.label}</h2>
                  <p className="mt-3 max-w-xl text-[12px] leading-[1.85] text-[#9e9795]">{hq.description || 'A vörös hold a térképen. Ha látod, jó helyen jársz.'}</p>
                  <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[9px] tracking-[0.2em] text-[#777]">
                    <span>
                      X <b className="text-white">{Math.round(hq.x)}</b> · Y <b className="text-white">{Math.round(hq.y)}</b>
                    </span>
                    {hq.group && <span>{hq.group.toUpperCase()}</span>}
                  </div>
                  <div className="mt-7 flex flex-wrap gap-2.5">
                    <button type="button" onClick={() => setFocusId(hq.id)} className="rm-btn is-red">
                      <Navigation size={12}/> MUTASD A TÉRKÉPEN
                    </button>
                    <button type="button" onClick={() => copyLink(hq.id)} className="rm-btn">
                      <Link2 size={12}/> LINK MÁSOLÁSA
                    </button>
                    <BtnLink to="/reservations">ASZTALT FOGLALOK ↗</BtnLink>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="mt-3 font-heading text-[30px] leading-tight text-white">A vörös holdat keresd.</h2>
                  <p className="mt-3 max-w-xl text-[12px] leading-[1.85] text-[#9e9795]">{data ? 'A ház jelölője még nincs a térképen — a managerek hamarosan felteszik.' : 'A térkép jelölői töltődnek…'}</p>
                </>
              )}
            </article>
          </Reveal>

          <Reveal delay={90}>
            <article className="rm-card h-full p-7">
              <span className="rm-label">A KÖRNYÉK</span>
              <h3 className="mt-3 font-heading text-[20px] text-white">Ami a ház körül van.</h3>
              {nearby.length ? (
                <ul className="mt-4 flex flex-col">
                  {nearby.map(({blip}) => {
                    const style = blipStyle(blip.kind);
                    return (
                      <li key={blip.id}>
                        <button type="button" onClick={() => setFocusId(blip.id)} className="flex w-full items-center gap-3 border-b border-white/[0.05] py-2.5 text-left transition-colors hover:text-[color:var(--rm-red-bright)]">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px]" style={{background: style.color, color: '#0a0507'}} aria-hidden="true">
                            {style.glyph}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] text-white">{blip.label}</span>
                            <span className="block text-[8px] tracking-[0.15em] text-[#6f6968]">{style.label.toUpperCase()}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-[11px] leading-[1.7] text-[#8d8584]">{hq ? 'A ház körül még nincs más jelölő.' : 'Ha a ház fent van a térképen, itt látod, mi van a közelében.'}</p>
              )}
            </article>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------ LEGEND */}
      <section className="border-t border-[color:var(--rm-line)]">
        <div className="rm-section">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="rm-label">JELMAGYARÁZAT</span>
              <h2 className="mt-2 font-heading text-[26px] text-white">Mit jelentenek a jelölők.</h2>
            </div>
            <p className="max-w-sm text-[11px] leading-[1.7] text-[#8d8584]">A halványabbak még nincsenek a térképen. A ház managerei bővítik, ahogy a város változik.</p>
          </div>
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
            {BLIP_GROUPS.map((groupId, index) => (
              <Reveal key={groupId} delay={index * 80}>
                <div className="rm-card h-full p-6">
                  <span className="rm-label">{BLIP_GROUP_LABEL[groupId]}</span>
                  <ul className="mt-4 flex flex-col gap-3">
                    {BLIP_KINDS.filter((kind) => BLIP_STYLES[kind].group === groupId).map((kind) => {
                      const style = BLIP_STYLES[kind];
                      const onMap = kindsOnMap.includes(kind);
                      return (
                        <li key={kind} className={`flex items-start gap-3 ${onMap ? '' : 'opacity-45'}`}>
                          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px]" style={{background: style.color, color: '#0a0507'}} aria-hidden="true">
                            {style.glyph}
                          </span>
                          <span>
                            <span className="block text-[11px] text-white">{style.label}</span>
                            <span className="block text-[10px] leading-[1.6] text-[#8d8584]">{style.hint}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[color:var(--rm-line)] bg-[#070709]">
        <div className="rm-section grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {FACTS.map((fact, index) => (
            <Reveal key={fact.label} delay={index * 80}>
              <article className="rm-card h-full p-8 text-left">
                <fact.icon size={18} className="mb-5 text-[color:var(--rm-red)]"/>
                <span className="text-[8px] font-bold tracking-[0.25em] text-[#777]">{fact.label}</span>
                <h3 className="mt-2.5 font-heading text-[22px] text-white">{fact.title}</h3>
                <p className="mt-2.5 text-[11px] leading-[1.8] text-[#8d8584]">{fact.description}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>
    </main>
  );
};
