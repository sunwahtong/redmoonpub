import React, {useMemo} from 'react';
import {PageHero} from '../components/ui/PageHero';
import {SectionHead} from '../components/ui/SectionHead';
import {NeonHeading} from '../components/ui/NeonHeading';
import {BtnLink, BtnAnchor} from '../components/ui/Btn';
import {Reveal} from '../components/ui/Reveal';
import {Skeleton} from '../components/ui/Skeleton';
import {LeaderCard} from '../components/about/LeaderCard';
import {useLiveData} from '../hooks/useLiveData';
import {MEMBERSHIP} from '../lib/content';
import type {PublicHouse} from '../types';

export const AboutPage: React.FC = () => {
  const {data, loading} = useLiveData<PublicHouse>('/api/public/house', {intervalMs: 0});

  const {owners, managers} = useMemo(() => {
    const people = data?.people || [];
    return {
      owners: people.filter((person) => person.tier === 'owner' || person.tier === 'co-owner'),
      managers: people.filter((person) => person.tier === 'manager' || person.tier === 'staff')
    };
  }, [data]);

  return (
    <main>
      <PageHero
        kicker="RED MOON / 05"
        overline="THE"
        title="PEOPLE"
        lead="A hely mögött álló emberek és a Red Moon története."
      />

      {/* A történetünk */}
      <section className="rm-section">
        <div className="grid grid-cols-1 items-center gap-[9vw] lg:grid-cols-2">
          <Reveal>
            <div className="relative min-h-[470px] overflow-hidden border border-[color:var(--rm-line)] bg-[url('/assets/red-moon-cinematic-v27.webp')] bg-cover bg-center lg:min-h-[570px]">
              <span className="pointer-events-none absolute right-8 top-4 font-heading text-[120px] leading-none text-[rgba(213,31,60,0.35)]">
                月
              </span>
              <span className="absolute bottom-6 left-6 text-[8px] tracking-[0.25em] text-[#ddd]">
                SEE CITY · EST. RED MOON
              </span>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="text-left">
              <div className="rm-label">A TÖRTÉNETÜNK</div>
              <NeonHeading as="h2" className="mb-7 mt-3.5">
                Egy vörös hold
                <br/>
                <em>alatt.</em>
              </NeonHeading>

              <p className="mb-4 leading-[1.95] text-[#9e9795]">
                A Red Moon Pub azért született, hogy SeeCity éjszakájának legyen egy kifinomult helye, ahol a minőség, a
                hangulat és a vendégélmény kerül középpontba.
              </p>
              <p className="leading-[1.95] text-[#9e9795]">
                Az ázsiai inspiráció nálunk nem díszlet: a részletekben, az ízekben, a fényekben és a teljes atmoszférában
                jelenik meg.
              </p>

              <div className="rm-rule my-9"/>

              <div className="grid grid-cols-3 gap-3">
                {[
                  {value: '∞', label: 'ÉJSZAKAI LENDÜLET'},
                  {value: '24/7', label: 'SAJÁT TÖRTÉNET'},
                  {value: 'SC', label: 'SEE CITY ÉJSZAKÁJA'}
                ].map((stat) => (
                  <div key={stat.label} className="border border-[color:var(--rm-line)] bg-[#09090b] p-[22px]">
                    <strong className="block font-heading text-[30px] text-white">{stat.value}</strong>
                    <span className="mt-2 block text-[8px] tracking-[0.18em] text-[#777]">{stat.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Red Moon közösség */}
      <section className="border-y border-[color:var(--rm-line)] bg-[#070709]">
        <div className="rm-section">
          <SectionHead
            label="04 / A HÁZ"
            title={
              <>
                Red Moon
                <br/>
                <em>közösség.</em>
              </>
            }
            aside={<BtnLink to="/vip">A TELJES HOUSE ↗</BtnLink>}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MEMBERSHIP.map((tier, index) => (
              <Reveal key={tier.id} delay={index * 80} className="h-full">
                <article data-tier={tier.id} className="rm-tier h-full min-h-[210px] p-7 text-left">
                  <span className="rm-tier-glyph" aria-hidden="true">
                    {tier.glyph}
                  </span>
                  <div className="relative">
                    <span className="text-[8px] tracking-[0.2em] text-[#777]">{tier.no}</span>
                    <span className="rm-tier-crest mb-3 mt-2 block">{tier.name}</span>
                    <p className="text-[10px] leading-[1.8] text-[#827b7a]">{tier.tagline}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Red Moon napló */}
      <section className="rm-section">
        <SectionHead
          label="07 / RED MOON NAPLÓ"
          title={
            <>
              Az este
              <br/>
              <em>története.</em>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <Reveal className="lg:col-span-2">
            <article className="relative h-full min-h-[250px] overflow-hidden border border-[#35151c] bg-gradient-to-br from-[#16070b] to-[#09090b] p-9 lg:p-11">
              <span className="rm-glyph">月</span>
              <span className="rm-label relative z-[1]">RED MOON NAPLÓ / 001</span>
              <NeonHeading as="h3" className="relative z-[1] mt-3">
                Mi történik, amikor <em>lemegy a nap?</em>
              </NeonHeading>
              <p className="relative z-[1] mt-5 max-w-lg text-[11px] leading-[1.8] text-[#8d8584]">
                Eventek, új italok, különleges esték és a Red Moon pillanatai egy helyen. A Journal a hely történetét
                gyűjti össze — napról napra.
              </p>
              <div className="relative z-[1] mt-9">
                <BtnLink to="/events" variant="red">
                  MEGNÉZEM ↗
                </BtnLink>
              </div>
            </article>
          </Reveal>

          <div className="flex flex-col gap-3.5">
            <Reveal delay={100} className="h-full">
              <article className="rm-card flex h-full flex-col justify-between p-9">
                <div>
                  <span className="rm-label">A BÁR</span>
                  <NeonHeading as="h3" className="mt-3">
                    Prémium itallap.
                  </NeonHeading>
                  <p className="mt-3 text-[11px] leading-[1.8] text-[#8d8584]">Fedezd fel, mit töltünk ma este.</p>
                </div>
                <div className="mt-7">
                  <BtnLink to="/menu">ITALLAP ↗</BtnLink>
                </div>
              </article>
            </Reveal>

            <Reveal delay={180} className="h-full">
              <article className="rm-card flex h-full flex-col justify-between p-9">
                <div>
                  <span className="rm-label">A HÁZ</span>
                  <NeonHeading as="h3" className="mt-3">
                    A tulajdonosok.
                  </NeonHeading>
                  <p className="mt-3 text-[11px] leading-[1.8] text-[#8d8584]">Az emberek a vörös hold mögött.</p>
                </div>
                <div className="mt-7">
                  <BtnAnchor href="#csaladfa">CSALÁDFA ↓</BtnAnchor>
                </div>
              </article>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Családfa */}
      <section id="csaladfa" className="scroll-mt-24 border-t border-[color:var(--rm-line)] bg-[#070709]">
        <div className="rm-section">
          <SectionHead
            label="A HÁZ / FAMILY"
            title={
              <>
                Red Moon
                <br/>
                <em>családfa.</em>
              </>
            }
            aside="A Red Moon mögött álló emberek és a ház vezetői — egy közös történet részei."
          />

          {loading && (
            <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-3.5 md:grid-cols-2">
              <Skeleton className="h-[360px]" count={2}/>
            </div>
          )}

          {!loading && (
            <div className="flex flex-col items-center">
              {owners.map((person, index) => (
                <React.Fragment key={person.id}>
                  {index > 0 && (
                    <div className="flex h-16 flex-col items-center justify-center" aria-hidden="true">
                      <span className="h-10 w-px bg-gradient-to-b from-[rgba(213,31,60,0.6)] to-transparent"/>
                      <span className="text-xs text-[rgba(213,31,60,0.7)]">↓</span>
                    </div>
                  )}
                  <Reveal delay={index * 100} className="flex w-full max-w-sm justify-center">
                    <LeaderCard person={person}/>
                  </Reveal>
                </React.Fragment>
              ))}

              {managers.length > 0 && (
                <>
                  <div className="relative h-16 w-full max-w-3xl" aria-hidden="true">
                    <span className="absolute left-1/2 top-0 h-7 w-px -translate-x-1/2 bg-[rgba(213,31,60,0.4)]"/>
                    <span className="absolute left-1/4 right-1/4 top-7 h-px bg-[rgba(213,31,60,0.25)]"/>
                    <span className="absolute left-1/4 top-7 h-9 w-px bg-gradient-to-b from-[rgba(213,31,60,0.25)] to-transparent"/>
                    <span className="absolute right-1/4 top-7 h-9 w-px bg-gradient-to-b from-[rgba(213,31,60,0.25)] to-transparent"/>
                  </div>

                  <div className="grid w-full grid-cols-1 justify-items-center gap-3.5 md:grid-cols-2">
                    {managers.map((person, index) => (
                      <Reveal key={person.id} delay={index * 100} className="flex w-full max-w-sm justify-center">
                        <LeaderCard person={person}/>
                      </Reveal>
                    ))}
                  </div>
                </>
              )}

              {!owners.length && !managers.length && (
                <p className="text-[11px] text-[#8d8584]">A családfa hamarosan.</p>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
};
