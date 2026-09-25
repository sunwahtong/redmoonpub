import React, {useEffect, useRef, useState} from 'react';
import {Check, Lock, MessageSquare, Phone, Send, Users} from 'lucide-react';
import {Btn, BtnLink} from '../components/ui/Btn';
import {Reveal} from '../components/ui/Reveal';
import {SectionHead} from '../components/ui/SectionHead';
import {Embers} from '../components/effects/Embers';
import {EventCard, type EventPhase} from '../components/events/EventCard';
import {DrinkCard} from '../components/menu/DrinkCard';
import {HouseLookup, type HouseCard} from '../components/house/HouseLookup';
import {CardScene} from '../components/house/CardStage';
import {TierChip} from '../components/house/TierChip';
import {useLiveData} from '../hooks/useLiveData';
import {apiSend, formatDate, formatTime} from '../lib/api';
import {MEMBERSHIP} from '../lib/content';
import {RANK, tierMeta, type Tier} from '../lib/houseCard';
import {clearHouseSession, storedHouseSession, type HouseSession} from '../lib/houseSession';
import {playSfx} from '../lib/sfx';
import {toast} from '../stores/useToastStore';
import type {PublicProduct, RedMoonEvent} from '../types';

type MessageKind = 'uzenet' | 'privat-sarok' | 'rendezveny' | 'a-haz-egy-estere';

interface LoungeMessage {
  id: string;
  at: string;
  fromHouse: boolean;
  byName: string;
  kind: MessageKind;
  text: string;
  meta: {date?: string; guests?: number};
  readAt: string | null;
}

interface Booking {
  id: string;
  code: string;
  when: string;
  guests: number;
  status: string;
  tableLabel: string;
  guestList: string[];
}

interface Lounge {
  member: HouseCard;
  rooms: {invitations: boolean; secretMenu: boolean; djPriority: boolean; line: boolean; requests: boolean; buyout: boolean; guestList: boolean; ownDrink: boolean};
  invitations: RedMoonEvent[];
  secretMenu: PublicProduct[];
  ownDrinks: PublicProduct[];
  messages: LoungeMessage[];
  unread: number;
  bookings: Booking[];
  contact: {name: string; title: string; phone: string} | null;
  house: {name: string; address: string; phone: string};
}

const KIND_LABEL: Record<MessageKind, string> = {uzenet: 'ÜZENET', 'privat-sarok': 'PRIVÁT SAROK', rendezveny: 'RENDEZVÉNY', 'a-haz-egy-estere': 'A HÁZ EGY ESTÉRE'};
const STATUS_LABEL: Record<string, string> = {pending: 'VÁR', confirmed: 'MEGERŐSÍTVE', seated: 'ASZTALNÁL'};

/** What each tier opens, in the order the ladder shows it. */
const ROOMS: {tier: Tier; label: string; text: string}[] = [
  {tier: 'silver', label: 'Meghívások', text: 'Zárt körű esték, amiket csak a House lát — és ott leszek egy koppintással.'},
  {tier: 'gold', label: 'Titkos itallap és a pult füle', text: 'Italok, amik nincsenek az itallapon. A DJ pult a te kérésedet veszi előre, a chatben a neved mellett ott a címered.'},
  {tier: 'black', label: 'A ház vonala', text: 'Saját kapcsolattartó, üzenet a háznak, privát sarok és rendezvény kérése innen.'},
  {tier: 'royal', label: 'A tiéd', text: 'Vendéglista a foglalásodra, saját ital a neveddel, a ház egy estére — és a tulajdonos közvetlen vonala.'}
];

const phaseOf = (event: RedMoonEvent): EventPhase => {
  const start = new Date(event.startsAt).getTime();
  const end = event.endsAt ? new Date(event.endsAt).getTime() : start + 4 * 3600000;
  const now = Date.now();
  return now < start ? 'upcoming' : now < end ? 'live' : 'past';
};

