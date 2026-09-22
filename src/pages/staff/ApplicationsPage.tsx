import React, {useMemo, useState} from 'react';
import {CalendarDays, MessageSquare, Phone, Search, User} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn} from '../../components/ui/Btn';
import {Skeleton} from '../../components/ui/Skeleton';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatDate, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {
  POSITION_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
  type Application,
  type CareerStatus
} from '../../lib/careers';

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

type Filter = 'open' | 'pending' | 'all';

/** Only the transitions that make sense from each state. */
const ACTIONS: Record<CareerStatus, CareerStatus[]> = {
  pending: ['interview', 'rejected'],
  interview: ['accepted', 'rejected'],
  accepted: [],
  rejected: ['pending'],
  withdrawn: []
};

const ACTION_LABEL: Record<CareerStatus, string> = {
  pending: 'ÚJRANYIT',
  interview: 'INTERJÚRA HÍV',
  accepted: 'FELVESZ',
  rejected: 'ELUTASÍT',
  withdrawn: 'VISSZAVONVA'
};

export const ApplicationsPage: React.FC = () => {
  const {data, loading, refresh} = useLiveData<{applications: Application[]}>('/api/applications', {
    intervalMs: 25000
  });

  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const applications = useMemo(() => data?.applications || [], [data]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return applications
      .filter((application) => {
        if (filter === 'pending' && application.status !== 'pending') return false;
        if (filter === 'open' && !['pending', 'interview'].includes(application.status)) return false;
        if (!needle) return true;
        return normalize(
          `${application.code} ${application.name} ${application.phone} ${POSITION_LABEL[application.position]}`
        ).includes(needle);
      })
      // Newest first: recruitment is read as an inbox.
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [applications, filter, query]);

  const counts = useMemo(
    () => ({
      pending: applications.filter((a) => a.status === 'pending').length,
      interview: applications.filter((a) => a.status === 'interview').length,
      accepted: applications.filter((a) => a.status === 'accepted').length
    }),
    [applications]
  );

  const decide = async (application: Application, status: CareerStatus) => {
    if (busyId) return;
    setBusyId(application.id);
    try {
      await apiSend(`/api/applications/${encodeURIComponent(application.id)}`, 'PATCH', {
        status,
        staffNote: notes[application.id] ?? application.staffNote ?? ''
      });
      toast.success(`${application.code} · ${STATUS_LABEL[status]}`);
      playSfx(status === 'rejected' ? 'decline' : 'accept');
      refresh();
    } catch (err) {
      toast.error('A művelet nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / JELENTKEZÉSEK</div>
        <NeonHeading as="h1" size={2} className="mb-8 mt-3.5">
          A <em>jelentkezők.</em>
        </NeonHeading>

        <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          {[
            {label: 'ÚJ JELENTKEZÉS', value: counts.pending},
            {label: 'INTERJÚRA HÍVVA', value: counts.interview},
            {label: 'FELVÉVE', value: counts.accepted}
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
              placeholder="KÓD, NÉV VAGY POZÍCIÓ…"
              className="w-full border border-[color:var(--rm-line)] bg-black/50 py-3 pl-10 pr-4 text-[10px] tracking-[0.15em] text-white outline-none focus:border-[color:var(--rm-red)]"
            />
          </label>

          <div className="flex gap-2">
            {(
              [
                {id: 'open', label: 'NYITOTT'},
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

        {loading && (
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-52" count={3}/>
          </div>
        )}

        {!loading && (
          <div className="flex flex-col gap-2.5">
            {!visible.length && (
              <p className="rm-card p-6 text-[11px] text-[#8d8584]">Nincs jelentkezés ezzel a szűréssel.</p>
            )}

            {visible.map((application) => {
              const actions = ACTIONS[application.status];
              return (
                <article key={application.id} className="rm-card p-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <strong className="font-heading text-[20px] text-white">{application.code}</strong>
                    <span
                      className={`border px-2.5 py-1 text-[8px] tracking-[0.18em] ${STATUS_CLASS[application.status]}`}
                    >
                      {STATUS_LABEL[application.status].toUpperCase()}
                    </span>
                    <span className="border border-[color:var(--rm-line-red)] px-2.5 py-1 text-[8px] tracking-[0.18em] text-[color:var(--rm-red)]">
                      {POSITION_LABEL[application.position]}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-[#c9c2c1]">
                    <span className="inline-flex items-center gap-2">
                      <User size={12} className="text-[color:var(--rm-red)]"/>
                      {application.name} · {application.age} éves
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <Phone size={12} className="text-[color:var(--rm-red)]"/>
                      {application.phone || '—'}
                    </span>
                    {application.radio && (
                      <span className="inline-flex items-center gap-2">
                        <MessageSquare size={12} className="text-[color:var(--rm-red)]"/>
                        {application.radio}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-2">
                      <CalendarDays size={12} className="text-[color:var(--rm-red)]"/>
                      {formatDate(application.at)} · {formatTime(application.at)}
                    </span>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                    {(
                      [
                        ['MIKOR ÉR RÁ', application.availability],
                        ['KORÁBBI TAPASZTALAT', application.experience]
                      ] as const
                    ).map(([label, body]) =>
                      body ? (
                        <div key={label}>
                          <span className="text-[8px] tracking-[0.25em] text-[#777]">{label}</span>
                          <p className="mt-2 text-[11px] leading-[1.8] text-[#a09998]">{body}</p>
                        </div>
                      ) : null
                    )}
                  </div>

                  {application.why && (
                    <div className="mt-5">
                      <span className="text-[8px] tracking-[0.25em] text-[#777]">MIÉRT A RED MOON</span>
                      <p className="mt-2 border-l border-[color:var(--rm-line-red)] pl-3.5 text-[11px] leading-[1.85] text-[#c9c2c1]">
                        {application.why}
                      </p>
                    </div>
                  )}

                  {application.handledByName && (
                    <p className="mt-4 text-[9px] tracking-[0.16em] text-[#6f6968]">
                      KEZELTE: {application.handledByName.toUpperCase()}
                    </p>
                  )}

                  {actions.length > 0 && (
                    <div className="mt-5 flex flex-col gap-3 border-t border-white/[0.06] pt-5">
                      <input
                        value={notes[application.id] ?? application.staffNote ?? ''}
                        onChange={(event) =>
                          setNotes((current) => ({...current, [application.id]: event.target.value}))
                        }
                        maxLength={400}
                        placeholder="ÜZENET A JELENTKEZŐNEK (A SAJÁT JELENTKEZÉSÉNÉL LÁTJA)"
                        className="w-full border border-white/10 bg-black/50 px-3.5 py-2.5 text-[10px] tracking-wider text-white outline-none placeholder:text-white/25 focus:border-[color:var(--rm-red)]"
                      />
                      <div className="flex flex-wrap gap-2">
                        {actions.map((action) => (
                          <Btn
                            key={action}
                            type="button"
                            variant={action === 'accepted' || action === 'interview' ? 'red' : 'outline'}
                            disabled={busyId === application.id}
                            onClick={() => decide(application, action)}
                          >
                            {ACTION_LABEL[action]}
                          </Btn>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
};
