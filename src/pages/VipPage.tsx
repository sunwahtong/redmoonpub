import React from 'react';
import {Check} from 'lucide-react';
import {NeonHeading} from '../components/ui/NeonHeading';
import {BtnLink} from '../components/ui/Btn';
import {Magnetic} from '../components/ui/Magnetic';
import {Reveal} from '../components/ui/Reveal';
import {SplitReveal} from '../components/ui/SplitReveal';
import {TiltCard} from '../components/ui/TiltCard';
import {CountUp} from '../components/ui/CountUp';
import {SectionHead} from '../components/ui/SectionHead';
import {Embers} from '../components/effects/Embers';
import {Starfield} from '../components/effects/Starfield';
import {HouseLookup} from '../components/house/HouseLookup';
import {useLiveData} from '../hooks/useLiveData';
import {HOUSE_STATS, MEMBERSHIP} from '../lib/content';
import type {PublicHouse} from '../types';

/**
 * The House: the four tiers, how many hold each, the way in — and, for a
 * member, their own card.
 */
export const VipPage: React.FC = () => {
  const {data: houseData} = useLiveData<PublicHouse>('/api/public/house', {intervalMs: 0, topics: ['content']});
  const members = houseData?.members;
  const counted = !!members && members.total > 0;
  const stats = counted
    ? [
        {value: members.total, label: 'TAG A HOUSE-BAN'},
        {value: members.byTier.silver, label: 'SILVER'},
        {value: members.byTier.gold, label: 'GOLD'},
        {value: members.byTier.black + members.byTier.royal, label: 'BLACK ÉS ROYAL'}
      ]
    : HOUSE_STATS;

  return (
    <main>
      {/* HERO — the one place on the site the starfield appears outside the home page. */}
      <section className="relative flex min-h-[620px] items-end overflow-hidden border-b border-[color:var(--rm-line)] bg-[#060406] px-[8vw] pb-20 pt-[180px]">
        <Starfield/>
        <Embers density={34}/>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_25%,rgba(227,40,78,0.16),transparent_58%)]" aria-hidden="true"/>

        <div className="relative z-[2]">
          <div className="rm-label">RED MOON / A HÁZ BELSŐ KÖRE</div>

          <h1 className="rm-heading rm-display-1 my-5">
            <span className="rm-shimmer">
              <SplitReveal text="THE HOUSE"/>
            </span>
            <br/>
            <em>
              <SplitReveal text="membership." delay={260} stagger={26}/>
            </em>
          </h1>

          <p className="max-w-[620px] text-sm leading-[1.9] text-[#aaa]">
            A Red Moon nem klubkártyákat oszt. A House négy szintje meghívás — annak, aki már nem vendég, hanem része az éjszakának. Aki tag, kódot kap: azzal foglal, és a foglalása a szintjével érkezik.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Magnetic>
              <BtnLink to="/reservations" variant="red">
                ASZTALT FOGLALOK <span>↗</span>
              </BtnLink>
            </Magnetic>
            <a href="#kartya" className="rm-btn">
              TAG VAGYOK ↓
            </a>
          </div>
        </div>
      </section>

      {/* HOUSE NUMBERS — live once the house has members, the house's constants until then. */}
      <section className="border-b border-[color:var(--rm-line)] bg-[#070709]">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div key={stat.label} className="border-b border-r border-[color:var(--rm-line)] px-7 py-11 last:border-r-0 lg:border-b-0">
              <Reveal delay={index * 90}>
                <strong className="block font-heading text-[46px] leading-none text-white">
                  <CountUp to={stat.value} suffix={'suffix' in stat ? stat.suffix : undefined} decimals={'decimals' in stat ? stat.decimals : undefined}/>
                </strong>
                <span className="mt-3 block text-[8px] tracking-[0.22em] text-[#777]">{stat.label}</span>
              </Reveal>
            </div>
          ))}
        </div>
      </section>

      {/* THE LADDER */}
      <section className="rm-section">
        <SectionHead
          label="01 / A NÉGY SZINT"
          title={
            <>
              A House
              <br/>
              <em>lépcsői.</em>
            </>
          }
          aside="Felfelé nem lehet jelentkezni. Minden szintet a ház ajánl fel — Silvert és Goldot a managerek, Blacket és Royalt a tulajdonosok."
        />

        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
          {MEMBERSHIP.map((tier, index) => {
            const holders = counted ? members.byTier[tier.id] : 0;
            return (
              <Reveal key={tier.id} delay={index * 100} className="h-full">
                <TiltCard className="h-full">
                  <article data-tier={tier.id} className={`rm-tier flex h-full flex-col p-7 ${tier.featured ? 'ring-1 ring-[color:var(--rm-line-red)]' : ''}`}>
                    <span className="rm-tier-glyph" aria-hidden="true">
                      {tier.glyph}
                    </span>

                    <div className="rm-tilt-layer relative flex h-full flex-col">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[8px] tracking-[0.25em] text-[#777]">{tier.no}</span>
                        <span className="flex flex-wrap justify-end gap-1.5">
                          {holders > 0 && <span className="rm-tier-count">{holders} TAG</span>}
                          {tier.featured && <span className="border border-[color:var(--rm-line-red)] px-2 py-1 text-[7px] tracking-[0.22em] text-[color:var(--rm-red)]">A LEGTÖBBEN IDE TARTANAK</span>}
                        </span>
                      </div>

                      <span className="rm-tier-crest mt-5 block">{tier.name}</span>
                      <p className="mt-2.5 text-[11px] leading-[1.7] text-[#a09998]">{tier.tagline}</p>

                      <div className="rm-gilt my-6"/>

                      <ul className="flex flex-col gap-2.5">
                        {tier.perks.map((perk) => (
                          <li key={perk} className="flex gap-2.5 text-[10px] leading-[1.7] text-[#8d8584]">
                            <Check size={12} className="mt-[2px] shrink-0 text-[color:var(--rm-red)]"/>
                            {perk}
                          </li>
                        ))}
                      </ul>

                      <p className="mt-auto pt-7 text-[9px] leading-[1.8] text-[#6f6968]">{tier.path}</p>
                    </div>
                  </article>
                </TiltCard>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* THE CARD */}
      <section id="kartya" className="border-y border-[color:var(--rm-line)] bg-[#070709]">
        <div className="rm-section grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div>
            <SectionHead
              label="02 / A KÁRTYÁD"
              title={
                <>
                  Tag vagy?
                  <br/>
                  <em>Nézd meg a kártyád.</em>
                </>
              }
            />
            <p className="-mt-6 max-w-md text-[12px] leading-[1.9] text-[#9e9795]">
              A tagságot a bejáratnál kapod, egy kóddal. A kód és a telefonszámod együtt nyitja a kártyádat: látod a szinted, a látogatásaid, és innen egy koppintás a foglalás — a kóddal, a szinteddel.
            </p>
            <ul className="mt-7 flex flex-col gap-3 text-[11px] leading-[1.7] text-[#8d8584]">
              {['A kódot a foglalásnál is beírhatod: a foglalás a szinteddel érkezik a házhoz.', 'A ház minden estét feljegyez: a látogatásaid a kártyádon gyűlnek.', 'Ha a kód nem működik, a bejáratnál kérdezz — a tagság felfüggeszthető és visszaállítható.'].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Check size={12} className="mt-[3px] shrink-0 text-[color:var(--rm-red)]"/>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <Reveal delay={120}>
            <HouseLookup/>
          </Reveal>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="rm-section">
        <SectionHead
          label="03 / AHOGY MŰKÖDIK"
          title={
            <>
              Nem kérvény.
              <br/>
              <em>Meghívás.</em>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {[
            {
              no: '01',
              title: 'Gyere be',
              body: 'Foglalj asztalt, vagy ülj le a pultnál. A ház minden estét feljegyez — nem a fogyasztást, hanem az embert.'
            },
            {
              no: '02',
              title: 'A ház javasol',
              body: 'Aki visszatér és otthon van nálunk, azt a manager felterjeszti. Erről nem kell tudnod.'
            },
            {
              no: '03',
              title: 'Megkapod a kódod',
              body: 'A tagságot a bejáratnál adjuk át, személyesen, egy kóddal. Ettől kezdve a foglalásaid a szinteddel érkeznek.'
            }
          ].map((step, index) => (
            <Reveal key={step.no} delay={index * 100} className="h-full">
              <div className="rm-card h-full p-8">
                <span className="font-heading text-[42px] leading-none text-[rgba(227,40,78,0.5)]">{step.no}</span>
                <h3 className="mb-3 mt-5 font-heading text-[22px] text-white">{step.title}</h3>
                <p className="text-[11px] leading-[1.85] text-[#8d8584]">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CLOSING CALL */}
      <section className="relative overflow-hidden border-t border-[color:var(--rm-line)]">
        <Embers density={52}/>
        <div className="rm-section relative z-[2] text-center">
          <div className="rm-label">RED MOON / AFTER DARK</div>
          <NeonHeading as="h2" size={1} className="mx-auto my-6 max-w-[14ch]">
            Az első lépés egy <em>asztal.</em>
          </NeonHeading>
          <p className="mx-auto mb-10 max-w-md text-[12px] leading-[1.9] text-[#9e9795]">Minden tagság ugyanott kezdődik: egy estén, amikor bejössz és maradsz.</p>
          <Magnetic strength={12}>
            <BtnLink to="/reservations" variant="red">
              ASZTALFOGLALÁS <span>↗</span>
            </BtnLink>
          </Magnetic>
        </div>
      </section>
    </main>
  );
};
