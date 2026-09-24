import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Armchair, CalendarClock, Check, LayoutGrid, MessageSquare, Phone, Send, Users, X} from 'lucide-react';
import {Btn} from '../../components/ui/Btn';
import {Badge, Chips, PageHeader, Panel, SearchField, Stat} from '../../components/ui/console';
import {FloorLegend, FloorMap} from '../../components/floor/FloorMap';
import {useFloorPlan, type HeldTable} from '../../hooks/useFloorPlan';
import {tableClashes, windowsOverlap} from '../../../shared/floorPlan.ts';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatAgo, formatDate, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {roleAtLeast, useAuthStore} from '../../stores/useAuthStore';
import {
  OCCASION_LABEL,
  PIPELINE,
  pipelineIndex,
  STATUS_CLASS,
  STATUS_LABEL,
  TIER_LABEL,
  canMessage,
  type Reservation,
  type ReservationMessage,
  type ReservationStatus
} from '../../lib/reservations';

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** `datetime-local` wants a local "YYYY-MM-DDTHH:mm". */
const toLocalInput = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** The plan opens on tonight at nine, or right now once the evening has started. */
const defaultPlanWhen = (): string => {
  const date = new Date();
  if (date.getHours() < 21) date.setHours(21, 0, 0, 0);
  else date.setMinutes(0, 0, 0);
  return toLocalInput(date);
};

type Filter = 'live' | 'new' | 'unread' | 'all';

/** Actions offered per status. Only the transitions that make sense. */
const ACTIONS: Record<ReservationStatus, ReservationStatus[]> = {
  pending: ['reviewing', 'confirmed', 'waitlist', 'declined'],
  reviewing: ['confirmed', 'waitlist', 'declined'],
  waitlist: ['confirmed', 'declined'],
  confirmed: ['seated', 'noshow', 'cancelled'],
  declined: ['reviewing'],
  seated: [],
  cancelled: ['reviewing'],
  noshow: []
};

const ACTION_LABEL: Record<ReservationStatus, string> = {
  pending: 'VISSZAÁLLÍT',
  reviewing: 'NÉZZÜK',
  waitlist: 'VÁRÓLISTA',
  confirmed: 'VISSZAIGAZOL',
  declined: 'NEM FÉR BE',
  seated: 'LEÜLTETVE',
  cancelled: 'LEMOND',
  noshow: 'NEM JÖTT EL'
};

/** Ready-made lines for the thread, so a reply is one click. */
const QUICK_REPLIES = [
  'Megkaptuk, hamarosan visszajelzünk.',
  'Az asztal készen áll, várunk titeket!',
  'Erre az időpontra tele vagyunk. Egy órával később még van hely — jó lenne?',
  'Kérlek, erősítsd meg, hogy jöttök.'
];

const Pipeline: React.FC<{status: ReservationStatus}> = ({status}) => {
  const index = pipelineIndex(status);
  const bad = status === 'declined' || status === 'noshow' || status === 'cancelled';
  return (
    <div className="rm-pipeline" aria-label="Folyamat">
      {PIPELINE.map((stage, position) => (
        <span
          key={stage.id}
          className={`rm-pipeline-step${position < index ? ' is-done' : ''}${position === index ? (bad ? ' is-bad' : ' is-current') : ''}`}
        >
          {stage.label}
        </span>
      ))}
    </div>
  );
};

