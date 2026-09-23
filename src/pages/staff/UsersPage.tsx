import React, {useMemo, useState} from 'react';
import {Ban, Check, KeyRound, LogOut, PenLine, RefreshCw, ShieldCheck, Trash2, UserPlus, X} from 'lucide-react';
import {Btn} from '../../components/ui/Btn';
import {Select} from '../../components/ui/Select';
import {Avatar, Badge, Chips, Field, inputClass, PageHeader, Panel, SearchField} from '../../components/ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatDate, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {dialog} from '../../stores/useDialogStore';
import {JOB_GLYPH, JOB_LABEL, JOBS, type StaffJob} from '../../lib/orders';
import {useAuthStore, type AuthUser, type Role} from '../../stores/useAuthStore';

type ManagedUser = AuthUser;

const ROLES: Role[] = ['staff', 'manager', 'owner'];

const ROLE_LABEL: Record<Role, string> = {
  staff: 'STAFF',
  manager: 'ÜZLETVEZETŐ',
  owner: 'TULAJDONOS'
};

const ROLE_OPTIONS = ROLES.map((role) => ({
  value: role,
  label: ROLE_LABEL[role],
  description:
    role === 'owner' ? 'Mindent lát és mindent tehet.' : role === 'manager' ? 'Műszak, ház, raktár, foglalások.' : 'Kassza és a saját műszak.'
}));

const SELECTABLE_JOBS = JOBS.filter((job): job is Exclude<StaffJob, ''> => job !== '');

type Filter = 'active' | 'all' | 'managers';

interface Draft {
  name: string;
  username: string;
  nickname: string;
  title: string;
  role: Role;
  jobs: string[];
  idNumber: string;
  showPublic: boolean;
}

const JobPicker: React.FC<{value: string[]; onChange: (jobs: string[]) => void}> = ({value, onChange}) => (
  <div className="flex flex-wrap gap-1.5">
    {SELECTABLE_JOBS.map((job) => {
      const active = value.includes(job);
      return (
        <button
          key={job}
          type="button"
          onClick={() => onChange(active ? value.filter((entry) => entry !== job) : [...value, job])}
          aria-pressed={active}
          className={`rm-chip !px-3 !py-2 !text-[8px]${active ? ' is-active' : ''}`}
        >
          <span className="font-heading text-[11px] text-[color:var(--rm-red)]" aria-hidden="true">
            {JOB_GLYPH[job]}
          </span>
          {JOB_LABEL[job]}
        </button>
      );
    })}
  </div>
);