/** The House's inner rooms: a member's card opens as much as its tier allows. */
export const HousePage: React.FC = () => {
  const [session, setSession] = useState<HouseSession | null>(storedHouseSession);
  const token = session?.token || '';
  const {data, error, mutate} = useLiveData<Lounge>(`/api/lounge?token=${encodeURIComponent(token)}`, {intervalMs: 90000, topics: ['content', 'events', 'reservations'], enabled: !!token});

  /* A card that no longer opens the room (expired, suspended) sends the member back to the lookup. */
  useEffect(() => {
    if (!token || data || !error) return;
    clearHouseSession();
    setSession(null);
  }, [token, data, error]);

  /* Seeing the house's replies counts as reading them. */
  useEffect(() => {
    if (!data?.unread || !token) return;
    apiSend('/api/lounge/read', 'POST', {token})
      .then(() => mutate((current) => (current ? {...current, unread: 0, messages: current.messages.map((message) => (message.fromHouse ? {...message, readAt: message.readAt || new Date().toISOString()} : message))} : current)))
      .catch(() => {});
  }, [data?.unread, token, mutate]);

  const leave = () => {
    clearHouseSession();
    setSession(null);
    playSfx('ui_click');
  };

  if (!token) return <Gate onOpen={() => setSession(storedHouseSession())}/>;
  if (!data) {
    return (
      <main>
        <section className="rm-section">
          <p className="text-[11px] text-[#8d8584]">A belső szoba nyílik…</p>
        </section>
      </main>
    );
  }

  const {member, rooms} = data;
  const meta = tierMeta(member.tier);
  const first = member.name.trim().split(/\s+/)[0] || member.name;
  const rank = RANK[member.tier];

  return (
    <main className="rm-lounge" style={{'--mc-ink': meta.ink, '--mc-glow': meta.glow} as React.CSSProperties}>
      <section className="relative overflow-hidden border-b border-[color:var(--rm-line)] bg-[#060406] px-[8vw] pb-16 pt-[150px]">
        <Embers density={26}/>
        <div className="rm-lounge-glow" aria-hidden="true"/>
        <div className="relative z-[2] grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="rm-label">RED MOON / A HOUSE BELSŐ SZOBÁJA</div>
            <h1 className="rm-heading rm-display-2 my-5">
              Jó estét, <em>{first}.</em>
            </h1>
            <p className="max-w-[560px] text-sm leading-[1.9] text-[#aaa]">
              {meta.tagline} A kártyád {meta.name} — {member.visits} este a házban, tag {formatDate(member.grantedAt)} óta. Ez a szoba a tiéd: ami itt van, azt csak a House látja.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <TierChip tier={member.tier}/>
              <span className="font-heading text-[13px] tracking-[0.2em] text-white">{member.code}</span>
              {data.contact && (
                <span className="inline-flex items-center gap-2 text-[10px] tracking-[0.12em] text-[#c9c2c1]">
                  <Phone size={11} className="text-[color:var(--mc-ink)]"/> {data.contact.name} · {data.contact.title}
                  {data.contact.phone ? ` · ${data.contact.phone}` : ''}
                </span>
              )}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <BtnLink to={`/reservations?member=${encodeURIComponent(member.code)}`} variant="red">
                FOGLALÁS A KÓDDAL ↗
              </BtnLink>
              <BtnLink to="/club">A KLUB ↗</BtnLink>
              <button type="button" onClick={leave} className="rm-btn">
                KILÉPÉS
              </button>
            </div>
          </div>
          <Reveal delay={120}>
            <CardScene member={member} className="rm-lounge-card"/>
          </Reveal>
        </div>
      </section>

      <section className="rm-section">
        <SectionHead
          label="01 / MEGHÍVÁSAID"
          title={
            <>
              Esték, amiket
              <br />
              <em>csak a House lát.</em>
            </>
          }
          aside="Zárt körű programok. Az „ott leszek” itt is számít: a ház tudja, hányan jönnek."
        />
        {data.invitations.length ? (
          <div className="rm-spine">
            {data.invitations.map((event, index) => (
              <Reveal key={event.id} delay={index * 80} className="rm-spine-node" data-phase={phaseOf(event)}>
                <EventCard event={event} phase={phaseOf(event)} featured={index === 0}/>
              </Reveal>
            ))}
          </div>
        ) : (
          <p className="rm-card p-8 text-[11px] leading-[1.8] text-[#8d8584]">Most nincs zárt körű este kiírva. Amint a ház tervez egyet a {meta.name} körnek, itt látod először — a nyilvános oldalon soha.</p>
        )}
      </section>

      <section className="border-y border-[color:var(--rm-line)] bg-[#070709]">
        <div className="rm-section">
          <SectionHead
            label="02 / TITKOS ITALLAP"
            title={
              <>
                Ami nincs
                <br />
                <em>az itallapon.</em>
              </>
            }
            aside={rooms.secretMenu ? 'Kérd a pultnál a nevén. A pult tudja, hogy tag vagy.' : 'Gold szinttől nyílik.'}
          />
          {rooms.secretMenu ? (
            <>
              {data.ownDrinks.length > 0 && (
                <div className="mb-8">
                  <span className="rm-label">A TE ITALOD · A NEVEDDEL A LAPON</span>
                  <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                    {data.ownDrinks.map((product, index) => (
                      <DrinkCard key={product.id} product={product} index={index}/>
                    ))}
                  </div>
                </div>
              )}
              {data.secretMenu.length ? (
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                  {data.secretMenu.map((product, index) => (
                    <DrinkCard key={product.id} product={product} index={index}/>
                  ))}
                </div>
              ) : (
                <p className="rm-card p-8 text-[11px] leading-[1.8] text-[#8d8584]">A titkos lap most üres — a ház akkor ír rá, ha van mit. Kérdezd a pultost, mi készül.</p>
              )}
            </>
          ) : (
            <Locked tier="gold" text="Gold szinttől: signature italok az itallapon kívül, és a DJ pult a te kérésedet veszi előre."/>
          )}
        </div>
      </section>

      <section className="rm-section">
        <SectionHead
          label={rank >= 4 ? '03 / KÖZVETLEN VONAL A TULAJDONOSHOZ' : '03 / A HÁZ VONALA'}
          title={
            rank >= 4 ? (
              <>
                A tulajdonos
                <br />
                <em>olvassa.</em>
              </>
            ) : (
              <>
                Egy szó
                <br />
                <em>a háznak.</em>
              </>
            )
          }
          aside={rooms.line ? 'Üzenet, privát sarok, rendezvény — a ház innen válaszol, és a válasz itt vár.' : 'Black szinttől nyílik.'}
        />
        {rooms.line ? (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-start">
            <div className="flex flex-col gap-3.5">
              {data.contact && (
                <div className="rm-card p-6">
                  <span className="rm-label">{rank >= 4 ? 'A TULAJDONOS' : 'A KAPCSOLATTARTÓD'}</span>
                  <strong className="mt-2 block font-heading text-[22px] text-white">{data.contact.name}</strong>
                  <span className="text-[10px] tracking-[0.2em] text-[#8d8584]">{data.contact.title.toUpperCase()}</span>
                  {data.contact.phone && (
                    <p className="mt-3 inline-flex items-center gap-2 text-[12px] text-[#c9c2c1]">
                      <Phone size={12} className="text-[color:var(--mc-ink)]"/> {data.contact.phone}
                    </p>
                  )}
                </div>
              )}
              <Composer token={token} rooms={rooms} onSent={(message) => mutate((current) => (current ? {...current, messages: [...current.messages, message]} : current))}/>
            </div>
            <Thread messages={data.messages} first={first}/>
          </div>
        ) : (
          <Locked tier="black" text="Black szinttől: saját kapcsolattartó a házból, üzenet és kérés innen — privát sarok, zárás utáni este, rendezvény kedvezménnyel."/>
        )}
      </section>

      <section className="border-y border-[color:var(--rm-line)] bg-[#070709]">
        <div className="rm-section">
          <SectionHead
            label="04 / A KÖVETKEZŐ ESTÉD"
            title={
              <>
                Foglalásaid
                <br />
                <em>{rooms.guestList ? 'és a vendéglistád.' : 'a kóddal.'}</em>
              </>
            }
            aside={rooms.guestList ? 'Írd fel, kik jönnek veled: a bejáratnál a nevükre engedik be őket.' : 'A kóddal foglalt asztalaid. A vendéglista a Royal kör kiváltsága.'}
          />
          {data.bookings.length ? (
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              {data.bookings.map((booking) => (
                <BookingCard key={booking.id} booking={booking} token={token} editable={rooms.guestList} onSaved={(saved) => mutate((current) => (current ? {...current, bookings: current.bookings.map((entry) => (entry.id === saved.id ? saved : entry))} : current))}/>
              ))}
            </div>
          ) : (
            <p className="rm-card p-8 text-[11px] leading-[1.8] text-[#8d8584]">
              Nincs előtted álló foglalás a kóddal.{' '}
              <BtnLink to={`/reservations?member=${encodeURIComponent(member.code)}`} className="ml-2 !py-2 !text-[8px]">
                FOGLALOK ↗
              </BtnLink>
            </p>
          )}
        </div>
      </section>

      <section className="rm-section">
        <SectionHead
          label="05 / A LÉPCSŐ"
          title={
            <>
              Ami nyitva,
              <br />
              <em>és ami még nem.</em>
            </>
          }
          aside="Felfelé nem lehet jelentkezni. A ház ajánlja fel — de itt látod, mi vár."
        />
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
          {ROOMS.map((room, index) => {
            const open = RANK[room.tier] <= rank;
            const roomMeta = tierMeta(room.tier);
            return (
              <Reveal key={room.tier} delay={index * 90} className="h-full">
                <article className={`rm-lounge-step h-full${open ? ' is-open' : ''}`} style={{'--chip': roomMeta.ink} as React.CSSProperties}>
                  <div className="flex items-center justify-between">
                    <TierChip tier={room.tier}/>
                    {open ? <Check size={13} className="text-emerald-300"/> : <Lock size={12} className="text-[#6f6968]"/>}
                  </div>
                  <strong className="mt-5 block font-heading text-[19px] text-white">{room.label}</strong>
                  <p className="mt-2 text-[11px] leading-[1.75] text-[#9e9795]">{room.text}</p>
                  {!open && <p className="mt-4 text-[9px] tracking-[0.2em] text-[#6f6968]">{MEMBERSHIP.find((entry) => entry.id === room.tier)?.path.toUpperCase()}</p>}
                </article>
              </Reveal>
            );
          })}
        </div>
      </section>
    </main>
  );
};

