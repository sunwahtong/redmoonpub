import React, {useMemo, useState} from 'react';
import {CalendarPlus, Check, Eye, EyeOff, ImagePlus, PenLine, Star, Trash2, X} from 'lucide-react';
import {Btn} from '../../components/ui/Btn';
import {Badge, Chips, Field, inputClass, PageHeader, Panel} from '../../components/ui/console';
import {CountdownUnits} from '../../components/events/EventCard';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, assetUrl, formatDate, formatHuf, formatTime, formatWeekday} from '../../lib/api';
import {uploadMedia} from '../../lib/media';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {dialog} from '../../stores/useDialogStore';
import type {RedMoonEvent} from '../../types';

type Filter = 'upcoming' | 'past' | 'all';

interface Draft {
  title: string;
  subtitle: string;
  description: string;
  place: string;
  startsAt: string;
  endsAt: string;
  tag: string;
  coverImage: string;
  coverPublicId: string;
  entryFee: string;
  dressCode: string;
  featured: boolean;
  active: boolean;
  /** Empty: everyone. A tier: an invitation, shown only in the House's inner rooms from that tier up. */
  minTier: string;
}

const TAG_SUGGESTIONS = ['LIVE DJ', 'TEMATIKUS EST', 'HAPPY HOUR', 'KARAOKE', 'ZÁRTKÖRŰ', 'VIP EST'];
const INVITE_TIERS: {id: string; label: string}[] = [
  {id: '', label: 'MINDENKI'},
  {id: 'silver', label: 'HOUSE SILVER+'},
  {id: 'gold', label: 'GOLD+'},
  {id: 'black', label: 'BLACK+'},
  {id: 'royal', label: 'CSAK ROYAL'}
];

function toLocalInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultStart(): string {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  date.setHours(21, 0, 0, 0);
  return toLocalInput(date.toISOString());
}

const emptyDraft = (): Draft => ({
  title: '',
  subtitle: '',
  description: '',
  place: 'Red Moon Pub',
  startsAt: defaultStart(),
  endsAt: '',
  tag: '',
  coverImage: '',
  coverPublicId: '',
  entryFee: '',
  dressCode: '',
  featured: false,
  active: true,
  minTier: ''
});

const draftOf = (event: RedMoonEvent): Draft => ({
  title: event.title,
  subtitle: event.subtitle || '',
  description: event.description || '',
  place: event.place || 'Red Moon Pub',
  startsAt: toLocalInput(event.startsAt),
  endsAt: toLocalInput(event.endsAt),
  tag: event.tag || '',
  coverImage: event.coverImage || '',
  coverPublicId: event.coverPublicId || '',
  entryFee: event.entryFee === null || event.entryFee === undefined ? '' : String(event.entryFee),
  dressCode: event.dressCode || '',
  featured: !!event.featured,
  active: event.active !== false,
  minTier: event.minTier || ''
});

