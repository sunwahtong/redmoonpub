import React, {useMemo, useState} from 'react';
import {Check, Copy, Pencil, Plus, Trash2, UserCheck, X} from 'lucide-react';
import {Btn} from '../../components/ui/Btn';
import {Chips, Field, inputClass, PageHeader, Panel, SearchField, Stat} from '../../components/ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatDate} from '../../lib/api';
import {MEMBERSHIP} from '../../lib/content';
import {playSfx} from '../../lib/sfx';
import {dialog} from '../../stores/useDialogStore';
import {toast} from '../../stores/useToastStore';
import {roleAtLeast, useAuthStore} from '../../stores/useAuthStore';

type Tier = 'silver' | 'gold' | 'black' | 'royal';

interface Member {
  id: string;
  code: string;
  name: string;
  phone: string;
  tier: Tier;
  note: string;
  active: boolean;
  visits: number;
  lastVisitAt: string | null;
  grantedByName: string;
  grantedAt: string;
  updatedAt: string;
}

interface Feed {
  members: Member[];
  stats: {total: number; byTier: Record<Tier, number>};
}

const TIERS: Tier[] = ['silver', 'gold', 'black', 'royal'];
const TIER_INK: Record<Tier, string> = {silver: '#cfd3d6', gold: '#e3c07a', black: '#9aa0a6', royal: '#ff5a76'};
const TIER_GLYPH: Record<Tier, string> = {silver: '銀', gold: '金', black: '黑', royal: '王'};
const TIER_NAME: Record<Tier, string> = {silver: 'SILVER', gold: 'GOLD', black: 'BLACK', royal: 'ROYAL'};
const PHONE_PREFIX = '+38-76-';

type Filter = 'all' | Tier | 'inactive';

const digitsOf = (value: string): string => value.replace(/\D/g, '').slice(-7);
/** The server keeps the full 3876… number; people read the last seven digits. */
const localPhone = (value: string): string => (value ? PHONE_PREFIX + digitsOf(value) : '');