/** The thread with one guest, opened inside the booking card. */
const Thread: React.FC<{reservation: Reservation; canWrite: boolean}> = ({reservation, canWrite}) => {
  const {data, refresh, mutate} = useLiveData<{messages: ReservationMessage[]}>(`/api/reservations/${reservation.id}/messages`, {
    intervalMs: 15000,
    topics: ['reservations']
  });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const messages = data?.messages || [];

  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  // Opening the thread reads it.
  useEffect(() => {
    if (reservation.unread) apiSend(`/api/reservations/${reservation.id}/read`, 'POST', {}).catch(() => {});
  }, [reservation.id, reservation.unread]);

  const send = async (value: string) => {
    const line = value.trim();
    if (!line || sending) return;
    setSending(true);
    try {
      const reply = await apiSend<{message: ReservationMessage}>(`/api/reservations/${reservation.id}/messages`, 'POST', {text: line});
      mutate((current) => ({messages: [...(current?.messages || []), reply.message]}));
      setText('');
      playSfx('chat_message');
      refresh();
    } catch (err) {
      toast.error('Nem ment el', (err as Error).message);
      playSfx('error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <div ref={listRef} className="rm-thread">
        {!messages.length && <p className="text-[10px] text-[#6f6968]">Még nincs üzenetváltás. Ami itt elhangzik, a vendég a foglalásainál látja.</p>}
        {messages.map((message) => (
          <div key={message.id} className={`rm-thread-msg${message.author === 'staff' ? ' is-mine' : ''}`}>
            {message.text}
            <small>
              {message.author === 'staff' ? message.authorName || 'Red Moon' : reservation.name} · {formatAgo(message.at)}
            </small>
          </div>
        ))}
      </div>
      {canWrite && canMessage(reservation.status) && (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {QUICK_REPLIES.map((line) => (
              <button key={line} type="button" onClick={() => send(line)} disabled={sending} className="rm-chip !px-2.5 !py-1.5 !text-[8px] !tracking-[0.08em] normal-case">
                {line}
              </button>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send(text);
            }}
            className="mt-3 flex gap-2"
          >
            <input value={text} onChange={(event) => setText(event.target.value.slice(0, 600))} placeholder="Üzenet a vendégnek…" className="rm-input"/>
            <Btn type="submit" variant="red" disabled={sending || !text.trim()}>
              <Send size={13}/>
            </Btn>
          </form>
        </>
      )}
    </div>
  );
};

export const StaffReservationsPage: React.FC = () => {
  const {data, refresh, mutate} = useLiveData<{reservations: Reservation[]}>('/api/reservations', {intervalMs: 20000, topics: ['reservations']});
  const user = useAuthStore((state) => state.user);
  const canDecide = roleAtLeast(user?.role, 'manager');

  const [filter, setFilter] = useState<Filter>('live');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [planWhen, setPlanWhen] = useState(defaultPlanWhen);
  const [planTableId, setPlanTableId] = useState<string | null>(null);
  const planAt = useMemo(() => {
    const date = new Date(planWhen);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }, [planWhen]);
  const floor = useFloorPlan(planAt);
  const plan = floor.data?.plan || null;
  const slot = floor.data?.slotMinutes || 150;

  const reservations = useMemo(() => data?.reservations || [], [data]);

  /** Tables promised: confirmed and seated bookings with a table, straight from the list. */
  const held = useMemo<HeldTable[]>(
    () =>
      reservations
        .filter((entry) => entry.tableId && (entry.status === 'confirmed' || entry.status === 'seated'))
        .map((entry) => ({
          tableId: entry.tableId!,
          from: entry.when,
          to: new Date(new Date(entry.when).getTime() + slot * 60000).toISOString(),
          id: entry.id,
          code: entry.code,
          name: entry.name,
          guests: entry.guests,
          status: entry.status
        })),
    [reservations, slot]
  );

  /** What the plan panel lists for its moment: who holds a table, and who asked for one. */
  const planRows = useMemo(() => {
    const from = planAt.getTime();
    const to = from + slot * 60000;
    const inWindow = (entry: Reservation) => windowsOverlap(from, to, new Date(entry.when).getTime(), new Date(entry.when).getTime() + slot * 60000);
    const onTable = (entry: Reservation) => !!entry.tableId && (!planTableId || entry.tableId === planTableId);
    return {
      holding: reservations.filter((entry) => onTable(entry) && (entry.status === 'confirmed' || entry.status === 'seated') && inWindow(entry)),
      asking: reservations.filter((entry) => onTable(entry) && ['pending', 'reviewing', 'waitlist'].includes(entry.status) && inWindow(entry))
    };
  }, [reservations, planAt, slot, planTableId]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return reservations
      .filter((reservation) => {
        if (filter === 'new' && reservation.status !== 'pending') return false;
        if (filter === 'unread' && !reservation.unread) return false;
        if (filter === 'live' && !['pending', 'reviewing', 'waitlist', 'confirmed'].includes(reservation.status)) return false;
        if (!needle) return true;
        return normalize(`${reservation.code} ${reservation.name} ${reservation.phone}`).includes(needle);
      })
      // Soonest first: the console is read in the order the door will need it.
      .sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
  }, [reservations, filter, query]);

  const counts = useMemo(
    () => ({
      pending: reservations.filter((r) => r.status === 'pending').length,
      reviewing: reservations.filter((r) => r.status === 'reviewing' || r.status === 'waitlist').length,
      confirmed: reservations.filter((r) => r.status === 'confirmed').length,
      guests: reservations.filter((r) => r.status === 'confirmed').reduce((sum, r) => sum + Number(r.guests || 0), 0),
      unread: reservations.reduce((sum, r) => sum + (r.unread || 0), 0),
      live: reservations.filter((r) => ['pending', 'reviewing', 'waitlist', 'confirmed'].includes(r.status)).length
    }),
    [reservations]
  );

  const decide = async (reservation: Reservation, status: ReservationStatus) => {
    if (busyId) return;
    setBusyId(reservation.id);
    // The card moves at once; the server's answer confirms it.
    mutate((current) => (current ? {reservations: current.reservations.map((entry) => (entry.id === reservation.id ? {...entry, status} : entry))} : current));
    try {
      await apiSend(`/api/reservations/${encodeURIComponent(reservation.id)}`, 'PATCH', {status});
      playSfx(status === 'declined' || status === 'noshow' ? 'decline' : 'accept');
      toast.success(`${reservation.code} · ${STATUS_LABEL[status]}`);
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  const assign = async (reservation: Reservation, tableId: string) => {
    if (busyId) return;
    setBusyId(reservation.id);
    try {
      const reply = await apiSend<{reservation: Reservation}>(`/api/reservations/${encodeURIComponent(reservation.id)}`, 'PATCH', {tableId});
      mutate((current) => (current ? {reservations: current.reservations.map((entry) => (entry.id === reservation.id ? {...entry, ...reply.reservation} : entry))} : current));
      toast.success(reply.reservation.tableLabel ? `${reservation.code} · ${reply.reservation.tableLabel}. asztal` : `${reservation.code} · bármelyik asztal`);
      playSfx('accept');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / ASZTALFOGLALÁSOK"
          title={
            <>
              A <em>foglalások.</em>
            </>
          }
          lead="Ami beérkezik, azt előbb megnézzük, aztán döntünk. A vendég minden lépést lát a saját oldalán, és ha kérdés van, itt írtok egymásnak."
          actions={
            <Btn variant={showPlan ? 'red' : 'outline'} onClick={() => setShowPlan((value) => !value)}>
              <LayoutGrid size={12}/> {showPlan ? 'ALAPRAJZ ELREJTÉSE' : 'ALAPRAJZ'}
            </Btn>
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <Stat label="BEÉRKEZETT" value={counts.pending} glyph="新" tone={counts.pending ? 'warn' : 'default'}/>
          <Stat label="NÉZZÜK / VÁRÓLISTA" value={counts.reviewing} glyph="覧"/>
          <Stat label="VISSZAIGAZOLVA" value={counts.confirmed} glyph="席" hint={`${counts.guests} vendég`}/>
          <Stat label="OLVASATLAN ÜZENET" value={counts.unread} glyph="信" tone={counts.unread ? 'warn' : 'default'}/>
        </div>

        {showPlan && plan && (
          <Panel
            className="mb-6"
            label="ALAPRAJZ"
            title="A terem, egy időpontra."
            action={<input type="datetime-local" value={planWhen} onChange={(event) => setPlanWhen(event.target.value)} className="rm-input !w-auto !py-2 !text-[11px]" aria-label="Időpont"/>}
          >
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
              <div>
                <FloorMap plan={plan} taken={held} at={planAt} slotMinutes={slot} selectedId={planTableId} onSelect={(table) => setPlanTableId((current) => (current === table.id ? null : table.id))}/>
                <FloorLegend staff className="mt-3"/>
              </div>
              <div className="flex flex-col gap-3">
                <span className="rm-label">
                  {formatTime(planAt)}–{formatTime(new Date(planAt.getTime() + slot * 60000))}
                  {planTableId ? ` · ${plan.tables.find((table) => table.id === planTableId)?.label || planTableId}. ASZTAL` : ' · MINDEN ASZTAL'}
                </span>
                {!planRows.holding.length && !planRows.asking.length && <p className="text-[11px] text-[#8d8584]">{planTableId ? 'Szabad ekkor, és senki sem kérte.' : 'Ekkor egyetlen asztal sincs elígérve.'}</p>}
                {planRows.holding.map((entry) => (
                  <div key={entry.id} className="border border-[color:var(--rm-line-red)] bg-[rgba(227,40,78,0.06)] px-4 py-3">
                    <strong className="font-heading text-[14px] text-white">
                      {entry.tableLabel}. asztal · {entry.code}
                    </strong>
                    <span className="mt-1 block text-[10px] text-[#c9c2c1]">
                      {entry.name} · {entry.guests} fő · {formatTime(entry.when)}–{formatTime(new Date(new Date(entry.when).getTime() + slot * 60000))} · {STATUS_LABEL[entry.status]}
                    </span>
                  </div>
                ))}
                {planRows.asking.map((entry) => (
                  <div key={entry.id} className="border border-white/10 px-4 py-3">
                    <strong className="font-heading text-[14px] text-[#c9c2c1]">
                      {entry.tableLabel}. asztal · {entry.code}
                    </strong>
                    <span className="mt-1 block text-[10px] text-[#8d8584]">
                      kérés · {entry.name} · {entry.guests} fő · {formatTime(entry.when)} · {STATUS_LABEL[entry.status]}
                    </span>
                  </div>
                ))}
                <p className="mt-auto text-[9px] leading-[1.6] text-[#6f6968]">Csak a visszaigazolt és leültetett foglalás tart asztalt; a kérés nem. Az asztalt a foglalásnál a listából adod.</p>
              </div>
            </div>
          </Panel>
        )}

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchField value={query} onChange={setQuery} placeholder="KÓD, NÉV VAGY TELEFONSZÁM…" className="sm:max-w-xs"/>
          <Chips
            value={filter}
            onChange={setFilter}
            options={[
              {id: 'live', label: 'ÉLŐ', count: counts.live},
              {id: 'new', label: 'ÚJ', count: counts.pending},
              {id: 'unread', label: 'ÜZENET', count: counts.unread},
              {id: 'all', label: 'ÖSSZES', count: reservations.length}
            ]}
          />
        </div>

        <div className="flex flex-col gap-2.5">
          {!visible.length && <p className="rm-card p-6 text-[11px] text-[#8d8584]">Nincs foglalás ezzel a szűréssel.</p>}

          {visible.map((reservation) => {
            const actions = ACTIONS[reservation.status];
            const open = openId === reservation.id;
            return (
              <article key={reservation.id} className={`rm-card p-6 ${busyId === reservation.id ? 'opacity-70' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <strong className="font-heading text-[20px] text-white">{reservation.code}</strong>
                      <span className={`border px-2.5 py-1 text-[8px] tracking-[0.18em] ${STATUS_CLASS[reservation.status]}`}>{STATUS_LABEL[reservation.status].toUpperCase()}</span>
                      {reservation.tier !== 'none' && (
                        <Badge tone="red">
                          HOUSE · {TIER_LABEL[reservation.tier].toUpperCase()}
                          {reservation.memberName ? ` · ${reservation.memberName}` : ''}
                        </Badge>
                      )}
                      {reservation.tableLabel ? (
                        <Badge tone="sky">
                          <Armchair size={10}/> {reservation.tableLabel}. ASZTAL
                        </Badge>
                      ) : (
                        <Badge tone="muted">
                          <Armchair size={10}/> BÁRMELYIK ASZTAL
                        </Badge>
                      )}
                      {!!reservation.unread && <span className="rm-unread">{reservation.unread}</span>}
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
                      {reservation.updatedAt ? ` · ${formatAgo(reservation.updatedAt)}` : ''}
                    </p>

                    {reservation.note && (
                      <p className="mt-3 max-w-xl border-l border-[color:var(--rm-line-red)] pl-3 text-[11px] leading-[1.8] text-[#a09998]">{reservation.note}</p>
                    )}

                    <div className="mt-4">
                      <Pipeline status={reservation.status}/>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : reservation.id)}
                    className={`rm-btn is-ghost !px-3 !py-2 !text-[8px]${open ? ' is-active' : ''}`}
                    aria-expanded={open}
                  >
                    <MessageSquare size={11}/> {reservation.messageCount ? `${reservation.messageCount} ÜZENET` : 'ÜZENET'}
                    {!!reservation.unread && <span className="rm-unread">{reservation.unread}</span>}
                  </button>
                </div>

                {reservation.lastMessage && !open && (
                  <p className="mt-3 truncate text-[10px] text-[#8d8584]">
                    <span className="text-[#5f5959]">{reservation.lastMessage.author === 'guest' ? reservation.name : 'Red Moon'}:</span> {reservation.lastMessage.text}
                  </p>
                )}

                {open && <Thread reservation={reservation} canWrite={canDecide}/>}

                {canDecide && actions.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.06] pt-5">
                    {plan && (
                      <select
                        value={reservation.tableId || ''}
                        onChange={(event) => assign(reservation, event.target.value)}
                        disabled={busyId === reservation.id}
                        className="rm-input !w-auto !py-2 !text-[9px] !tracking-[0.15em]"
                        aria-label="Asztal"
                      >
                        <option value="">BÁRMELYIK ASZTAL</option>
                        {plan.tables
                          .filter((table) => table.active !== false)
                          .map((table) => {
                            const clash = tableClashes(table, new Date(reservation.when), slot, held).find((entry) => (entry as HeldTable).id !== reservation.id) as HeldTable | undefined;
                            return (
                              <option key={table.id} value={table.id} disabled={!!clash}>
                                {table.label} · {table.seats} fő{clash ? ` · FOGLALT (${clash.code})` : reservation.guests > table.seats ? ' · kicsi' : ''}
                              </option>
                            );
                          })}
                      </select>
                    )}
                    {actions.map((action) => (
                      <Btn
                        key={action}
                        type="button"
                        variant={action === 'confirmed' ? 'red' : 'outline'}
                        disabled={busyId === reservation.id}
                        onClick={() => decide(reservation, action)}
                        className="!px-4 !py-2.5 !text-[8px]"
                      >
                        {action === 'confirmed' ? <Check size={11}/> : action === 'declined' ? <X size={11}/> : null}
                        {ACTION_LABEL[action]}
                      </Btn>
                    ))}
                  </div>
                )}

                {!canDecide && (
                  <p className="mt-4 border-t border-white/[0.06] pt-4 text-[9px] tracking-[0.18em] text-[#777]">A FOGLALÁSOK ELBÍRÁLÁSÁHOZ MANAGER JOG KELL.</p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
};
