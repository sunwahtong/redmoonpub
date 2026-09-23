import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {CalendarClock, Check, MessageSquare, Phone, Send, Users, X} from 'lucide-react';
import {NeonHeading} from '../components/ui/NeonHeading';
import {Btn} from '../components/ui/Btn';
import {Magnetic} from '../components/ui/Magnetic';
import {SplitReveal} from '../components/ui/SplitReveal';
import {Reveal} from '../components/ui/Reveal';
import {Embers} from '../components/effects/Embers';
import {apiGet, apiSend, formatAgo, formatDate, formatTime, getVisitorToken} from '../lib/api';
import {useLiveEvent} from '../hooks/useLiveData';
import {playSfx} from '../lib/sfx';
import {dialog} from '../stores/useDialogStore';
import {toast} from '../stores/useToastStore';
import {
  canMessage,
  isLive,
  OCCASION_GLYPH,
  OCCASION_LABEL,
  PIPELINE,
  pipelineIndex,
  STATUS_CLASS,
  STATUS_HINT,
  STATUS_LABEL,
  TIER_LABEL,
  type Reservation,
  type ReservationMessage,
  type ReservationOccasion,
  type ReservationTier
} from '../lib/reservations';

const PHONE_PREFIX = '+38-76-';
const STEPS = ['ALKALOM', 'TÁRSASÁG', 'IDŐPONT', 'ELÉRHETŐSÉG'] as const;

const OCCASIONS = Object.keys(OCCASION_LABEL) as ReservationOccasion[];
const TIERS = Object.keys(TIER_LABEL) as ReservationTier[];

/** `datetime-local` wants a local "YYYY-MM-DDTHH:mm" with no timezone suffix. */
function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

/** Tonight at 21:00, or tomorrow at 21:00 once tonight has already started. */
function defaultWhen(): string {
  const date = new Date();
  if (date.getHours() >= 20) date.setDate(date.getDate() + 1);
  date.setHours(21, 0, 0, 0);
  return toLocalInputValue(date);
}