export const StaffEventsPage: React.FC = () => {
  const {data, refresh, mutate} = useLiveData<{events: RedMoonEvent[]}>('/api/events', {intervalMs: 30000, topics: ['events']});
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const events = useMemo(() => data?.events || [], [data]);
  const now = Date.now();

  const visible = useMemo(() => {
    const list = events.filter((event) => {
      const end = event.endsAt ? new Date(event.endsAt).getTime() : new Date(event.startsAt).getTime() + 4 * 3600000;
      if (filter === 'upcoming') return end >= now;
      if (filter === 'past') return end < now;
      return true;
    });
    return filter === 'past'
      ? list.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())
      : list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events, filter, now]);

  const counts = useMemo(
    () => ({
      upcoming: events.filter((event) => (event.endsAt ? new Date(event.endsAt).getTime() : new Date(event.startsAt).getTime() + 4 * 3600000) >= now).length,
      past: events.filter((event) => (event.endsAt ? new Date(event.endsAt).getTime() : new Date(event.startsAt).getTime() + 4 * 3600000) < now).length,
      all: events.length
    }),
    [events, now]
  );

  const run = async (action: () => Promise<unknown>, okText: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(okText);
      playSfx('success');
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const payload = () => ({
    title: draft.title,
    subtitle: draft.subtitle,
    description: draft.description,
    place: draft.place,
    startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : '',
    endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
    tag: draft.tag,
    coverImage: draft.coverImage,
    coverPublicId: draft.coverPublicId,
    entryFee: draft.entryFee === '' ? null : Number(draft.entryFee),
    dressCode: draft.dressCode,
    featured: draft.featured,
    active: draft.active,
    minTier: draft.minTier
  });

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const editing = editingId && editingId !== 'new' ? editingId : null;
    run(async () => {
      if (editing) await apiSend(`/api/events/${editing}`, 'PATCH', payload());
      else await apiSend('/api/events', 'POST', payload());
      setEditingId(null);
      setDraft(emptyDraft());
    }, editing ? 'Rendezvény mentve.' : 'Rendezvény létrehozva.');
  };

  const remove = async (event: RedMoonEvent) => {
    const sure = await dialog.confirm({
      title: `Törlöd: ${event.title}?`,
      message: 'A rendezvény eltűnik a főoldalról és az archívumból is. Ha csak el akarod rejteni, inkább kapcsold inaktívra.',
      confirmLabel: 'TÖRLÉS',
      tone: 'danger'
    });
    if (!sure) return;
    // Gone from the list now; the server confirms. Nothing waits on the round trip.
    mutate((current) => (current ? {events: current.events.filter((entry) => entry.id !== event.id)} : current));
    if (editingId === event.id) setEditingId(null);
    try {
      await apiSend(`/api/events/${event.id}`, 'DELETE');
      toast.success('Rendezvény törölve.');
      playSfx('delete');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
      refresh();
    }
  };

  const pickCover = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const media = await uploadMedia('image', 'event', file);
      setDraft((current) => ({...current, coverImage: media.url, coverPublicId: media.publicId}));
      toast.success('Borítókép feltöltve.');
      playSfx('success');
    } catch (err) {
      toast.error('A feltöltés nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const toggle = async (event: RedMoonEvent, key: 'active' | 'featured') => {
    mutate((current) => (current ? {events: current.events.map((entry) => (entry.id === event.id ? {...entry, [key]: !event[key]} : key === 'featured' && !event.featured ? {...entry, featured: false} : entry))} : current));
    try {
      await apiSend(`/api/events/${event.id}`, 'PATCH', {[key]: !event[key]});
      playSfx('ui_click');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      refresh();
    }
  };

  const formOpen = editingId !== null;

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / RENDEZVÉNYEK"
          title={
            <>
              Az <em>esték.</em>
            </>
          }
          lead="Amit itt felveszel, a főoldalon visszaszámlálóval, a rendezvényoldalon a teljes részletekkel jelenik meg. A kiemelt este mindig a főoldal tetejére kerül."
          actions={
            <Btn
              variant={formOpen ? 'outline' : 'red'}
              onClick={() => {
                if (formOpen) {
                  setEditingId(null);
                  setDraft(emptyDraft());
                } else {
                  setEditingId('new');
                  setDraft(emptyDraft());
                }
              }}
            >
              {formOpen ? (
                <>
                  <X size={13}/> MÉGSE
                </>
              ) : (
                <>
                  <CalendarPlus size={13}/> ÚJ RENDEZVÉNY
                </>
              )}
            </Btn>
          }
        />

        {formOpen && (
          <form onSubmit={save} className="mb-8 border border-[color:var(--rm-line-red)] bg-[#09090b] p-7">
            <span className="rm-label">{editingId === 'new' ? 'ÚJ RENDEZVÉNY' : 'SZERKESZTÉS'}</span>
            <h2 className="mb-6 mt-2 font-heading text-[22px] text-white">{editingId === 'new' ? 'Mi lesz a program?' : draft.title}</h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="CÍM" className="md:col-span-2">
                <input value={draft.title} onChange={(event) => setDraft({...draft, title: event.target.value})} required maxLength={120} className={inputClass}/>
              </Field>
              <Field label="ALCÍM" hint="Egy sor a cím alá, pl. „A vörös hold alatt”.">
                <input value={draft.subtitle} onChange={(event) => setDraft({...draft, subtitle: event.target.value})} maxLength={160} className={inputClass}/>
              </Field>
              <Field label="CÍMKE" hint="Rövid, csupa nagybetűs jelző a kártyán.">
                <input value={draft.tag} onChange={(event) => setDraft({...draft, tag: event.target.value.toUpperCase()})} maxLength={40} list="rm-event-tags" className={inputClass}/>
                <datalist id="rm-event-tags">
                  {TAG_SUGGESTIONS.map((tag) => (
                    <option key={tag} value={tag}/>
                  ))}
                </datalist>
              </Field>
              <Field label="KEZDÉS">
                <input type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({...draft, startsAt: event.target.value})} required className={inputClass}/>
              </Field>
              <Field label="VÉGE (OPCIONÁLIS)" hint="Üresen négy órával a kezdés után ér véget.">
                <input type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft({...draft, endsAt: event.target.value})} className={inputClass}/>
              </Field>
              <Field label="HELYSZÍN">
                <input value={draft.place} onChange={(event) => setDraft({...draft, place: event.target.value})} maxLength={120} className={inputClass}/>
              </Field>
              <Field label="BELÉPŐ (FT)" hint="Üresen nincs kiírva; 0 = belépő nélkül.">
                <input type="number" min={0} value={draft.entryFee} onChange={(event) => setDraft({...draft, entryFee: event.target.value})} className={inputClass}/>
              </Field>
              <Field label="DRESS CODE">
                <input value={draft.dressCode} onChange={(event) => setDraft({...draft, dressCode: event.target.value})} maxLength={120} placeholder="pl. elegáns, fekete" className={inputClass}/>
              </Field>
              <Field label="BORÍTÓKÉP" hint="Tölts fel egy képet, vagy írj be egy címet / assets/… útvonalat.">
                <div className="flex gap-2">
                  <input value={draft.coverImage} onChange={(event) => setDraft({...draft, coverImage: event.target.value, coverPublicId: ''})} maxLength={600} placeholder="assets/gallery/red-moon-dj-crowd.webp" className={inputClass}/>
                  <label className={`rm-btn is-ghost !px-3 !py-2 !text-[8px] cursor-pointer${uploading ? ' opacity-50' : ''}`}>
                    <input type="file" accept="image/*" onChange={pickCover} className="hidden" disabled={uploading}/>
                    <ImagePlus size={12}/> {uploading ? 'FELTÖLTÉS…' : 'KÉP'}
                  </label>
                </div>
                {draft.coverImage && <img src={assetUrl(draft.coverImage)} alt="" className="mt-2 h-24 w-full object-cover opacity-80"/>}
              </Field>
              <Field label="LEÍRÁS" className="md:col-span-2">
                <textarea value={draft.description} onChange={(event) => setDraft({...draft, description: event.target.value})} rows={4} maxLength={1200} className={inputClass}/>
              </Field>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-3 text-[10px] text-[#c9c2c1]">
                <button type="button" role="switch" aria-checked={draft.featured} onClick={() => setDraft({...draft, featured: !draft.featured})} className="rm-switch"/>
                Kiemelt: a főoldal tetején, visszaszámlálóval
              </label>
              <label className="flex items-center gap-3 text-[10px] text-[#c9c2c1]">
                <button type="button" role="switch" aria-checked={draft.active} onClick={() => setDraft({...draft, active: !draft.active})} className="rm-switch"/>
                Látható a nyilvános oldalon
              </label>
            </div>

            <div className="mt-5">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">KINEK</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {INVITE_TIERS.map((entry) => (
                  <button key={entry.id} type="button" onClick={() => setDraft({...draft, minTier: entry.id})} aria-pressed={draft.minTier === entry.id} className={`rm-chip${draft.minTier === entry.id ? ' is-active' : ''}`}>
                    {entry.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-[#8d8584]">{draft.minTier ? 'Meghívás: a nyilvános oldalon nem jelenik meg, a House belső szobájában igen — ettől a szinttől felfelé.' : 'Nyilvános este: mindenki látja a rendezvények oldalán.'}</p>
            </div>

            {draft.startsAt && (
              <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-white/[0.06] pt-5">
                <span className="text-[8px] tracking-[0.25em] text-[#777]">ELŐNÉZET · VISSZASZÁMLÁLÓ</span>
                <CountdownUnits startsAt={new Date(draft.startsAt).toISOString()}/>
              </div>
            )}

            <div className="mt-6 flex gap-2.5">
              <Btn type="submit" variant="red" disabled={busy}>
                <Check size={13}/> {editingId === 'new' ? 'LÉTREHOZÁS' : 'MENTÉS'}
              </Btn>
              <Btn
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setDraft(emptyDraft());
                }}
              >
                MÉGSE
              </Btn>
            </div>
          </form>
        )}

        <Chips
          className="mb-6"
          value={filter}
          onChange={setFilter}
          options={[
            {id: 'upcoming', label: 'KÖZELGŐ', count: counts.upcoming},
            {id: 'past', label: 'ARCHÍV', count: counts.past},
            {id: 'all', label: 'ÖSSZES', count: counts.all}
          ]}
        />

        <div className="flex flex-col gap-2.5">
          {!visible.length && (
            <Panel>
              <p className="text-[11px] text-[#8d8584]">Nincs rendezvény ezzel a szűréssel. Hozz létre egyet a jobb felső gombbal.</p>
            </Panel>
          )}

          {visible.map((event) => {
            const start = new Date(event.startsAt);
            const upcoming = start.getTime() > now;
            return (
              <article key={event.id} className={`rm-card p-6 ${event.active === false ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <strong className="font-heading text-[20px] text-white">{event.title}</strong>
                      {event.featured && (
                        <Badge tone="red">
                          <Star size={9}/> KIEMELT
                        </Badge>
                      )}
                      {event.minTier && <Badge tone="sky">HOUSE · {event.minTier.toUpperCase()}+</Badge>}
                      {event.tag && <Badge tone="sky">{event.tag}</Badge>}
                      {event.active === false && <Badge tone="warn">REJTETT</Badge>}
                    </div>
                    {event.subtitle && <p className="mt-1 text-[11px] text-[color:var(--rm-red-bright)]">{event.subtitle}</p>}
                    <p className="mt-2 text-[10px] text-[#8d8584]">
                      {formatDate(start)} · {formatWeekday(start)} · {formatTime(start)}
                      {event.endsAt ? ` – ${formatTime(event.endsAt)}` : ''} · {event.place}
                      {event.entryFee !== null && event.entryFee !== undefined ? ` · ${event.entryFee > 0 ? formatHuf(event.entryFee) : 'belépő nélkül'}` : ''}
                      {event.dressCode ? ` · ${event.dressCode}` : ''}
                    </p>
                    {event.description && (
                      <p className="mt-3 max-w-2xl text-[11px] leading-[1.7] text-[#a09998]">{event.description}</p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-3">
                    {upcoming && <CountdownUnits startsAt={event.startsAt}/>}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(event.id);
                          setDraft(draftOf(event));
                          window.scrollTo({top: 0, behavior: 'smooth'});
                        }}
                        aria-label="Szerkesztés"
                        title="Szerkesztés"
                        className="p-1.5 text-[#777] transition-colors hover:text-white"
                      >
                        <PenLine size={13}/>
                      </button>
                      <button type="button" onClick={() => toggle(event, 'featured')} aria-label="Kiemelés" title={event.featured ? 'Kiemelés levétele' : 'Kiemelés a főoldalon'} className={`p-1.5 transition-colors hover:text-white ${event.featured ? 'text-[color:var(--rm-red)]' : 'text-[#777]'}`}>
                        <Star size={13}/>
                      </button>
                      <button type="button" onClick={() => toggle(event, 'active')} aria-label="Láthatóság" title={event.active === false ? 'Megjelenítés' : 'Elrejtés'} className="p-1.5 text-[#777] transition-colors hover:text-white">
                        {event.active === false ? <EyeOff size={13}/> : <Eye size={13}/>}
                      </button>
                      <button type="button" onClick={() => remove(event)} aria-label="Törlés" title="Törlés" className="p-1.5 text-[#777] transition-colors hover:text-[color:var(--rm-red)]">
                        <Trash2 size={13}/>
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
};
