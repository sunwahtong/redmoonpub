import React from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpRight} from 'lucide-react';
import {BtnLink} from '../components/ui/Btn';
import {Magnetic} from '../components/ui/Magnetic';
import {SplitReveal} from '../components/ui/SplitReveal';
import {Embers} from '../components/effects/Embers';
import {NAV_GROUP, NAV_LINKS, RESERVE_LINK} from '../lib/navigation';
import {backgroundImage} from '../lib/media';

/** Where a lost visitor most likely meant to go. */
const SUGGESTIONS = [
  ...NAV_LINKS.filter((link) => link.to !== '/'),
  ...NAV_GROUP.links.map(({to, label}) => ({to, label})),
  RESERVE_LINK
];

export const NotFoundPage: React.FC = () => (
  <main className="relative flex min-h-[88vh] items-center overflow-hidden px-[var(--rm-gutter)] pt-[68px]">
    <div
      style={backgroundImage('/assets/red-moon-cinematic-v27.webp')} className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20"
      aria-hidden="true"
    />
    <div
      className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#050304] via-[rgba(5,3,4,0.72)] to-transparent"
      aria-hidden="true"
    />

    {/* Oversized ghost number, bleeding off the right edge like the legacy
        event banner's day number. */}
    <span
      className="pointer-events-none absolute -right-[4vw] top-1/2 -translate-y-1/2 select-none font-heading text-[clamp(220px,34vw,460px)] font-black leading-none text-[rgba(213,31,60,0.055)]"
      aria-hidden="true"
    >
      404
    </span>

    <Embers density={30}/>

    <div className="relative z-[1] w-full max-w-3xl py-24 text-left">
      <div className="rm-label">RED MOON / 404</div>

      <h1 className="rm-heading rm-display-2 my-6">
        <SplitReveal text="Eltévedtél"/>
        <br/>
        <em>
          <SplitReveal text="az éjszakában." delay={200}/>
        </em>
      </h1>

      <p className="max-w-md leading-[1.9] text-[#9e9795]">
        Ez az oldal nem létezik — vagy már lezárult, mint egy régi este. Vissza a fényekhez?
      </p>

      <div className="mt-9">
        <Magnetic strength={11}>
          <BtnLink to="/" variant="red">
            VISSZA A FŐOLDALRA <span>↗</span>
          </BtnLink>
        </Magnetic>
      </div>

      {/* A single "go home" button leaves the visitor exactly as lost as they
          were. Offer the whole map instead. */}
      <div className="rm-gilt my-11"/>

      <span className="rm-label">TALÁN EZT KERESTED</span>
      <div className="mt-5 flex flex-wrap gap-2">
        {SUGGESTIONS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="group inline-flex items-center gap-2.5 border border-[color:var(--rm-line)] bg-black/40 px-4 py-2.5 text-[9px] font-bold tracking-[0.18em] text-[#8f8887] backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-[color:var(--rm-red)] hover:text-white"
          >
            {link.label}
            <ArrowUpRight
              size={11}
              className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </Link>
        ))}
      </div>
    </div>
  </main>
);
