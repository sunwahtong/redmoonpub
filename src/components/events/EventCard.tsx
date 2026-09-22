import React from 'react';
import {CalendarDays, Clock, MapPin} from 'lucide-react';
import {NeonHeading} from '../ui/NeonHeading';
import {BtnLink} from '../ui/Btn';
import {Magnetic} from '../ui/Magnetic';
import {CountdownRing} from '../ui/CountdownRing';
import {useCountdown} from '../../hooks/useCountdown';
import {formatDate, formatTime, formatWeekday} from '../../lib/api';
import type {RedMoonEvent} from '../../types';

export type EventPhase = 'upcoming' | 'live' | 'past';

interface Props {
  event: RedMoonEvent;
  phase: EventPhase;
  /** Highlights the single next event with the full banner treatment. */
  featured?: boolean;
}

const PHASE_LABEL: Record<EventPhase, string> = {
  upcoming: 'NEXT EVENT · RED MOON',
  live: 'ÉPPEN ZAJLIK',
  past: 'PAST EVENT'
};

/**
 * Legacy `.rm17-event` (featured banner) and `.v64-event-page-item` (list row):
 * square frame, oversized ghosted day number bleeding off the right edge, and a
 * Cinzel countdown.
 */
export const EventCard: React.FC<Props> = ({event, phase, featured = false}) => {
  const countdown = useCountdown(phase === 'upcoming' ? event.startsAt : null);
  const start = new Date(event.startsAt);
  const dayNumber = String(start.getDate()).padStart(2, '0');

  return (
    <article
      className={`relative flex flex-col gap-8 overflow-hidden border p-8 transition-all duration-300 lg:flex-row lg:items-center lg:justify-between lg:p-12 ${
        phase === 'past'
          ? 'border-[color:var(--rm-line)] bg-[#08080a] opacity-60 hover:opacity-95'
          : featured
            ? 'border-[#35151c] bg-gradient-to-r from-[#12070a] to-[#08080a] shadow-[0_24px_70px_rgba(0,0,0,0.65)]'
            : 'border-[color:var(--rm-line)] bg-[#09090b] hover:translate-x-1 hover:border-[rgba(213,31,60,0.5)]'
      }`}
    >
      {/* The giant ghosted date the legacy banner carried. */}
      {featured && (
        <span
          className="pointer-events-none absolute -top-12 right-[4vw] select-none font-heading text-[220px] font-black leading-none text-[rgba(213,31,60,0.05)]"
          aria-hidden="true"
        >
          {dayNumber}
        </span>
      )}

      <div className="relative z-[1] text-left lg:flex-1">
        <div className="mb-3 flex items-center gap-3">
          <span className={`text-[8px] font-bold tracking-[0.25em] ${phase === 'past' ? 'text-[#777]' : 'text-[color:var(--rm-red)]'}`}>
            {PHASE_LABEL[phase]}
          </span>
          {phase === 'live' && (
            <span className="flex items-center gap-1.5 border border-[rgba(213,31,60,0.5)] bg-[rgba(213,31,60,0.15)] px-2.5 py-1 text-[8px] font-bold tracking-[0.2em] text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--rm-red)]"/>
              LIVE
            </span>
          )}
        </div>

        <NeonHeading as={featured ? 'h2' : 'h3'} size={featured ? 2 : 3}>
          {event.title}
        </NeonHeading>

        <p className="mt-5 max-w-xl text-[13px] leading-[1.8] text-[#9e9795]">
          {event.description || 'A Red Moon következő eseménye.'}
        </p>

        <div className="mt-7 flex flex-wrap gap-x-8 gap-y-3 text-[10px] tracking-wider text-[#8f8887]">
          <span className="flex items-center gap-2">
            <CalendarDays size={13} className="text-[color:var(--rm-red)]"/>
            <b className="font-semibold text-white">{formatDate(start)}</b>
            <span className="text-[#6d5d64]">· {formatWeekday(start)}</span>
          </span>
          <span className="flex items-center gap-2">
            <Clock size={13} className="text-[color:var(--rm-red)]"/>
            <b className="font-semibold text-white">{formatTime(start)}</b>
            {event.endsAt && <span className="text-[#6d5d64]">– {formatTime(event.endsAt)}</span>}
          </span>
          <span className="flex items-center gap-2">
            <MapPin size={13} className="text-[color:var(--rm-red)]"/>
            <b className="font-semibold text-white">{event.place || 'Red Moon Pub'}</b>
          </span>
        </div>
      </div>

      <div className="relative z-[1] flex shrink-0 flex-col items-start gap-4 lg:items-end">
        {phase === 'upcoming' ? (
          <>
            {featured ? (
              /* The next event gets the ring: one object the eye lands on. */
              <CountdownRing startsAt={event.startsAt}/>
            ) : (
              <div className="flex items-end gap-3">
                {[
                  {label: 'NAP', value: countdown.d},
                  {label: 'ÓRA', value: countdown.h},
                  {label: 'PERC', value: countdown.m},
                  {label: 'MP', value: countdown.s}
                ].map((unit) => (
                  <div key={unit.label} className="min-w-[58px] text-center">
                    <b className="block font-heading text-[26px] leading-none text-white tabular-nums">{unit.value}</b>
                    <span className="mt-2 block text-[7px] tracking-[0.18em] text-[#777]">{unit.label}</span>
                  </div>
                ))}
              </div>
            )}
            <small className="text-[8px] tracking-[0.2em] text-[#6d5d64]">HÁTRALÉVŐ IDŐ</small>
            <Magnetic>
              <BtnLink to="/reservations" variant="red">
                ASZTALT FOGLALOK ↗
              </BtnLink>
            </Magnetic>
          </>
        ) : (
          <>
            <span className="border border-white/10 px-5 py-3 text-[9px] font-bold tracking-[0.2em] text-[#8f8887]">
              {phase === 'live' ? 'MOST A RED MOONBAN' : 'AZ ESEMÉNY LEZAJLOTT'}
            </span>
            <BtnLink to="/events">{phase === 'live' ? 'EVENT INFO' : 'ARCHÍV'} ↗</BtnLink>
          </>
        )}
      </div>
    </article>
  );
};
