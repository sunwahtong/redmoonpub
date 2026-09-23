import React, {useMemo, useState} from 'react';
import {Check, DoorClosed, DoorOpen, LogOut, Moon, UserMinus, UserPlus, Users} from 'lucide-react';
import {Btn, BtnLink} from '../../components/ui/Btn';
import {Avatar, Badge, Field, inputClass, PageHeader, Panel, SearchField} from '../../components/ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {useHouseStatus} from '../../hooks/useHouseStatus';
import {apiSend, formatHuf, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {dialog} from '../../stores/useDialogStore';
import {JOB_LABEL, type StaffJob} from '../../lib/orders';
import {useAuthStore, can, roleAtLeast} from '../../stores/useAuthStore';

interface Shift {
  id: string;
  status: 'open' | 'closed';
  startedAt: string;
  startedByName: string;
  startedById: string;
  members: string[];
  memberIds: string[];
  memberHistory: {name: string; userId: string | null; joinedAt: string; reason: string | null}[];
  openingCash: number;
  revenue?: number;
  salesCount?: number;
  items?: number;
  notes?: string;
}

interface Member {
  id: string;
  name: string;
  nickname: string;
  role: string;
  jobs: string[];
  avatar: string;
}

const ROLE_LABEL: Record<string, string> = {staff: 'STAFF', manager: 'ÜZLETVEZETŐ', owner: 'TULAJDONOS'};

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const ShiftPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const isManager = roleAtLeast(user?.role, 'manager');
  const {data: current, refresh} = useLiveData<{shift: Shift | null}>('/api/shifts/current', {intervalMs: 15000});
  const {data: memberData} = useLiveData<{users: Member[]}>('/api/shifts/available-members', {intervalMs: 60000});
  const {data: house, refresh: refreshHouse} = useHouseStatus(15000);

  const shift = current?.shift || null;
  const members = useMemo(() => memberData?.users || [], [memberData]);

  const [openingCash, setOpeningCash] = useState('0');
  const [closingCash, setClosingCash] = useState('');
  const [notes, setNotes] = useState('');
  const [doorNote, setDoorNote] = useState('');
  const [query, setQuery] = useState('');
  // The person opening the shift is pre-selected as a convenience, never forced.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const selection = picked ?? (user ? [user.id] : []);

  const visibleMembers = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return members;
    return members.filter((member) => normalize(`${member.name} ${member.nickname}`).includes(needle));
  }, [members, query]);

  const run = async (action: () => Promise<unknown>, okText: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(okText);
      playSfx('success');
      refresh();
      refreshHouse();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const openShift = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selection.length) {
      toast.error('Üres műszak', 'Válassz legalább egy dolgozót a műszakba.');
      return;
    }
    run(
      () => apiSend('/api/shifts/open', 'POST', {openingCash: Number(openingCash) || 0, memberIds: selection, notes}),
      'Műszak megnyitva.'
    );
  };

  const closeShift = async (event: React.FormEvent) => {
    event.preventDefault();
    const sure = await dialog.confirm({
      title: 'Lezárod a műszakot?',
      message: 'A műszak bevétele és tagjai véglegesen rögzülnek. Ha a ház nyitva van, az ajtó is bezár.',
      detail: `Záró kassza: ${formatHuf(Number(closingCash) || 0)}`,
      confirmLabel: 'MŰSZAK ZÁRÁSA',
      tone: 'danger'
    });
    if (!sure) return;
    run(async () => {
      await apiSend('/api/shifts/close', 'POST', {closingCash: Number(closingCash), notes});
      setClosingCash('');
      setNotes('');
    }, 'Műszak lezárva.');
  };

  const addMember = (userId: string) => run(() => apiSend('/api/shifts/members', 'POST', {userId}), 'Tag hozzáadva.');

  const removeMember = async (member: {userId: string | null; name: string}) => {
    if (!member.userId) return;
    const self = member.userId === user?.id;
    const sure = await dialog.confirm({
      title: self ? 'Kilépsz a műszakból?' : `${member.name} kivétele?`,
      message: self ? 'A ledolgozott időd eddig a pillanatig számít.' : 'A dolgozó eddigi ideje megmarad, de a kasszát innentől nem használhatja.',
      confirmLabel: self ? 'KILÉPEK' : 'KIVESZEM',
      tone: 'danger'
    });
    if (!sure) return;
    run(() => apiSend(`/api/shifts/members/${member.userId}`, 'DELETE'), self ? 'Kiléptél a műszakból.' : `${member.name} kivéve.`);
  };

  const openDoor = () => run(() => apiSend('/api/house/pub/open', 'POST', {note: doorNote}), 'A ház kinyitott.');
  const closeDoor = async () => {
    const sure = await dialog.confirm({
      title: 'Bezárod a házat?',
      message: 'A nyilvános oldal azonnal zárvát mutat. A műszak nyitva marad.',
      confirmLabel: 'BEZÁRÁS'
    });
    if (!sure) return;
    run(() => apiSend('/api/house/pub/close', 'POST', {}), 'A ház bezárt.');
  };

  const inShift = !!shift && !!user && shift.memberIds?.includes(user.id);
  const canManage = !!shift && !!user && (shift.startedById === user.id || isManager);

  const memberCard = (member: Member, active: boolean, onClick: () => void, trailing?: React.ReactNode) => (
    <button key={member.id} type="button" onClick={onClick} className={`rm-member${active ? ' is-picked' : ''}`}>
      <span className="rm-member-check" aria-hidden="true">
        <Check size={11}/>
      </span>
      <Avatar name={member.name} nickname={member.nickname} src={member.avatar} size={30}/>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-white">
          {member.name}
          {member.id === user?.id && <span className="ml-2 text-[8px] tracking-[0.2em] text-[color:var(--rm-red)]">TE</span>}
        </span>
        <span className="block truncate text-[9px] text-[#777]">
          {ROLE_LABEL[member.role] || member.role}
          {member.jobs?.length ? ` · ${member.jobs.map((job) => JOB_LABEL[job as StaffJob] || job).join(', ')}` : ''}
        </span>
      </span>
      {trailing}
    </button>
  );

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / MŰSZAK"
          title={
            shift ? (
              <>
                Nyitott <em>műszak.</em>
              </>
            ) : (
              <>
                Nincs nyitott <em>műszak.</em>
              </>
            )
          }
          lead={
            shift
              ? `${shift.id} · nyitotta ${shift.startedByName} · ${formatTime(shift.startedAt)}`
              : 'A nap egy műszakkal kezdődik. Válaszd ki, kik dolgoznak ma, és add meg a kezdő kasszát.'
          }
          actions={
            inShift ? (
              <BtnLink to="/staff/register" variant="red">
                KASSZA ↗
              </BtnLink>
            ) : undefined
          }
        />

        {/* ------------------------------------------------ THE DOOR */}
        <Panel
          tone="red"
          className="mb-3.5"
          label="A HÁZ AJTAJA"
          title={house?.open ? 'Nyitva.' : 'Zárva.'}
          action={
            <span className={`rm-door-chip ${house?.open ? 'is-open' : 'is-closed'}`}>
              <span className="rm-door-dot" aria-hidden="true"/>
              {house?.open ? 'A VENDÉGEK LÁTJÁK: NYITVA' : 'A VENDÉGEK LÁTJÁK: ZÁRVA'}
            </span>
          }
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <p className="max-w-lg text-[11px] leading-[1.8] text-[#8d8584]">
              {house?.open
                ? `A ház ${house.since ? formatTime(house.since) : ''} óta nyitva${house.openedBy ? `, ${house.openedBy} nyitotta` : ''}.${
                    house.note ? ` Ma este: ${house.note}.` : ''
                  } A műszak zárásával az ajtó magától bezár.`
                : shift
                  ? 'A műszak fut, az ajtó még zárva. Nyisd ki, ha jöhetnek a vendégek — a nyilvános oldal azonnal frissül.'
                  : 'A ház csak nyitott műszak mellett nyitható. Előbb nyiss műszakot.'}
            </p>

            {isManager ? (
              house?.open ? (
                <Btn onClick={closeDoor} disabled={busy}>
                  <DoorClosed size={13}/> HÁZ BEZÁRÁSA
                </Btn>
              ) : (
                <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:items-end lg:w-auto">
                  <Field label="MA ESTE (OPCIONÁLIS)" className="sm:w-64">
                    <input
                      value={doorNote}
                      onChange={(event) => setDoorNote(event.target.value.slice(0, 160))}
                      placeholder="pl. Karaoke est, happy hour 22-ig"
                      className={inputClass}
                      disabled={!shift}
                    />
                  </Field>
                  <Btn variant="red" onClick={openDoor} disabled={!shift || busy} className="justify-center">
                    <DoorOpen size={13}/> HÁZ NYITÁSA
                  </Btn>
                </div>
              )
            ) : (
              <Badge tone="muted">
                <Moon size={10}/> AJTÓT ÜZLETVEZETŐ NYIT
              </Badge>
            )}
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          {shift ? (
            <>
              <Panel label="AKTUÁLIS" title={shift.id}>
                <dl className="flex flex-col gap-3 text-[11px]">
                  {[
                    ['Nyitotta', shift.startedByName],
                    ['Nyitás', formatTime(shift.startedAt)],
                    ['Kezdő kassza', formatHuf(shift.openingCash)],
                    ['Eladások', String(shift.salesCount ?? 0)],
                    ['Bevétel', formatHuf(shift.revenue ?? 0)]
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between border-b border-white/[0.04] pb-2">
                      <dt className="text-[#777]">{label}</dt>
                      <dd className="text-white">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-6">
                  <span className="flex items-center gap-2 text-[8px] tracking-[0.25em] text-[#777]">
                    <Users size={11}/> TAGOK ({shift.memberHistory.length})
                  </span>
                  <div className="mt-3 flex flex-col gap-2">
                    {shift.memberHistory.map((member) => {
                      const account = members.find((entry) => entry.id === member.userId);
                      const removable = member.userId && (canManage || member.userId === user?.id) && shift.memberIds.length > 1;
                      return (
                        <div key={`${member.userId || member.name}`} className="flex items-center gap-3 border border-white/[0.06] px-3 py-2">
                          <Avatar name={member.name} nickname={account?.nickname} src={account?.avatar} size={28}/>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] text-white">{member.name}</span>
                            <span className="block text-[9px] text-[#777]">
                              {formatTime(member.joinedAt)} óta{member.reason ? ` · ${member.reason}` : ''}
                            </span>
                          </span>
                          {removable && (
                            <button
                              type="button"
                              onClick={() => removeMember(member)}
                              aria-label={member.userId === user?.id ? 'Kilépés a műszakból' : `${member.name} kivétele`}
                              className="text-[#777] transition-colors hover:text-[color:var(--rm-red)]"
                            >
                              {member.userId === user?.id ? <LogOut size={12}/> : <UserMinus size={12}/>}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {!inShift && (
                  <p className="mt-5 text-[10px] leading-[1.7] text-[#8d8584]">
                    Nem vagy tagja ennek a műszaknak, ezért a kasszát nem használhatod.
                    {canManage ? ' Vedd fel magad a jobb oldali listából.' : ''}
                  </p>
                )}
              </Panel>

              <div className="flex flex-col gap-3.5">
                {canManage && (
                  <form onSubmit={closeShift} className="rm-card flex flex-col gap-3.5 p-7">
                    <span className="rm-label">ZÁRÁS</span>
                    <h2 className="mb-1 font-heading text-[22px] text-white">Műszak lezárása</h2>
                    <p className="mb-2 text-[10px] leading-[1.7] text-[#8d8584]">
                      Csak a műszak indítója, üzletvezető vagy tulajdonos zárhat. Záráskor a ház ajtaja is bezár.
                    </p>
                    <Field label="ZÁRÓ KASSZA (FT)">
                      <input type="number" min={0} value={closingCash} onChange={(event) => setClosingCash(event.target.value)} required className={inputClass}/>
                    </Field>
                    <Field label="MEGJEGYZÉS">
                      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className={inputClass}/>
                    </Field>
                    <Btn type="submit" variant="red" disabled={busy} className="mt-2 justify-center">
                      <DoorClosed size={13}/> MŰSZAK ZÁRÁSA
                    </Btn>
                  </form>
                )}

                {canManage && (
                  <Panel label="TAG HOZZÁADÁSA" padded>
                    <SearchField value={query} onChange={setQuery} placeholder="NÉV…" className="mb-3"/>
                    <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto">
                      {visibleMembers.filter((member) => !shift.memberIds?.includes(member.id)).length === 0 && (
                        <p className="text-[11px] text-[#8d8584]">Mindenki benne van, aki lehet.</p>
                      )}
                      {visibleMembers
                        .filter((member) => !shift.memberIds?.includes(member.id))
                        .map((member) =>
                          memberCard(member, false, () => addMember(member.id), <UserPlus size={12} className="text-[color:var(--rm-red)]"/>)
                        )}
                    </div>
                  </Panel>
                )}
              </div>
            </>
          ) : (
            <form onSubmit={openShift} className="rm-card flex flex-col gap-5 p-7 lg:col-span-2">
              <div>
                <span className="rm-label">NYITÁS</span>
                <h2 className="mt-2 font-heading text-[22px] text-white">Műszak nyitása</h2>
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
                <div className="flex flex-col gap-4">
                  <Field label="KEZDŐ KASSZA (FT)">
                    <input type="number" min={0} value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} required className={inputClass}/>
                  </Field>
                  <Field label="MEGJEGYZÉS">
                    <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className={inputClass}/>
                  </Field>
                  <div className="border border-white/[0.06] bg-black/30 p-4 text-[10px] leading-[1.7] text-[#8d8584]">
                    <b className="text-white">{selection.length}</b> dolgozó a műszakban.
                    {user && !selection.includes(user.id) && ' Te magad nem vagy benne — így is nyithatod.'}
                  </div>
                  <Btn type="submit" variant="red" disabled={busy || !selection.length} className="justify-center">
                    <DoorOpen size={13}/> MŰSZAK NYITÁSA
                  </Btn>
                </div>

                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[8px] tracking-[0.25em] text-[#777]">KIK DOLGOZNAK MA?</span>
                    <SearchField value={query} onChange={setQuery} placeholder="NÉV…" className="sm:max-w-[220px]"/>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {visibleMembers.map((member) =>
                      memberCard(member, selection.includes(member.id), () =>
                        setPicked(selection.includes(member.id) ? selection.filter((id) => id !== member.id) : [...selection, member.id])
                      )
                    )}
                  </div>
                  {!members.length && <p className="text-[11px] text-[#8d8584]">Betöltés…</p>}
                </div>
              </div>
            </form>
          )}
        </div>

        {!shift && can(user, 'manager') && (
          <p className="mt-6 text-[10px] leading-[1.7] text-[#6f6968]">
            Tipp: a nyitás után a ház ajtaját külön kell kinyitni fent, hogy a vendégek nyitvát lássanak.
          </p>
        )}
      </section>
    </main>
  );
};
