import React, {useMemo, useState} from 'react';
import {CalendarClock, Phone, Search, Users} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn} from '../../components/ui/Btn';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatDate, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {roleAtLeast, useAuthStore} from '../../stores/useAuthStore';
import {
  OCCASION_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
  TIER_LABEL,
  type Reservation,
  type ReservationStatus
} from '../../lib/reservations';

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

type Filter = 'live' | 'pending' | 'all';

/** Actions offered per status. Only the transitions that make sense. */
const ACTIONS: Record<ReservationStatus, ReservationStatus[]> = {
  pending: ['confirmed', 'declined'],
  confirmed: ['seated', 'noshow', 'cancelled'],
  declined: ['pending'],
  seated: [],
  cancelled: ['pending'],
  noshow: []
};

const ACTION_LABEL: Record<ReservationStatus, string> = {
  pending: 'VISSZAÁLLÍT',
  confirmed: 'VISSZAIGAZOL',
  declined: 'ELUTASÍT',
  seated: 'LEÜLTETVE',
  cancelled: 'LEMOND',
  noshow: 'NEM JÖTT EL'
};

export const StaffReservationsPage: React.FC = () => {
  const {data, refresh} = useLiveData<{reservations: Reservation[]}>('/api/reservations', {intervalMs: 20000});
  const user = useAuthStore((state) => state.user);
  const canDecide = roleAtLeast(user?.role, 'manager');

  const [filter, setFilter] = useState<Filter>('live');
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const reservations = useMemo(() => data?.reservations || [], [data]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return reservations
      .filter((reservation) => {
        if (filter === 'pending' && reservation.status !== 'pending') return false;
        if (filter === 'live' && !['pending', 'confirmed'].includes(reservation.status)) return false;
        if (!needle) return true;
        return normalize(`${reservation.code} ${reservation.name} ${reservation.phone}`).includes(needle);
      })
      // Soonest first: the console is read in the order the door will need it.
      .sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
  }, [reservations, filter, query]);

  const counts = useMemo(
    () => ({
      pending: reservations.filter((r) => r.status === 'pending').length,
      confirmed: reservations.filter((r) => r.status === 'confirmed').length,
      guests: reservations
        .filter((r) => r.status === 'confirmed')
        .reduce((sum, r) => sum + Number(r.guests || 0), 0)
    }),
    [reservations]
  );

  const decide = async (reservation: Reservation, status: ReservationStatus) => {
    if (busyId) return;
    setBusyId(reservation.id);
    setError('');
    try {
      await apiSend(`/api/reservations/${encodeURIComponent(reservation.id)}`, 'PATCH', {
        status,
        staffNote: notes[reservation.id] ?? reservation.staffNote ?? ''
      });
      playSfx(status === 'declined' || status === 'noshow' ? 'decline' : 'accept');
      refresh();
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / ASZTALFOGLALÁSOK</div>
        <NeonHeading as="h1" size={2} className="mb-8 mt-3.5">
          A <em>foglalások.</em>
        </NeonHeading>

        <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          {[
            {label: 'ELBÍRÁLÁSRA VÁR', value: counts.pending},
            {label: 'VISSZAIGAZOLVA', value: counts.confirmed},
            {label: 'VÁRT VENDÉG', value: counts.guests}
          ].map((stat) => (
            <div key={stat.label} className="rm-card p-5">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">{stat.label}</span>
              <strong className="mt-2 block font-heading text-[24px] text-white">{stat.value}</strong>
            </div>
          ))}
        </div>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative flex w-full items-center sm:max-w-xs">
            <Search size={14} className="absolute left-4 text-[#6d5d64]"/>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="KÓD, NÉV VAGY TELEFONSZÁM…"
              className="w-full border border-[color:var(--rm-line)] bg-black/50 py-3 pl-10 pr-4 text-[10px] tracking-[0.15em] text-white outline-none focus:border-[color:var(--rm-red)]"
            />
          </label>

          <div className="flex gap-2">
            {(
              [
                {id: 'live', label: 'ÉLŐ'},
                {id: 'pending', label: 'ÚJ'},
                {id: 'all', label: 'ÖSSZES'}
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                aria-pressed={filter === option.id}
                className={`border px-4 py-2.5 text-[9px] font-bold tracking-[0.2em] transition-all ${
                  filter === option.id
                    ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.12)] text-white'
                    : 'border-white/10 text-[#8f8887] hover:border-white/30'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="mb-4 text-[11px] text-[color:var(--rm-red)]">{error}</p>}

        <div className="flex flex-col gap-2.5">
          {!visible.length && (
            <p className="rm-card p-6 text-[11px] text-[#8d8584]">Nincs foglalás ezzel a szűréssel.</p>
          )}

          {visible.map((reservation) => {
            const actions = ACTIONS[reservation.status];
            return (
              <article key={reservation.id} className="rm-card p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <strong className="font-heading text-[20px] text-white">{reservation.code}</strong>
                      <span
                        className={`border px-2.5 py-1 text-[8px] tracking-[0.18em] ${STATUS_CLASS[reservation.status]}`}
                      >
                        {STATUS_LABEL[reservation.status].toUpperCase()}
                      </span>
                      {reservation.tier !== 'none' && (
                        <span className="border border-[color:var(--rm-line-red)] px-2.5 py-1 text-[8px] tracking-[0.18em] text-[color:var(--rm-red)]">
                          {TIER_LABEL[reservation.tier].toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-[#c9c2c1]">
                      <span className="inline-flex items-center gap-2">
                        <CalendarClock size={12} className="text-[color:var(--rm-red)]"/>
                        {formatDate(reservation.when)} · {formatTime(reservation.when)}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <Users size={12} className="text-[color:var(--rm-red)]"/>
                        {reservation.guests} fő
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <Phone size={12} className="text-[color:var(--rm-red)]"/>
                        {reservation.phone || '—'}
                      </span>
                    </div>

                    <p className="mt-2 text-[10px] text-[#8d8584]">
                      {reservation.name} · {OCCASION_LABEL[reservation.occasion]}
                      {reservation.handledByName ? ` · kezelte: ${reservation.handledByName}` : ''}
                    </p>

                    {reservation.note && (
                      <p className="mt-3 max-w-xl border-l border-[color:var(--rm-line-red)] pl-3 text-[11px] leading-[1.8] text-[#a09998]">
                        {reservation.note}
                      </p>
                    )}
                  </div>
                </div>

                {canDecide && actions.length > 0 && (
                  <div className="mt-5 flex flex-col gap-3 border-t border-white/[0.06] pt-5">
                    <input
                      value={notes[reservation.id] ?? reservation.staffNote ?? ''}
                      onChange={(event) =>
                        setNotes((current) => ({...current, [reservation.id]: event.target.value}))
                      }
                      maxLength={300}
                      placeholder="ÜZENET A VENDÉGNEK (A FOGLALÁSAINÁL LÁTJA)"
                      className="w-full border border-white/10 bg-black/50 px-3.5 py-2.5 text-[10px] tracking-wider text-white outline-none placeholder:text-white/25 focus:border-[color:var(--rm-red)]"
                    />
                    <div className="flex flex-wrap gap-2">
                      {actions.map((action) => (
                        <Btn
                          key={action}
                          type="button"
                          variant={action === 'confirmed' ? 'red' : 'outline'}
                          disabled={busyId === reservation.id}
                          onClick={() => decide(reservation, action)}
                        >
                          {ACTION_LABEL[action]}
                        </Btn>
                      ))}
                    </div>
                  </div>
                )}

                {!canDecide && (
                  <p className="mt-4 border-t border-white/[0.06] pt-4 text-[9px] tracking-[0.18em] text-[#777]">
                    A FOGLALÁSOK ELBÍRÁLÁSÁHOZ ÜZLETVEZETŐI JOG KELL.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
};