const TierMark: React.FC<{tier: Tier; className?: string}> = ({tier, className = ''}) => (
  <span className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-[8px] tracking-[0.18em] ${className}`} style={{color: TIER_INK[tier], borderColor: `${TIER_INK[tier]}66`}}>
    <span aria-hidden="true">{TIER_GLYPH[tier]}</span>
    {TIER_NAME[tier]}
  </span>
);

/**
 * The House, from the inside: who is a member, at which tier, how often they
 * come. Managers grant Silver and Gold; Black and Royal are the owner's.
 * The door marks visits; a member's code is what they book with.
 */
export const MembersPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const isOwner = roleAtLeast(user?.role, 'owner');
  const grantable: Tier[] = isOwner ? TIERS : ['silver', 'gold'];

  const {data, refresh, mutate} = useLiveData<Feed>('/api/members', {intervalMs: 60000, topics: ['content']});
  const members = useMemo(() => data?.members || [], [data]);
  const stats = data?.stats;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [granting, setGranting] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(PHONE_PREFIX);
  const [tier, setTier] = useState<Tier>('silver');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [edit, setEdit] = useState({name: '', phone: PHONE_PREFIX, tier: 'silver' as Tier, note: ''});
  const [justGranted, setJustGranted] = useState<Member | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((member) => {
      if (filter === 'inactive' ? member.active : filter !== 'all' && (member.tier !== filter || !member.active)) return false;
      if (filter === 'all' && !member.active && !q) return true;
      if (!q) return true;
      return `${member.name} ${member.code} ${member.phone} ${member.note}`.toLowerCase().includes(q);
    });
  }, [members, query, filter]);

  const mayManage = (member: Member): boolean => isOwner || member.tier === 'silver' || member.tier === 'gold';

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} a vágólapon.`);
      playSfx('ui_click');
    } catch {
      toast.error('Nem sikerült másolni', text);
    }
  };

  const grant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const digits = digitsOf(phone);
    if (phone !== PHONE_PREFIX && digits.length !== 7) {
      toast.error('A telefonszám 7 számjegyű legyen.');
      return;
    }
    setBusy(true);
    try {
      const reply = await apiSend<{member: Member}>('/api/members', 'POST', {name: name.trim(), phone: digits, tier, note: note.trim()});
      setJustGranted(reply.member);
      setName('');
      setPhone(PHONE_PREFIX);
      setNote('');
      setTier('silver');
      playSfx('success');
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (member: Member) => {
    setEditing(member);
    setEdit({name: member.name, phone: member.phone ? localPhone(member.phone) : PHONE_PREFIX, tier: member.tier, note: member.note});
    playSfx('open');
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || busy) return;
    const digits = digitsOf(edit.phone);
    if (edit.phone !== PHONE_PREFIX && digits.length !== 7) {
      toast.error('A telefonszám 7 számjegyű legyen.');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {name: edit.name.trim(), phone: digits, note: edit.note.trim()};
      if (edit.tier !== editing.tier) body.tier = edit.tier;
      const reply = await apiSend<{member: Member}>(`/api/members/${editing.id}`, 'PATCH', body);
      mutate((current) => (current ? {...current, members: current.members.map((entry) => (entry.id === reply.member.id ? reply.member : entry))} : current));
      setEditing(null);
      toast.success('Mentve.');
      playSfx('success');
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const visit = async (member: Member) => {
    try {
      const reply = await apiSend<{member: Member}>(`/api/members/${member.id}/visit`, 'POST', {});
      mutate((current) => (current ? {...current, members: current.members.map((entry) => (entry.id === reply.member.id ? reply.member : entry))} : current));
      toast.success(`${member.name}: ${reply.member.visits}. látogatás.`);
      playSfx('success');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
    }
  };

  const toggleActive = async (member: Member) => {
    if (member.active) {
      const sure = await dialog.confirm({
        title: 'Felfüggeszted a tagságot?',
        message: `${member.name} kódja (${member.code}) nem fog működni a foglalásnál, amíg vissza nem állítod.`,
        confirmLabel: 'FELFÜGGESZTÉS',
        tone: 'danger'
      });
      if (!sure) return;
    }
    try {
      const reply = await apiSend<{member: Member}>(`/api/members/${member.id}`, 'PATCH', {active: !member.active});
      mutate((current) => (current ? {...current, members: current.members.map((entry) => (entry.id === reply.member.id ? reply.member : entry))} : current));
      toast.success(member.active ? 'Tagság felfüggesztve.' : 'Tagság visszaállítva.');
      playSfx(member.active ? 'delete' : 'success');
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
    }
  };

  const remove = async (member: Member) => {
    const sure = await dialog.confirm({
      title: 'Törlöd a tagot?',
      message: `${member.name} (${member.code}) végleg eltűnik a House-ból, a látogatásaival együtt. Felfüggesztés helyett ez nem visszavonható.`,
      confirmLabel: 'TÖRLÉS',
      tone: 'danger'
    });
    if (!sure) return;
    try {
      await apiSend(`/api/members/${member.id}`, 'DELETE');
      mutate((current) => (current ? {...current, members: current.members.filter((entry) => entry.id !== member.id)} : current));
      toast.success('Tag törölve.');
      playSfx('delete');
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
    }
  };

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / A HOUSE"
          title={
            <>
              A ház <em>tagsága.</em>
            </>
          }
          lead="Kód, szint, látogatások. Silver és Gold szintet a managerek adnak; Black és Royal a tulajdonosé. A tag a kódjával foglal, és a foglalása a szintjével érkezik."
          actions={
            <Btn variant="red" onClick={() => setGranting((value) => !value)}>
              {granting ? <X size={13}/> : <Plus size={13}/>} {granting ? 'MÉGSE' : 'ÚJ TAG'}
            </Btn>
          }
        />

        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-5">
          <Stat glyph="家" label="A HOUSE" value={stats ? stats.total : '—'} hint="aktív tag"/>
          {TIERS.map((entry) => (
            <Stat key={entry} glyph={TIER_GLYPH[entry]} label={TIER_NAME[entry]} value={stats ? stats.byTier[entry] : '—'} hint={MEMBERSHIP.find((item) => item.id === entry)?.tagline}/>
          ))}
        </div>

        {granting && (
          <Panel className="mt-3.5" label="ÚJ TAG" title="Ki lép be a House-ba?" tone="red">
            <form onSubmit={grant} className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <Field label="NÉV">
                <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} className={inputClass}/>
              </Field>
              <Field label="TELEFONSZÁM" hint="Ezzel igazolja a kódját a foglalásnál és a House oldalon. Üresen a kód önmagában elég.">
                <input value={phone} onChange={(event) => setPhone(PHONE_PREFIX + digitsOf(event.target.value.startsWith(PHONE_PREFIX) ? event.target.value.slice(PHONE_PREFIX.length) : event.target.value))} inputMode="numeric" className={inputClass}/>
              </Field>
              <div>
                <span className="text-[8px] tracking-[0.25em] text-[#777]">SZINT</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TIERS.map((entry) => {
                    const allowed = grantable.includes(entry);
                    return (
                      <button
                        key={entry}
                        type="button"
                        disabled={!allowed}
                        onClick={() => setTier(entry)}
                        aria-pressed={tier === entry}
                        title={allowed ? undefined : 'Csak a tulajdonos adhatja'}
                        className={`rm-chip${tier === entry ? ' is-active' : ''}${allowed ? '' : ' opacity-40'}`}
                        style={tier === entry ? {borderColor: TIER_INK[entry], color: TIER_INK[entry]} : undefined}
                      >
                        <span aria-hidden="true">{TIER_GLYPH[entry]}</span> {TIER_NAME[entry]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Field label="JEGYZET" hint="Csak a ház látja: ki ajánlotta, mit szeret, mire figyeljünk.">
                <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={400} className={inputClass}/>
              </Field>
              <div className="md:col-span-2">
                <Btn type="submit" variant="red" disabled={busy || name.trim().length < 2}>
                  <UserCheck size={13}/> TAGSÁG KIADÁSA
                </Btn>
              </div>
            </form>
          </Panel>
        )}

        {justGranted && (
          <div className="rm-card mt-3.5 flex flex-wrap items-center gap-5 border-[color:var(--rm-line-red)] p-6">
            <span className="font-heading text-[40px] leading-none" style={{color: TIER_INK[justGranted.tier]}} aria-hidden="true">
              {TIER_GLYPH[justGranted.tier]}
            </span>
            <div className="min-w-0 flex-1">
              <span className="rm-label">KIADVA</span>
              <strong className="mt-1 block font-heading text-[20px] text-white">
                {justGranted.name} · {TIER_NAME[justGranted.tier]}
              </strong>
              <p className="mt-1 text-[11px] text-[#8d8584]">A kódot mondd el a vendégnek — ezzel foglal, és ezzel nézi meg a kártyáját a House oldalon.</p>
            </div>
            <button type="button" onClick={() => copy(justGranted.code, 'A kód')} className="flex items-center gap-3 border border-[color:var(--rm-line-red)] px-5 py-3 font-heading text-[22px] tracking-[0.15em] text-white hover:bg-[rgba(213,31,60,0.12)]">
              {justGranted.code} <Copy size={14} className="text-[color:var(--rm-red)]"/>
            </button>
            <button type="button" onClick={() => setJustGranted(null)} aria-label="Bezárás" className="text-[#777] hover:text-white">
              <X size={14}/>
            </button>
          </div>
        )}

        <div className="mt-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <Chips
            value={filter}
            onChange={setFilter}
            options={[
              {id: 'all' as Filter, label: 'MIND', count: stats?.total},
              ...TIERS.map((entry) => ({id: entry as Filter, label: TIER_NAME[entry], count: stats?.byTier[entry]})),
              {id: 'inactive' as Filter, label: 'FELFÜGGESZTVE', count: members.filter((member) => !member.active).length}
            ]}
          />
          <SearchField value={query} onChange={setQuery} placeholder="NÉV, KÓD, TELEFON…" className="md:max-w-xs"/>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          {!data && <p className="text-[11px] text-[#8d8584]">Betöltés…</p>}
          {data && !shown.length && <p className="rm-card p-6 text-[11px] text-[#8d8584]">{members.length ? 'Nincs találat.' : 'A House még üres. Az első tagot az ÚJ TAG gombbal veszed fel.'}</p>}
          {shown.map((member) => (
            <article key={member.id} className={`rm-card p-5${member.active ? '' : ' opacity-60'}`}>
              <div className="flex flex-wrap items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center border font-heading text-[22px]" style={{color: TIER_INK[member.tier], borderColor: `${TIER_INK[member.tier]}55`}} aria-hidden="true">
                  {TIER_GLYPH[member.tier]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <strong className="font-heading text-[18px] text-white">{member.name}</strong>
                    <TierMark tier={member.tier}/>
                    {!member.active && <span className="border border-white/15 px-2.5 py-1 text-[8px] tracking-[0.18em] text-[#8f8887]">FELFÜGGESZTVE</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[#c9c2c1]">
                    <button type="button" onClick={() => copy(member.code, 'A kód')} className="inline-flex items-center gap-1.5 font-heading tracking-[0.12em] text-white hover:text-[color:var(--rm-red-bright)]" title="Kód másolása">
                      {member.code} <Copy size={10} className="text-[#777]"/>
                    </button>
                    <span>{member.phone ? localPhone(member.phone) : 'nincs telefon'}</span>
                    <span>
                      {member.visits} látogatás{member.lastVisitAt ? ` · utoljára ${formatDate(member.lastVisitAt)}` : ''}
                    </span>
                    <span className="text-[#8d8584]">
                      {member.grantedByName || 'a ház'} · {formatDate(member.grantedAt)}
                    </span>
                  </div>
                  {member.note && <p className="mt-2 text-[10px] leading-[1.6] text-[#8d8584]">{member.note}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {member.active && (
                    <Btn onClick={() => visit(member)} title="Itt van ma este">
                      <Check size={12}/> +1 LÁTOGATÁS
                    </Btn>
                  )}
                  <Btn onClick={() => (editing?.id === member.id ? setEditing(null) : openEdit(member))}>
                    <Pencil size={12}/> SZERKESZTÉS
                  </Btn>
                  {mayManage(member) && <Btn onClick={() => toggleActive(member)}>{member.active ? 'FELFÜGGESZTÉS' : 'VISSZAÁLLÍTÁS'}</Btn>}
                  {isOwner && (
                    <Btn onClick={() => remove(member)} className="is-danger" aria-label="Törlés">
                      <Trash2 size={12}/>
                    </Btn>
                  )}
                </div>
              </div>

              {editing?.id === member.id && (
                <form onSubmit={saveEdit} className="mt-5 grid grid-cols-1 gap-3.5 border-t border-white/[0.06] pt-5 md:grid-cols-2">
                  <Field label="NÉV">
                    <input value={edit.name} onChange={(event) => setEdit({...edit, name: event.target.value})} required maxLength={80} className={inputClass}/>
                  </Field>
                  <Field label="TELEFONSZÁM">
                    <input value={edit.phone} onChange={(event) => setEdit({...edit, phone: PHONE_PREFIX + digitsOf(event.target.value.startsWith(PHONE_PREFIX) ? event.target.value.slice(PHONE_PREFIX.length) : event.target.value)})} inputMode="numeric" className={inputClass}/>
                  </Field>
                  <div>
                    <span className="text-[8px] tracking-[0.25em] text-[#777]">SZINT</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {TIERS.map((entry) => {
                        const allowed = grantable.includes(entry) && mayManage(member);
                        return (
                          <button key={entry} type="button" disabled={!allowed} onClick={() => setEdit({...edit, tier: entry})} aria-pressed={edit.tier === entry} className={`rm-chip${edit.tier === entry ? ' is-active' : ''}${allowed ? '' : ' opacity-40'}`}>
                            <span aria-hidden="true">{TIER_GLYPH[entry]}</span> {TIER_NAME[entry]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <Field label="JEGYZET">
                    <input value={edit.note} onChange={(event) => setEdit({...edit, note: event.target.value})} maxLength={400} className={inputClass}/>
                  </Field>
                  <div className="flex gap-2 md:col-span-2">
                    <Btn type="submit" variant="red" disabled={busy}>
                      MENTÉS
                    </Btn>
                    <Btn type="button" onClick={() => setEditing(null)}>
                      MÉGSE
                    </Btn>
                  </div>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
};
