import React, {useState} from 'react';
import {KeyRound, ShieldCheck, Trash2, UserPlus} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn} from '../../components/ui/Btn';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatDate} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {useAuthStore, type Role} from '../../stores/useAuthStore';

interface ManagedUser {
  id: string;
  username: string;
  name: string;
  nickname: string;
  role: Role;
  portal: string;
  phone: string;
  lastActiveAt: string | null;
}

const ROLES: Role[] = ['staff', 'manager', 'owner', 'dj'];

const ROLE_LABEL: Record<string, string> = {
  staff: 'KASSZÁS',
  manager: 'ÜZLETVEZETŐ',
  owner: 'TULAJDONOS',
  dj: 'DJ'
};

export const UsersPage: React.FC = () => {
  const me = useAuthStore((state) => state.user);
  const {data, refresh} = useLiveData<{users: ManagedUser[]}>('/api/users', {intervalMs: 30000});

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [message, setMessage] = useState<{kind: 'ok' | 'error'; text: string} | null>(null);

  const users = data?.users || [];

  const run = async (action: () => Promise<unknown>, okText: string) => {
    setMessage(null);
    try {
      await action();
      setMessage({kind: 'ok', text: okText});
      playSfx('success');
      refresh();
    } catch (err) {
      setMessage({kind: 'error', text: (err as Error).message});
      playSfx('error');
    }
  };

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    run(async () => {
      await apiSend('/api/users', 'POST', {name, username, password, role});
      setName('');
      setUsername('');
      setPassword('');
      setRole('staff');
    }, 'Fiók létrehozva.');
  };

  const changeRole = (user: ManagedUser, nextRole: Role) =>
    run(() => apiSend(`/api/users/${user.id}`, 'PATCH', {role: nextRole}), `${user.name}: ${ROLE_LABEL[nextRole]}.`);

  const resetPassword = (user: ManagedUser) => {
    const next = window.prompt(`${user.name} — új jelszó (min. 8 karakter):`, '');
    if (next === null) return;
    if (next.length < 8) {
      setMessage({kind: 'error', text: 'Az új jelszó legyen legalább 8 karakter.'});
      return;
    }
    run(() => apiSend(`/api/users/${user.id}`, 'PATCH', {password: next}), `${user.name}: jelszó frissítve.`);
  };

  const remove = (user: ManagedUser) => {
    if (!window.confirm(`Biztosan törlöd: ${user.name} (${user.username})?`)) return;
    run(() => apiSend(`/api/users/${user.id}`, 'DELETE'), `${user.name} törölve.`);
  };

  const field =
    'w-full border border-white/10 bg-black/50 p-3 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]';

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / FIÓKOK</div>
        <NeonHeading as="h1" size={2} className="mb-8 mt-3.5">
          A <em>személyzet.</em>
        </NeonHeading>

        {message && (
          <p className={`mb-6 text-[11px] ${message.kind === 'ok' ? 'text-emerald-400' : 'text-[color:var(--rm-red)]'}`}>
            {message.text}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <div className="rm-card p-0 lg:col-span-2">
            <div className="border-b border-[color:var(--rm-line)] px-6 py-4">
              <span className="rm-label">FIÓKOK ({users.length})</span>
            </div>

            {users.map((user) => (
              <div key={user.id} className="border-b border-white/[0.04] px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block truncate text-[12px] text-white">
                      {user.name}
                      {user.id === me?.id && <span className="ml-2 text-[9px] text-[color:var(--rm-red)]">TE</span>}
                    </strong>
                    <span className="text-[9px] text-[#777]">
                      {user.username} · {user.phone || 'nincs telefon'}
                      {user.lastActiveAt ? ` · ${formatDate(user.lastActiveAt)}` : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={user.role}
                      onChange={(event) => changeRole(user, event.target.value as Role)}
                      aria-label={`${user.name} jogosultsága`}
                      className="border border-white/10 bg-black/50 px-2 py-1.5 text-[10px] text-white outline-none focus:border-[color:var(--rm-red)]"
                    >
                      {ROLES.map((option) => (
                        <option key={option} value={option}>
                          {ROLE_LABEL[option]}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => resetPassword(user)}
                      aria-label="Jelszó visszaállítása"
                      className="text-[#777] transition-colors hover:text-white"
                    >
                      <KeyRound size={13}/>
                    </button>

                    <button
                      type="button"
                      onClick={() => remove(user)}
                      disabled={user.id === me?.id}
                      aria-label="Fiók törlése"
                      className="text-[#777] transition-colors hover:text-[color:var(--rm-red)] disabled:opacity-30"
                    >
                      <Trash2 size={13}/>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={create} className="rm-card flex h-fit flex-col gap-3.5 p-7">
            <span className="rm-label">ÚJ FIÓK</span>
            <h2 className="mb-1 font-heading text-[20px] text-white">Létrehozás</h2>

            <label className="flex flex-col gap-2">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">NÉV</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required className={field}/>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">FELHASZNÁLÓNÉV</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoComplete="off"
                className={field}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">JELSZÓ</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={field}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">JOGOSULTSÁG</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
                className={field}
              >
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABEL[option]}
                  </option>
                ))}
              </select>
            </label>

            <Btn type="submit" variant="red" className="mt-2 justify-center">
              <UserPlus size={13}/> LÉTREHOZÁS
            </Btn>

            <p className="mt-2 flex items-start gap-2 text-[9px] leading-[1.6] text-[#777]">
              <ShieldCheck size={11} className="mt-0.5 shrink-0 text-[color:var(--rm-red)]"/>
              DJ fiók csak a DJ pultba lép be. A kasszás, üzletvezető és tulajdonos fiókok a staff konzolt használják.
            </p>
          </form>
        </div>
      </section>
    </main>
  );
};
