import React, {useEffect, useMemo, useState} from 'react';
import {PageHero} from '../components/ui/PageHero';
import {SectionHead} from '../components/ui/SectionHead';
import {Reveal} from '../components/ui/Reveal';
import {EmptyState} from '../components/ui/EmptyState';
import {BtnLink} from '../components/ui/Btn';
import {Skeleton} from '../components/ui/Skeleton';
import {EventCard, type EventPhase} from '../components/events/EventCard';
import {useLiveData} from '../hooks/useLiveData';
import type {RedMoonEvent} from '../types';

/** How long an event without an explicit end time counts as running. */
const ASSUMED_DURATION_MS = 4 * 60 * 60 * 1000;

function phaseOf(event: RedMoonEvent, now: number): EventPhase {
  const start = new Date(event.startsAt).getTime();
  if (!Number.isFinite(start) || now < start) return 'upcoming';
  const end = event.endsAt ? new Date(event.endsAt).getTime() : start + ASSUMED_DURATION_MS;
  return now <= end ? 'live' : 'past';
}

export const EventsPage: React.FC = () => {
  const {data, error, loading} = useLiveData<{events: RedMoonEvent[]}>('/api/public-events', {intervalMs: 45000});

  // Re-evaluated on a slow tick so an event flips to "live" without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const {live, upcoming, past} = useMemo(() => {
    const events = data?.events || [];
    const byStartAsc = (a: RedMoonEvent, b: RedMoonEvent) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();

    return {
      live: events.filter((event) => phaseOf(event, now) === 'live').sort(byStartAsc),
      upcoming: events.filter((event) => phaseOf(event, now) === 'upcoming').sort(byStartAsc),
      past: events.filter((event) => phaseOf(event, now) === 'past').sort((a, b) => byStartAsc(b, a))
    };
  }, [data, now]);

  const hasAny = live.length + upcoming.length + past.length > 0;

  return (
    <main>
      <PageHero
        kicker="RED MOON / 03"
        overline="THE"
        title="NIGHT"
        lead="Rendezvények, tematikus esték és a következő vörös hold."
      >
        {!loading && hasAny && (
          <div className="mt-8 flex flex-wrap gap-2.5 text-[9px] font-bold tracking-[0.2em]">
            <span className="border border-[rgba(213,31,60,0.4)] bg-[rgba(213,31,60,0.1)] px-4 py-2.5 text-white">
              {upcoming.length} KÖZELGŐ
            </span>
            {live.length > 0 && (
              <span className="border border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.2)] px-4 py-2.5 text-white">
                {live.length} ÉPPEN ZAJLIK
              </span>
            )}
            <span className="border border-white/10 px-4 py-2.5 text-[#8f8887]">{past.length} ARCHÍV</span>
          </div>
        )}
      </PageHero>

      <div className="rm-section">
        {loading && (
          <div className="flex flex-col gap-3.5">
            <Skeleton className="h-60" count={3}/>
          </div>
        )}

        {!loading && error && (
          <EmptyState
            label="RED MOON / EVENTS"
            title="A rendezvények jelenleg nem érhetők el."
            description="A kapcsolat a bár rendszerével megszakadt. Hamarosan automatikusan újra próbálkozunk."
          />
        )}

        {!loading && !error && !hasAny && (
          <EmptyState
            label="RED MOON / EVENTS"
            title="Hamarosan lesz esemény."
            description="Az új rendezvény automatikusan megjelenik ezen az oldalon."
            action={
              <BtnLink to="/menu" variant="red">
                ADDIG NÉZD MEG AZ ITALLAPOT ↗
              </BtnLink>
            }
          />
        )}

        {!loading && !error && live.length > 0 && (
          <section className="mb-16">
            <SectionHead
              label="MOST / A HÁZBAN"
              title={
                <>
                  Éppen <em>zajlik.</em>
                </>
              }
            />
            <div className="rm-spine flex flex-col gap-3.5">
              {live.map((event) => (
                <Reveal key={event.id} className="rm-spine-node" data-phase="live">
                  <EventCard event={event} phase="live" featured/>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        {!loading && !error && upcoming.length > 0 && (
          <section className="mb-16">
            <SectionHead
              label="01 / KÖZELGŐ ESTÉK"
              title={
                <>
                  A következő
                  <br/>
                  <em>vörös hold.</em>
                </>
              }
              aside="Minden esemény a Red Moon Pubban, SeeCity szívében."
            />
            <div className="rm-spine flex flex-col gap-3.5">
              {upcoming.map((event, index) => (
                <Reveal
                  key={event.id}
                  delay={Math.min(index, 5) * 70}
                  className="rm-spine-node"
                  data-phase="upcoming"
                >
                  <EventCard event={event} phase="upcoming" featured={index === 0 && live.length === 0}/>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        {!loading && !error && past.length > 0 && (
          <section>
            <SectionHead
              label="02 / ARCHÍVUM"
              title={
                <>
                  Ami már <em>történelem.</em>
                </>
              }
              aside="Lezajlott esték a Red Moon naplójából."
            />
            <div className="rm-spine flex flex-col gap-3.5">
              {past.map((event, index) => (
                <Reveal key={event.id} delay={Math.min(index, 5) * 70} className="rm-spine-node" data-phase="past">
                  <EventCard event={event} phase="past"/>
                </Reveal>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
};
