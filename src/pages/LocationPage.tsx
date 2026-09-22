import React from 'react';
import {Compass, MapPin, Moon} from 'lucide-react';
import {NeonHeading} from '../components/ui/NeonHeading';
import {GtaMap} from '../components/location/GtaMap';

const FACTS = [
  {
    icon: MapPin,
    label: 'A HELY',
    title: 'See City belváros',
    description: 'A Red Moon Pub fix helyszín a térképen — keresd a vörös jelölőt.'
  },
  {
    icon: Moon,
    label: 'NYITVA',
    title: 'Naplemente után',
    description: 'Az este a miénk. Amíg ég a vörös hold, a pult nyitva van.'
  },
  {
    icon: Compass,
    label: 'NAVIGÁCIÓ',
    title: 'Jelölj meg minket',
    description: 'Nagyíts rá a jelölőre, és indulj el — innen már nem tévedsz el.'
  }
];

export const LocationPage: React.FC = () => (
  <main className="pt-[68px]">
    <section className="border-b border-[color:var(--rm-line)] bg-[#050304] px-[var(--rm-gutter)] py-14">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="text-left">
          <div className="rm-label">RED MOON / 04</div>
          <NeonHeading as="h1" size={2} className="my-4">
            THE <em>MAP</em>
          </NeonHeading>
          <p className="max-w-md text-[13px] leading-[1.8] text-[#9e9795]">
            SeeCity teljes atlasza, a Red Moon Pub pontos helyével. Húzd, görgesd, nagyíts — a térkép a saját
            eszközödön fut.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5 text-[9px] tracking-[0.18em] text-[#777]">
          <span className="border border-[color:var(--rm-line)] px-4 py-2.5">HÚZD A TÉRKÉPET</span>
          <span className="border border-[color:var(--rm-line)] px-4 py-2.5">+ / − ZOOM</span>
          <span className="border border-[color:var(--rm-line)] px-4 py-2.5">0 · ALAPHELYZET</span>
        </div>
      </div>
    </section>

    <GtaMap/>

    <section className="border-t border-[color:var(--rm-line)] bg-[#070709]">
      <div className="rm-section grid grid-cols-1 gap-3.5 md:grid-cols-3">
        {FACTS.map((fact) => (
          <article key={fact.label} className="rm-card p-8 text-left">
            <fact.icon size={18} className="mb-5 text-[color:var(--rm-red)]"/>
            <span className="text-[8px] font-bold tracking-[0.25em] text-[#777]">{fact.label}</span>
            <h3 className="mt-2.5 font-heading text-[22px] text-white">{fact.title}</h3>
            <p className="mt-2.5 text-[11px] leading-[1.8] text-[#8d8584]">{fact.description}</p>
          </article>
        ))}
      </div>
    </section>
  </main>
);