const Locked: React.FC<{tier: Tier; text: string}> = ({tier, text}) => (
  <div className="rm-lounge-lock rm-card flex flex-wrap items-center gap-5 p-8" style={{'--chip': tierMeta(tier).ink} as React.CSSProperties}>
    <span className="rm-lounge-lock-glyph" aria-hidden="true">
      {tierMeta(tier).glyph}
    </span>
    <div className="min-w-0 flex-1">
      <span className="inline-flex items-center gap-2 text-[8px] tracking-[0.25em] text-[#8d8584]">
        <Lock size={10}/> ZÁRVA · <TierChip tier={tier}/>
      </span>
      <p className="mt-2 text-[11px] leading-[1.8] text-[#c9c2c1]">{text}</p>
    </div>
  </div>
);

const Thread: React.FC<{messages: LoungeMessage[]; first: string}> = ({messages, first}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);
  return (
    <div className="rm-card p-0">
      <div className="flex items-center justify-between border-b border-[color:var(--rm-line)] px-6 py-4">
        <span className="rm-label flex items-center gap-2">
          <MessageSquare size={11}/> A SZÁL
        </span>
        <span className="text-[8px] tracking-[0.2em] text-[#777]">{messages.length} ÜZENET</span>
      </div>
      <div ref={ref} className="rm-lounge-thread">
        {!messages.length && <p className="px-6 py-6 text-[11px] leading-[1.8] text-[#8d8584]">Még nem írtál. Ami itt elhangzik, a ház és közted marad.</p>}
        {messages.map((message) => (
          <div key={message.id} className={`rm-lounge-msg${message.fromHouse ? ' is-house' : ''}`}>
            <div className="rm-lounge-msg-meta">
              <b>{message.fromHouse ? message.byName || 'A ház' : first}</b>
              {message.kind !== 'uzenet' && <span className="rm-lounge-kind">{KIND_LABEL[message.kind]}</span>}
              <span>
                {formatDate(message.at)} · {formatTime(message.at)}
              </span>
            </div>
            {message.kind !== 'uzenet' && (message.meta.date || message.meta.guests) && (
              <p className="rm-lounge-msg-facts">
                {message.meta.date ? `Mikor: ${message.meta.date}` : ''}
                {message.meta.guests ? ` · ${message.meta.guests} fő` : ''}
              </p>
            )}
            <p>{message.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const Composer: React.FC<{token: string; rooms: Lounge['rooms']; onSent: (message: LoungeMessage) => void}> = ({token, rooms, onSent}) => {
  const [kind, setKind] = useState<MessageKind>('uzenet');
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [guests, setGuests] = useState('');
  const [busy, setBusy] = useState(false);
  const kinds: MessageKind[] = ['uzenet', 'privat-sarok', 'rendezveny', ...(rooms.buyout ? (['a-haz-egy-estere'] as MessageKind[]) : [])];

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      const reply = await apiSend<{message: LoungeMessage}>('/api/lounge/message', 'POST', {token, text: text.trim(), kind, meta: {date: date || undefined, guests: guests ? Number(guests) : undefined}});
      onSent(reply.message);
      setText('');
      setDate('');
      setGuests('');
      setKind('uzenet');
      toast.success('Elküldve a háznak.', 'A válasz itt vár majd.');
      playSfx('chat_message');
    } catch (err) {
      toast.error('Nem ment el', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} className="rm-card p-6">
      <span className="rm-label">ÍRJ A HÁZNAK</span>
      <div className="mt-3 flex flex-wrap gap-2">
        {kinds.map((entry) => (
          <button key={entry} type="button" onClick={() => setKind(entry)} className={`rm-chip${kind === entry ? ' is-active' : ''}`} aria-pressed={kind === entry}>
            {KIND_LABEL[entry]}
          </button>
        ))}
      </div>
      {kind !== 'uzenet' && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-[8px] tracking-[0.25em] text-[#777]">MELYIK ESTE</span>
            <input value={date} onChange={(event) => setDate(event.target.value)} placeholder="pl. október 12., szombat" maxLength={40} className="rm-input" required/>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[8px] tracking-[0.25em] text-[#777]">HÁNYAN</span>
            <input type="number" min={1} max={500} value={guests} onChange={(event) => setGuests(event.target.value)} className="rm-input"/>
          </label>
        </div>
      )}
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        maxLength={600}
        placeholder={kind === 'uzenet' ? 'Amit a háznak mondanál…' : kind === 'a-haz-egy-estere' ? 'Milyen estét képzelsz? Kik jönnek, mi szóljon, mi legyen a pulton…' : 'Mit szeretnél? Sarok, ital, zene, alkalom…'}
        className="rm-input mt-4"
      />
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[9px] text-[#6f6968]">{600 - text.length}</span>
        <Btn type="submit" variant="red" disabled={busy || !text.trim()}>
          <Send size={12}/> {busy ? 'KÜLDÉS…' : 'KÜLDÉS'}
        </Btn>
      </div>
    </form>
  );
};

const BookingCard: React.FC<{booking: Booking; token: string; editable: boolean; onSaved: (booking: Booking) => void}> = ({booking, token, editable, onSaved}) => {
  const [names, setNames] = useState(booking.guestList.join('\n'));
  const [busy, setBusy] = useState(false);
  const dirty = names.trim() !== booking.guestList.join('\n');

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const reply = await apiSend<{booking: Booking}>('/api/lounge/guest-list', 'POST', {token, reservationId: booking.id, names: names.split('\n').map((line) => line.trim()).filter(Boolean)});
      onSaved(reply.booking);
      setNames(reply.booking.guestList.join('\n'));
      toast.success('Vendéglista mentve.', 'A bejárat látja.');
      playSfx('success');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rm-card p-6">
      <div className="flex flex-wrap items-center gap-3">
        <strong className="font-heading text-[20px] text-white">{booking.code}</strong>
        <span className="border border-white/15 px-2.5 py-1 text-[8px] tracking-[0.18em] text-[#c9c2c1]">{STATUS_LABEL[booking.status] || booking.status.toUpperCase()}</span>
        {booking.tableLabel && <span className="text-[9px] tracking-[0.2em] text-[#8d8584]">{booking.tableLabel}. ASZTAL</span>}
      </div>
      <p className="mt-2 text-[11px] text-[#c9c2c1]">
        {formatDate(booking.when)} · {formatTime(booking.when)} · {booking.guests} fő
      </p>
      {editable ? (
        <div className="mt-4">
          <span className="inline-flex items-center gap-2 text-[8px] tracking-[0.25em] text-[#777]">
            <Users size={10}/> VENDÉGLISTA · EGY NÉV EGY SORBAN
          </span>
          <textarea value={names} onChange={(event) => setNames(event.target.value)} rows={4} className="rm-input mt-2" placeholder={'Lin Tho Gua\nYuanzhe Guan'}/>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[9px] text-[#6f6968]">{names.split('\n').filter((line) => line.trim()).length} név</span>
            <Btn variant="red" onClick={save} disabled={busy || !dirty} className="!py-2 !text-[8px]">
              {busy ? 'MENTÉS…' : 'MENTÉS'}
            </Btn>
          </div>
        </div>
      ) : (
        booking.guestList.length > 0 && <p className="mt-3 text-[10px] text-[#8d8584]">Vendéglista: {booking.guestList.join(', ')}</p>
      )}
    </article>
  );
};

/** No card in hand: the lookup, and what the rooms hold once it is. */
const Gate: React.FC<{onOpen: () => void}> = ({onOpen}) => (
  <main>
    <section className="relative overflow-hidden border-b border-[color:var(--rm-line)] bg-[#060406] px-[8vw] pb-16 pt-[150px]">
      <Embers density={22}/>
      <div className="relative z-[2]">
        <div className="rm-label">RED MOON / A HOUSE BELSŐ SZOBÁJA</div>
        <h1 className="rm-heading rm-display-2 my-5">
          Tagoknak,
          <br />
          <em>belülről.</em>
        </h1>
        <p className="max-w-[560px] text-sm leading-[1.9] text-[#aaa]">A kártyád nem csak asztalt nyit. Meghívások, amiket csak a House lát; italok, amik nincsenek a lapon; egy vonal a házhoz. Minél feljebb, annál több.</p>
      </div>
    </section>
    <section className="rm-section grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
      <div>
        <SectionHead
          label="A KÁRTYÁD NYITJA"
          title={
            <>
              Mutasd,
              <br />
              <em>és nyílik.</em>
            </>
          }
        />
        <div className="-mt-4 flex flex-col gap-3">
          {ROOMS.map((room) => (
            <div key={room.tier} className="flex gap-4 border-b border-white/[0.06] pb-3">
              <TierChip tier={room.tier} className="mt-0.5 shrink-0"/>
              <div>
                <strong className="block text-[12px] text-white">{room.label}</strong>
                <span className="text-[10px] leading-[1.7] text-[#8d8584]">{room.text}</span>
              </div>
            </div>
          ))}
          <p className="text-[10px] text-[#6f6968]">
            Nem tag még? <BtnLink to="/vip" className="ml-2 !py-1.5 !text-[8px]">A HOUSE ↗</BtnLink>
          </p>
        </div>
      </div>
      <Reveal delay={100}>
        <HouseLookup onCard={onOpen}/>
      </Reveal>
    </section>
  </main>
);