/** One of the guest's bookings: where it stands, and the line to the house. */
const BookingCard: React.FC<{reservation: Reservation; token: string; onCancel: () => void; onChanged: () => void}> = ({reservation, token, onCancel, onChanged}) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const messages = reservation.messages || [];
  const index = pipelineIndex(reservation.status);
  const bad = ['declined', 'noshow', 'cancelled'].includes(reservation.status);

  useEffect(() => {
    if (!open) return;
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    if (reservation.unread) apiSend(`/api/reservations/${reservation.id}/read`, 'POST', {visitorToken: token}).then(onChanged).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, messages.length]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const line = text.trim();
    if (!line || sending) return;
    setSending(true);
    try {
      await apiSend<{message: ReservationMessage}>(`/api/reservations/${reservation.id}/messages`, 'POST', {visitorToken: token, text: line});
      setText('');
      playSfx('chat_message');
      onChanged();
    } catch (err) {
      playSfx('error');
      toast.error('Nem ment el', (err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border border-white/[0.07] bg-black/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <strong className="font-heading text-[15px] text-white">{reservation.code}</strong>
        <span className={`border px-2 py-1 text-[8px] tracking-[0.18em] ${STATUS_CLASS[reservation.status]}`}>{STATUS_LABEL[reservation.status].toUpperCase()}</span>
      </div>
      <p className="mt-2 text-[10px] text-[#8d8584]">
        {formatDate(reservation.when)} · {formatTime(reservation.when)} · {reservation.guests} fő
      </p>
      <p className="mt-2 text-[10px] leading-[1.7] text-[#c9c2c1]">{STATUS_HINT[reservation.status]}</p>

      <div className="rm-pipeline mt-3">
        {PIPELINE.map((stage, position) => (
          <span key={stage.id} className={`rm-pipeline-step${position < index ? ' is-done' : ''}${position === index ? (bad ? ' is-bad' : ' is-current') : ''}`}>
            {stage.label}
          </span>
        ))}
      </div>

      {reservation.staffNote && (
        <p className="mt-3 border-l border-[color:var(--rm-line-red)] pl-2.5 text-[10px] leading-[1.7] text-[#c9c2c1]">{reservation.staffNote}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.18em] text-[#c9c2c1] hover:text-white">
          <MessageSquare size={10}/> {messages.length ? `${messages.length} ÜZENET` : 'ÜZENET A HÁZNAK'}
          {!!reservation.unread && <span className="rm-unread">{reservation.unread}</span>}
        </button>
        {isLive(reservation.status) && (
          <button type="button" onClick={onCancel} className="text-[9px] tracking-[0.18em] text-[#777] underline-offset-4 transition-colors hover:text-[color:var(--rm-red)] hover:underline">
            LEMONDÁS
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <div ref={listRef} className="rm-thread">
            {!messages.length && <p className="text-[10px] text-[#6f6968]">Írj, ha kérdésed van: allergia, ülésrend, meglepetés. A ház itt válaszol.</p>}
            {messages.map((message) => (
              <div key={message.id} className={`rm-thread-msg${message.author === 'guest' ? ' is-mine' : ''}`}>
                {message.text}
                <small>
                  {message.author === 'guest' ? 'Te' : message.authorName || 'Red Moon'} · {formatAgo(message.at)}
                </small>
              </div>
            ))}
          </div>
          {canMessage(reservation.status) ? (
            <form onSubmit={send} className="mt-3 flex gap-2">
              <input value={text} onChange={(event) => setText(event.target.value.slice(0, 600))} placeholder="Üzenet a háznak…" className="rm-input !py-2.5 !text-[11px]"/>
              <Btn type="submit" variant="red" disabled={sending || !text.trim()} className="!px-3">
                <Send size={12}/>
              </Btn>
            </form>
          ) : (
            <p className="mt-3 text-[9px] tracking-[0.15em] text-[#5f5959]">EZ A FOGLALÁS LEZÁRULT.</p>
          )}
        </div>
      )}
    </div>
  );
};

export const ReservationsPage: React.FC = () => {
  const [step, setStep] = useState(0);
  const [occasion, setOccasion] = useState<ReservationOccasion>('este');
  const [guests, setGuests] = useState(2);
  const [tier, setTier] = useState<ReservationTier>('none');
  const [when, setWhen] = useState(defaultWhen);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(PHONE_PREFIX);
  const [note, setNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<Reservation | null>(null);
  const [mine, setMine] = useState<Reservation[]>([]);

  const token = useMemo(() => getVisitorToken(), []);

  const loadMine = useCallback(async () => {
    try {
      const data = await apiGet<{reservations: Reservation[]}>(
        `/api/reservations/mine?token=${encodeURIComponent(token)}`
      );
      setMine(data.reservations || []);
    } catch {
      /* Not being able to list past bookings must not block making a new one. */
    }
  }, [token]);

  useEffect(() => {
    loadMine();
    const timer = window.setInterval(() => {
      if (!document.hidden) loadMine();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [loadMine]);

  // A decision or a reply from the house lands here without a reload.
  useLiveEvent('reservations', () => loadMine());

  const minWhen = useMemo(() => toLocalInputValue(new Date(Date.now() + 45 * 60000)), []);
  const maxWhen = useMemo(() => toLocalInputValue(new Date(Date.now() + 60 * 86400000)), []);

  const phoneDigits = phone.startsWith(PHONE_PREFIX) ? phone.slice(PHONE_PREFIX.length) : '';
  const canSubmit = name.trim().length >= 2 && phoneDigits.length === 7 && !!when;

  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const digits = raw.startsWith(PHONE_PREFIX) ? raw.slice(PHONE_PREFIX.length).replace(/\D/g, '').slice(0, 7) : '';
    setPhone(PHONE_PREFIX + digits);
  };

  const go = (next: number) => {
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
    playSfx('ui_click');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !canSubmit) return;

    setBusy(true);
    setError('');
    try {
      const result = await apiSend<{reservation: Reservation}>('/api/reservations', 'POST', {
        name: name.trim(),
        phone: phoneDigits,
        guests,
        // `datetime-local` has no timezone, so build a real Date from the local
        // value and send an absolute instant the server can trust.
        at: new Date(when).toISOString(),
        occasion,
        tier,
        note: note.trim(),
        visitorToken: token
      });
      setConfirmed(result.reservation);
      playSfx('success');
      loadMine();
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (reservation: Reservation) => {
    const sure = await dialog.confirm({
      title: 'Lemondod a foglalást?',
      message: `A(z) ${reservation.code} azonosítójú foglalás megszűnik. Újat bármikor kérhetsz.`,
      confirmLabel: 'LEMONDÁS',
      tone: 'danger'
    });
    if (!sure) return;
    try {
      await apiSend(`/api/reservations/${encodeURIComponent(reservation.id)}`, 'DELETE', {visitorToken: token});
      playSfx('delete');
      loadMine();
      if (confirmed?.id === reservation.id) setConfirmed(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const restart = () => {
    setConfirmed(null);
    setStep(0);
    setNote('');
    playSfx('open');
  };

  return (
    <main>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-[color:var(--rm-line)] bg-[#070709] px-[8vw] pb-16 pt-[168px]">
        <Embers density={40}/>
        <div className="relative z-[2]">
          <div className="rm-label">RED MOON / ASZTALFOGLALÁS</div>
          <h1 className="rm-heading rm-display-1 my-5">
            <SplitReveal text="FOGLALJ"/>
            <br/>
            <em>
              <SplitReveal text="asztalt." delay={220}/>
            </em>
          </h1>
          <p className="max-w-[560px] text-sm leading-[1.9] text-[#aaa]">
            A Red Moon estéi korlátozott számú asztallal futnak. Mondd el, mikor és hányan jöttök — a többit elintézzük.
          </p>
        </div>
      </section>

      <section className="rm-section">
        <div className="grid grid-cols-1 gap-[6vw] lg:grid-cols-[1fr_360px]">
          {/* ------------------------------------------------ FORM */}
          <div>
            {confirmed ? (
              <div className="relative flex flex-col items-center border border-[color:var(--rm-line-red)] bg-[#0a0508] px-8 py-16 text-center">
                <div className="rm-seal relative">
                  <span className="text-[34px] leading-none">月</span>
                </div>
                <div className="rm-label mt-8">FOGLALÁS RÖGZÍTVE</div>
                <NeonHeading as="h2" size={2} className="mt-3">
                  Várunk <em>téged.</em>
                </NeonHeading>

                <p className="mt-5 max-w-md text-[12px] leading-[1.9] text-[#9e9795]">
                  Megkaptuk. Előbb ránézünk, aztán döntünk — minden lépést látsz a foglalásaidnál, és ha kérdésed van, ott írhatsz nekünk.
                </p>

                <div className="mt-8 w-full max-w-sm border border-[color:var(--rm-line)] bg-black/40">
                  {[
                    ['AZONOSÍTÓ', confirmed.code],
                    ['IDŐPONT', `${formatDate(confirmed.when)} · ${formatTime(confirmed.when)}`],
                    ['VENDÉGEK', `${confirmed.guests} fő`],
                    ['ALKALOM', OCCASION_LABEL[confirmed.occasion]]
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5 last:border-b-0"
                    >
                      <span className="text-[8px] tracking-[0.25em] text-[#777]">{label}</span>
                      <strong className="font-heading text-[15px] text-white">{value}</strong>
                    </div>
                  ))}
                </div>

                <p className="mt-6 text-[10px] leading-[1.8] text-[#777]">
                  Írd fel az azonosítót. A bejáratnál ezt kérjük.
                </p>

                <div className="mt-8 flex flex-wrap justify-center gap-2.5">
                  <Btn onClick={restart}>ÚJ FOGLALÁS</Btn>
                  <Btn variant="red" onClick={() => cancel(confirmed)}>
                    LEMONDÁS <X size={13}/>
                  </Btn>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="border border-[color:var(--rm-line)] bg-[#09090b] p-8 md:p-11">
                {/* Step rail */}
                <ol className="mb-9 grid grid-cols-2 gap-x-6 sm:grid-cols-4">
                  {STEPS.map((label, index) => (
                    <li
                      key={label}
                      className={`rm-step ${index < step ? 'is-done' : ''} ${index === step ? 'is-current' : ''}`}
                    >
                      <span className="rm-step-dot" aria-hidden="true"/>
                      <span
                        className={`text-[8px] tracking-[0.22em] ${
                          index <= step ? 'text-white' : 'text-[#5f5959]'
                        }`}
                      >
                        {label}
                      </span>
                    </li>
                  ))}
                </ol>

                {/* 1 — occasion */}
                {step === 0 && (
                  <div>
                    <NeonHeading as="h2" size={3}>
                      Milyen <em>alkalom?</em>
                    </NeonHeading>
                    <p className="mb-7 mt-3 text-[11px] leading-[1.8] text-[#8d8584]">
                      Ez dönti el, hogyan készítjük elő az asztalt.
                    </p>

                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      {OCCASIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => {
                            setOccasion(option);
                            playSfx('ui_click');
                          }}
                          aria-pressed={occasion === option}
                          className={`group relative overflow-hidden border p-5 text-left transition-all ${
                            occasion === option
                              ? 'border-[color:var(--rm-red)] bg-[rgba(227,40,78,0.08)]'
                              : 'border-white/10 hover:border-white/30'
                          }`}
                        >
                          <span
                            className="pointer-events-none absolute -right-2 -top-3 font-heading text-[54px] leading-none text-[rgba(227,40,78,0.16)] transition-transform duration-500 group-hover:scale-110"
                            aria-hidden="true"
                          >
                            {OCCASION_GLYPH[option]}
                          </span>
                          <span className="relative block text-[10px] font-bold leading-[1.5] tracking-[0.12em] text-white">
                            {OCCASION_LABEL[option]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2 — party */}
                {step === 1 && (
                  <div>
                    <NeonHeading as="h2" size={3}>
                      Hányan <em>érkeztek?</em>
                    </NeonHeading>
                    <p className="mb-7 mt-3 text-[11px] leading-[1.8] text-[#8d8584]">
                      Húsz főnél nagyobb társaságot külön kezelünk — írd meg a megjegyzésbe.
                    </p>

                    <div className="flex items-center gap-4">
                      <Btn type="button" onClick={() => setGuests((value) => Math.max(1, value - 1))}>
                        −
                      </Btn>
                      <div className="flex min-w-[130px] flex-col items-center">
                        <strong className="font-heading text-[58px] leading-none text-white">{guests}</strong>
                        <span className="mt-1 text-[8px] tracking-[0.25em] text-[#777]">FŐ</span>
                      </div>
                      <Btn type="button" onClick={() => setGuests((value) => Math.min(20, value + 1))}>
                        +
                      </Btn>
                    </div>

                    <div className="rm-gilt my-9"/>

                    <span className="text-[8px] tracking-[0.25em] text-[#777]">RED MOON TAGSÁG</span>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {TIERS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setTier(option)}
                          aria-pressed={tier === option}
                          className={`border px-4 py-2.5 text-[9px] font-bold tracking-[0.2em] transition-all ${
                            tier === option
                              ? 'border-[color:var(--rm-red)] bg-[rgba(227,40,78,0.12)] text-white'
                              : 'border-white/10 text-[#8f8887] hover:border-white/30'
                          }`}
                        >
                          {TIER_LABEL[option].toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3 — when */}
                {step === 2 && (
                  <div>
                    <NeonHeading as="h2" size={3}>
                      Mikor <em>jöttök?</em>
                    </NeonHeading>
                    <p className="mb-7 mt-3 text-[11px] leading-[1.8] text-[#8d8584]">
                      Legkorábban negyvenöt perc múlva, legfeljebb hatvan nappal előre.
                    </p>

                    <label className="flex flex-col gap-2">
                      <span className="text-[8px] tracking-[0.25em] text-[#777]">DÁTUM ÉS IDŐ</span>
                      <input
                        type="datetime-local"
                        value={when}
                        min={minWhen}
                        max={maxWhen}
                        onChange={(event) => setWhen(event.target.value)}
                        required
                        className="border border-white/10 bg-black/50 p-4 text-[13px] tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)] [color-scheme:dark]"
                      />
                    </label>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {[
                        {label: 'MA 21:00', days: 0, hour: 21},
                        {label: 'MA 23:00', days: 0, hour: 23},
                        {label: 'HOLNAP 21:00', days: 1, hour: 21},
                        {label: 'PÉNTEK 22:00', days: (5 - new Date().getDay() + 7) % 7 || 7, hour: 22}
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            const date = new Date();
                            date.setDate(date.getDate() + preset.days);
                            date.setHours(preset.hour, 0, 0, 0);
                            setWhen(toLocalInputValue(date));
                            playSfx('ui_click');
                          }}
                          className="border border-white/10 px-3.5 py-2 text-[9px] tracking-[0.18em] text-[#8f8887] transition-colors hover:border-[color:var(--rm-red)] hover:text-white"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4 — contact */}
                {step === 3 && (
                  <div>
                    <NeonHeading as="h2" size={3}>
                      Kit <em>várunk?</em>
                    </NeonHeading>
                    <p className="mb-7 mt-3 text-[11px] leading-[1.8] text-[#8d8584]">
                      A telefonszámon értesítünk, ha az asztal készen áll.
                    </p>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-2">
                        <span className="text-[8px] tracking-[0.25em] text-[#777]">NÉV</span>
                        <input
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          required
                          maxLength={80}
                          className="border border-white/10 bg-black/50 p-3.5 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]"
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-[8px] tracking-[0.25em] text-[#777]">TELEFONSZÁM</span>
                        <input
                          value={phone}
                          onChange={handlePhoneChange}
                          inputMode="numeric"
                          required
                          className="border border-white/10 bg-black/50 p-3.5 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]"
                        />
                      </label>
                    </div>

                    <label className="mt-3 flex flex-col gap-2">
                      <span className="text-[8px] tracking-[0.25em] text-[#777]">MEGJEGYZÉS (OPCIONÁLIS)</span>
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value.slice(0, 400))}
                        rows={3}
                        placeholder="Allergia, ülésrend, meglepetés…"
                        className="border border-white/10 bg-black/50 p-3.5 text-xs tracking-wider text-white outline-none transition-colors placeholder:text-white/25 focus:border-[color:var(--rm-red)]"
                      />
                    </label>

                    {/* Summary */}
                    <div className="mt-7 border border-[color:var(--rm-line)] bg-black/40 p-5">
                      <span className="rm-label">ÖSSZEGZÉS</span>
                      <div className="mt-3 flex flex-wrap gap-x-7 gap-y-2 text-[11px] text-[#c9c2c1]">
                        <span className="inline-flex items-center gap-2">
                          <CalendarClock size={12} className="text-[color:var(--rm-red)]"/>
                          {when ? `${formatDate(when)} · ${formatTime(when)}` : '—'}
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <Users size={12} className="text-[color:var(--rm-red)]"/>
                          {guests} fő
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <Phone size={12} className="text-[color:var(--rm-red)]"/>
                          {phoneDigits.length === 7 ? phone : 'hiányzik'}
                        </span>
                        <span>{OCCASION_LABEL[occasion]}</span>
                        {tier !== 'none' && <span className="text-[color:var(--rm-red)]">{TIER_LABEL[tier]}</span>}
                      </div>
                    </div>
                  </div>
                )}

                {error && <p className="mt-5 text-[11px] text-[color:var(--rm-red)]">{error}</p>}

                <div className="mt-9 flex items-center justify-between gap-3">
                  <Btn type="button" onClick={() => go(step - 1)} disabled={step === 0}>
                    ← VISSZA
                  </Btn>

                  {step < STEPS.length - 1 ? (
                    <Magnetic>
                      <Btn type="button" variant="red" onClick={() => go(step + 1)}>
                        TOVÁBB <span>→</span>
                      </Btn>
                    </Magnetic>
                  ) : (
                    <Magnetic>
                      <Btn type="submit" variant="red" disabled={busy || !canSubmit}>
                        {busy ? 'KÜLDÉS…' : 'FOGLALÁS KÉRÉSE'} <Check size={13}/>
                      </Btn>
                    </Magnetic>
                  )}
                </div>
              </form>
            )}
          </div>

          {/* ------------------------------------------------ SIDEBAR */}
          <aside className="flex flex-col gap-3.5">
            <Reveal>
              <div className="border border-[color:var(--rm-line)] bg-[#09090b] p-6">
                <span className="rm-label">A FOGLALÁSAID</span>
                {mine.length === 0 ? (
                  <p className="mt-3 text-[10px] leading-[1.8] text-[#777]">
                    Itt jelenik meg minden foglalásod ebből a böngészőből. Nem kell regisztrálnod.
                  </p>
                ) : (
                  <div className="mt-4 flex flex-col gap-2.5">
                    {mine.map((reservation) => (
                      <BookingCard key={reservation.id} reservation={reservation} token={token} onCancel={() => cancel(reservation)} onChanged={loadMine}/>
                    ))}
                  </div>
                )}
              </div>
            </Reveal>

            <Reveal delay={90}>
              <div className="relative overflow-hidden border border-[color:var(--rm-line)] bg-[#0a0a0c] p-6">
                <span className="rm-glyph">月</span>
                <span className="rm-label relative">A HÁZ SZABÁLYAI</span>
                <ul className="relative mt-4 flex flex-col gap-3 text-[10px] leading-[1.7] text-[#8d8584]">
                  {[
                    'Az asztalt a foglalás után harminc percig tartjuk.',
                    'Tizenkét fő fölött a manager visszahív egyeztetni.',
                    'A Red Moon tagság elsőbbséget ad telt estéken.',
                    'Lemondani bármikor lehet, itt a foglalásaidnál.',
                    'Kérdésed van? A foglalásodnál üzenhetsz a háznak.'
                  ].map((rule) => (
                    <li key={rule} className="flex gap-2.5">
                      <span className="mt-[6px] h-1 w-1 shrink-0 bg-[color:var(--rm-red)]" aria-hidden="true"/>
                      {rule}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </aside>
        </div>
      </section>
    </main>
  );
};