export const UsersPage: React.FC = () => {
  const me = useAuthStore((state) => state.user);
  const {data, refresh} = useLiveData<{users: ManagedUser[]}>('/api/users', {intervalMs: 30000});

  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [jobs, setJobs] = useState<string[]>([]);
  const [nickname, setNickname] = useState('');

  const users = useMemo(() => data?.users || [], [data]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      if (filter === 'active' && !user.active) return false;
      if (filter === 'managers' && user.role === 'staff') return false;
      if (!needle) return true;
      return `${user.name} ${user.username} ${user.nickname}`.toLowerCase().includes(needle);
    });
  }, [users, filter, query]);

  const counts = useMemo(
    () => ({
      active: users.filter((user) => user.active).length,
      all: users.length,
      managers: users.filter((user) => user.role !== 'staff').length
    }),
    [users]
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

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    run(async () => {
      await apiSend('/api/users', 'POST', {name, username, password, role, jobs, nickname, mustChangePassword: true});
      setName('');
      setUsername('');
      setPassword('');
      setRole('staff');
      setJobs([]);
      setNickname('');
    }, 'Fiók létrehozva. Első belépéskor jelszót kell cserélnie.');
  };

  const startEdit = (user: ManagedUser) => {
    setEditingId(user.id);
    setDraft({
      name: user.name,
      username: user.username,
      nickname: user.nickname,
      title: user.title,
      role: user.role,
      jobs: user.jobs,
      idNumber: user.idNumber,
      showPublic: user.showPublic
    });
  };

  const saveEdit = (user: ManagedUser) => {
    if (!draft) return;
    run(async () => {
      await apiSend(`/api/users/${user.id}`, 'PATCH', draft);
      setEditingId(null);
      setDraft(null);
    }, `${draft.name} mentve.`);
  };

  const resetPassword = async (user: ManagedUser) => {
    const next = await dialog.prompt({
      title: `${user.name} — új jelszó`,
      message: 'Ideiglenes jelszó. A dolgozó az első belépéskor sajátra cseréli, és minden eszközén kijelentkezik.',
      label: 'ÚJ JELSZÓ',
      type: 'password',
      confirmLabel: 'JELSZÓ BEÁLLÍTÁSA',
      validate: (value) =>
        value.length < 8 ? 'Legalább nyolc karakter.' : !/[a-zA-Z]/.test(value) || !/\d/.test(value) ? 'Betű és szám is kell.' : null
    });
    if (next === null) return;
    run(() => apiSend(`/api/users/${user.id}`, 'PATCH', {password: next, mustChangePassword: true}), `${user.name}: jelszó frissítve.`);
  };

  const toggleActive = async (user: ManagedUser) => {
    if (user.active) {
      const sure = await dialog.confirm({
        title: `Letiltod: ${user.name}?`,
        message: 'A fiók megmarad, de nem tud belépni és minden munkamenete lezárul. Bármikor visszakapcsolható.',
        confirmLabel: 'LETILTÁS',
        tone: 'danger'
      });
      if (!sure) return;
    }
    run(() => apiSend(`/api/users/${user.id}`, 'PATCH', {active: !user.active}), user.active ? `${user.name} letiltva.` : `${user.name} újra aktív.`);
  };

  const remove = async (user: ManagedUser) => {
    const sure = await dialog.confirm({
      title: `Törlöd: ${user.name}?`,
      message: 'A fiók végleg törlődik. Az eladásai és műszakjai megmaradnak, csak a belépés szűnik meg. Letiltás helyett nem visszavonható.',
      detail: `${user.username} · ${ROLE_LABEL[user.role]}`,
      confirmLabel: 'VÉGLEGES TÖRLÉS',
      tone: 'danger'
    });
    if (!sure) return;
    run(() => apiSend(`/api/users/${user.id}`, 'DELETE'), `${user.name} törölve.`);
  };

  const forceLogout = (user: ManagedUser) =>
    run(() => apiSend(`/api/users/${user.id}/force-logout`, 'POST', {}), `${user.name} kiléptetve.`);

  const regenerateSignature = async (user: ManagedUser) => {
    const sure = await dialog.confirm({
      title: 'Új aláírás?',
      message: `${user.name} kap egy új, a nevéből rajzolt aláírást. A korábbi dokumentumok nem változnak, az újak már ezt viselik.`,
      confirmLabel: 'ÚJ ALÁÍRÁS'
    });
    if (!sure) return;
    run(() => apiSend(`/api/users/${user.id}/signature`, 'POST', {}), 'Új aláírás elkészült.');
  };

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / FIÓKOK"
          title={
            <>
              A <em>személyzet.</em>
            </>
          }
          lead="Egy fiók, minden eszköz. A jogosultság dönti el, mit tehet valaki; a beosztás azt, mi a dolga. A tulajdonos mindent tehet."
        />

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchField value={query} onChange={setQuery} placeholder="NÉV VAGY FELHASZNÁLÓNÉV…" className="sm:max-w-xs"/>
          <Chips
            value={filter}
            onChange={setFilter}
            options={[
              {id: 'active', label: 'AKTÍV', count: counts.active},
              {id: 'managers', label: 'VEZETŐK', count: counts.managers},
              {id: 'all', label: 'ÖSSZES', count: counts.all}
            ]}
          />
        </div>

        <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-3">
          <Panel padded={false} label={`FIÓKOK (${visible.length})`} className="xl:col-span-2">
            {!visible.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">Nincs ilyen fiók.</p>}

            {visible.map((user) => {
              const editing = editingId === user.id && draft;
              return (
                <div key={user.id} className={`border-b border-white/[0.04] px-6 py-4 ${user.active ? '' : 'opacity-60'}`}>
                  {editing ? (
                    <div className="flex flex-col gap-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <Field label="NÉV">
                          <input value={draft.name} onChange={(event) => setDraft({...draft, name: event.target.value})} className={inputClass}/>
                        </Field>
                        <Field label="FELHASZNÁLÓNÉV">
                          <input value={draft.username} onChange={(event) => setDraft({...draft, username: event.target.value})} className={inputClass}/>
                        </Field>
                        <Field label="BECENÉV">
                          <input value={draft.nickname} onChange={(event) => setDraft({...draft, nickname: event.target.value})} className={inputClass}/>
                        </Field>
                        <Field label="TITULUS (DOKUMENTUMOKON)">
                          <input value={draft.title} onChange={(event) => setDraft({...draft, title: event.target.value})} placeholder="pl. Üzletvezető" className={inputClass}/>
                        </Field>
                        <Field label="JOGOSULTSÁG">
                          <Select value={draft.role} options={ROLE_OPTIONS} onChange={(value) => setDraft({...draft, role: value})} disabled={user.id === me?.id}/>
                        </Field>
                        <Field label="IGAZOLVÁNYSZÁM (DOKUMENTUMOKON)">
                          <input value={draft.idNumber} onChange={(event) => setDraft({...draft, idNumber: event.target.value})} className={inputClass}/>
                        </Field>
                      </div>
                      <Field label="BEOSZTÁS (TÖBB IS LEHET)">
                        <JobPicker value={draft.jobs} onChange={(next) => setDraft({...draft, jobs: next})}/>
                      </Field>
                      <label className="flex items-center gap-3 text-[10px] text-[#c9c2c1]">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={draft.showPublic}
                          onClick={() => setDraft({...draft, showPublic: !draft.showPublic})}
                          className="rm-switch"
                        />
                        Megjelenhet a nyilvános oldalon (Rólunk)
                      </label>
                      <div className="flex gap-2">
                        <Btn variant="red" onClick={() => saveEdit(user)} disabled={busy}>
                          <Check size={12}/> MENTÉS
                        </Btn>
                        <Btn
                          onClick={() => {
                            setEditingId(null);
                            setDraft(null);
                          }}
                        >
                          <X size={12}/> MÉGSE
                        </Btn>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-4">
                      <Avatar name={user.name} nickname={user.nickname} src={user.avatar} size={40}/>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="truncate text-[12px] text-white">{user.name}</strong>
                          {user.id === me?.id && <Badge tone="red">TE</Badge>}
                          <Badge tone={user.role === 'owner' ? 'red' : user.role === 'manager' ? 'sky' : 'muted'}>{ROLE_LABEL[user.role]}</Badge>
                          {!user.active && <Badge tone="warn">LETILTVA</Badge>}
                          {user.mustChangePassword === undefined ? null : null}
                        </div>
                        <span className="mt-1 block text-[9px] text-[#777]">
                          {user.username}
                          {user.title ? ` · ${user.title}` : ''}
                          {user.jobs.length ? ` · ${user.jobs.map((job) => JOB_LABEL[job as StaffJob] || job).join(', ')}` : ''}
                          {' · '}
                          {user.phone || 'nincs telefon'}
                          {user.lastActiveAt ? ` · utoljára ${formatDate(user.lastActiveAt)} ${formatTime(user.lastActiveAt)}` : ''}
                        </span>
                      </div>

                      {user.hasSignature && user.signatureSvg && (
                        <div className="hidden w-28 md:block">
                          <div className="rm-signature-card !p-1" dangerouslySetInnerHTML={{__html: user.signatureSvg}}/>
                        </div>
                      )}

                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => startEdit(user)} aria-label="Szerkesztés" title="Szerkesztés" className="p-1.5 text-[#777] transition-colors hover:text-white">
                          <PenLine size={13}/>
                        </button>
                        <button type="button" onClick={() => resetPassword(user)} aria-label="Jelszó visszaállítása" title="Új jelszó" className="p-1.5 text-[#777] transition-colors hover:text-white">
                          <KeyRound size={13}/>
                        </button>
                        {user.role !== 'staff' && (
                          <button type="button" onClick={() => regenerateSignature(user)} aria-label="Új aláírás" title="Új aláírás" className="p-1.5 text-[#777] transition-colors hover:text-white">
                            <RefreshCw size={13}/>
                          </button>
                        )}
                        {user.id !== me?.id && (
                          <>
                            <button type="button" onClick={() => forceLogout(user)} aria-label="Kiléptetés" title="Kiléptetés minden eszközről" className="p-1.5 text-[#777] transition-colors hover:text-white">
                              <LogOut size={13}/>
                            </button>
                            <button type="button" onClick={() => toggleActive(user)} aria-label={user.active ? 'Letiltás' : 'Engedélyezés'} title={user.active ? 'Letiltás' : 'Engedélyezés'} className="p-1.5 text-[#777] transition-colors hover:text-amber-300">
                              {user.active ? <Ban size={13}/> : <Check size={13}/>}
                            </button>
                            <button type="button" onClick={() => remove(user)} aria-label="Fiók törlése" title="Végleges törlés" className="p-1.5 text-[#777] transition-colors hover:text-[color:var(--rm-red)]">
                              <Trash2 size={13}/>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </Panel>

          <form onSubmit={create} className="rm-card flex h-fit flex-col gap-3.5 p-7">
            <span className="rm-label">ÚJ FIÓK</span>
            <h2 className="mb-1 font-heading text-[20px] text-white">Létrehozás</h2>

            <Field label="NÉV">
              <input value={name} onChange={(event) => setName(event.target.value)} required className={inputClass}/>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="FELHASZNÁLÓNÉV">
                <input value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="off" className={inputClass}/>
              </Field>
              <Field label="BECENÉV">
                <input value={nickname} onChange={(event) => setNickname(event.target.value)} className={inputClass}/>
              </Field>
            </div>
            <Field label="IDEIGLENES JELSZÓ" hint="Legalább nyolc karakter, betűvel és számmal. Első belépéskor cserélni kell.">
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" className={inputClass}/>
            </Field>
            <Field label="JOGOSULTSÁG">
              <Select value={role} options={ROLE_OPTIONS} onChange={setRole}/>
            </Field>
            <Field label="BEOSZTÁS">
              <JobPicker value={jobs} onChange={setJobs}/>
            </Field>

            <Btn type="submit" variant="red" disabled={busy} className="mt-2 justify-center">
              <UserPlus size={13}/> LÉTREHOZÁS
            </Btn>

            <p className="mt-2 flex items-start gap-2 text-[9px] leading-[1.6] text-[#777]">
              <ShieldCheck size={11} className="mt-0.5 shrink-0 text-[color:var(--rm-red)]"/>
              Üzletvezetői vagy tulajdonosi fiók a létrehozáskor automatikusan aláírást kap, amit a dokumentumok viselnek.
              A DJ pultot a „DJ” beosztás nyitja meg; a tulajdonosnak mindenhez van joga.
            </p>
          </form>
        </div>
      </section>
    </main>
  );
};
