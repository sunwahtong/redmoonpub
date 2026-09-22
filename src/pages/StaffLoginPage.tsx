import React, {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {LogOut, ShieldCheck} from 'lucide-react';
import {NeonHeading} from '../components/ui/NeonHeading';
import {Btn, BtnLink} from '../components/ui/Btn';
import {useAuthStore, roleAtLeast} from '../stores/useAuthStore';
import {playSfx} from '../lib/sfx';

const ROLE_LABEL: Record<string, string> = {
  staff: 'KASSZÁS / STAFF',
  manager: 'ÜZLETVEZETŐ',
  owner: 'TULAJDONOS',
  dj: 'DJ'
};

export const StaffLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const {user, loading, error, login, logout, restore, savePhone, sessionConflict} = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [portal, setPortal] = useState<'staff' | 'dj'>('staff');
  const [phone, setPhone] = useState('+38-76-');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // The API rejects every staff call until a phone number is on file.
  const needsPhone = !!user && !user.phone;

  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const prefix = '+38-76-';
    const value = event.target.value;
    const digits = value.startsWith(prefix) ? value.slice(prefix.length).replace(/\D/g, '').slice(0, 7) : '';
    setPhone(prefix + digits);
  };

  const submitPhone = async (event: React.FormEvent) => {
    event.preventDefault();
    setPhoneError(null);
    try {
      await savePhone(phone);
      playSfx('success');
    } catch (err) {
      setPhoneError((err as Error).message);
      playSfx('error');
    }
  };

  useEffect(() => {
    if (!user && loading) restore();
  }, [user, loading, restore]);

  const submit = async (event: React.FormEvent, force = false) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await login(username.trim(), password, {force, portal});
      playSfx('login');
      setPassword('');
    } catch {
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center overflow-hidden px-[var(--rm-gutter)] pt-[68px]">
      <div
        className="pointer-events-none absolute inset-0 bg-[url('/assets/red-moon-cinematic-v27.webp')] bg-cover bg-center opacity-25"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#050304] via-[rgba(5,3,4,0.82)] to-transparent"
        aria-hidden="true"
      />

      <div className="relative z-[1] w-full max-w-[440px]">
        <div className="rm-label">RED MOON / STAFF</div>

        {needsPhone ? (
          <>
            <NeonHeading as="h1" size={2} className="my-5">
              Telefonszám <em>kell.</em>
            </NeonHeading>
            <p className="mb-8 text-[12px] leading-[1.8] text-[#9e9795]">
              Első belépéskor meg kell adnod a telefonszámodat. E nélkül a konzol műveletei nem érhetők el.
            </p>

            <form onSubmit={submitPhone} className="flex flex-col gap-3.5 border border-[color:var(--rm-line)] bg-[#09090b] p-8">
              <label className="flex flex-col gap-2">
                <span className="text-[8px] tracking-[0.25em] text-[#777]">TELEFONSZÁM</span>
                <input
                  value={phone}
                  onChange={handlePhoneChange}
                  inputMode="numeric"
                  required
                  className="border border-white/10 bg-black/50 p-3 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]"
                />
              </label>

              <Btn type="submit" variant="red" className="mt-2 justify-center">
                MENTÉS <span>↗</span>
              </Btn>

              {phoneError && (
                <p role="alert" className="text-[11px] text-[color:var(--rm-red)]">
                  {phoneError}
                </p>
              )}
            </form>
          </>
        ) : user ? (
          <>
            <NeonHeading as="h1" size={2} className="my-5">
              Be vagy <em>lépve.</em>
            </NeonHeading>

            <div className="border border-[color:var(--rm-line)] bg-[#09090b] p-8">
              <div className="flex items-center gap-3">
                <ShieldCheck size={18} className="text-[color:var(--rm-red)]"/>
                <div>
                  <strong className="block font-heading text-[20px] text-white">{user.name}</strong>
                  <span className="text-[9px] tracking-[0.2em] text-[color:var(--rm-red)]">
                    {ROLE_LABEL[user.role] || user.role.toUpperCase()}
                  </span>
                </div>
              </div>

              <p className="mt-6 text-[11px] leading-[1.8] text-[#8d8584]">
                {roleAtLeast(user.role, 'manager')
                  ? 'Üzletvezetőként jelölőket helyezhetsz el a térképen, amelyeket minden látogató lát.'
                  : 'A térképjelölők elhelyezéséhez üzletvezetői jogosultság szükséges.'}
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <BtnLink to="/location" variant="red">
                  TÉRKÉP ↗
                </BtnLink>
                <Btn
                  onClick={async () => {
                    await logout();
                    playSfx('logout');
                    navigate('/');
                  }}
                >
                  <LogOut size={13}/> KIJELENTKEZÉS
                </Btn>
              </div>
            </div>
          </>
        ) : (
          <>
            <NeonHeading as="h1" size={2} className="my-5">
              Staff <em>belépés.</em>
            </NeonHeading>
            <p className="mb-8 text-[12px] leading-[1.8] text-[#9e9795]">
              A Red Moon belső konzolja. Csak személyzeti fiókkal.
            </p>

            <form onSubmit={submit} className="flex flex-col gap-3.5 border border-[color:var(--rm-line)] bg-[#09090b] p-8">
              <div className="mb-1 flex gap-2">
                {(['staff', 'dj'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPortal(option)}
                    aria-pressed={portal === option}
                    className={`flex-1 border px-3 py-2.5 text-[9px] font-bold tracking-[0.2em] transition-all ${
                      portal === option
                        ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.14)] text-white'
                        : 'border-white/10 text-[#8f8887] hover:border-white/30 hover:text-white'
                    }`}
                  >
                    {option === 'staff' ? 'KASSZA / STAFF' : 'DJ PULT'}
                  </button>
                ))}
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-[8px] tracking-[0.25em] text-[#777]">FELHASZNÁLÓNÉV</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  autoComplete="username"
                  className="border border-white/10 bg-black/50 p-3 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-[8px] tracking-[0.25em] text-[#777]">JELSZÓ</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="current-password"
                  className="border border-white/10 bg-black/50 p-3 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]"
                />
              </label>

              <Btn type="submit" variant="red" disabled={busy} className="mt-2 justify-center">
                {busy ? 'BELÉPÉS…' : 'BELÉPÉS'} <span>↗</span>
              </Btn>

              {error && (
                <p role="alert" className="text-[11px] text-[color:var(--rm-red)]">
                  {error}
                </p>
              )}

              {sessionConflict && (
                <Btn type="button" onClick={(event) => submit(event, true)} className="justify-center">
                  KILÉPTETÉS ONNAN ÉS BELÉPÉS ITT
                </Btn>
              )}
            </form>
          </>
        )}
      </div>
    </main>
  );
};
