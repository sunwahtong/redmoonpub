import React, {useEffect, useState} from 'react';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {KeyRound, LogOut, Phone, ShieldCheck} from 'lucide-react';
import {NeonHeading} from '../components/ui/NeonHeading';
import {Btn, BtnLink} from '../components/ui/Btn';
import {Field, inputClass} from '../components/ui/console';
import {useAuthStore, roleAtLeast} from '../stores/useAuthStore';
import {apiSend} from '../lib/api';
import {playSfx} from '../lib/sfx';
import {JOB_LABEL, type StaffJob} from '../lib/orders';

const ROLE_LABEL: Record<string, string> = {
  staff: 'STAFF',
  manager: 'ÜZLETVEZETŐ',
  owner: 'TULAJDONOS'
};

const PHONE_PREFIX = '+38-76-';

export const StaffLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {user, loading, error, login, logout, restore, savePhone, sessionConflict} = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const [phone, setPhone] = useState(PHONE_PREFIX);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const from = (location.state as {from?: string} | null)?.from || '/staff';

  useEffect(() => {
    if (!user && loading) restore();
  }, [user, loading, restore]);

  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const digits = value.startsWith(PHONE_PREFIX) ? value.slice(PHONE_PREFIX.length).replace(/\D/g, '').slice(0, 7) : '';
    setPhone(PHONE_PREFIX + digits);
  };

  const submit = async (event: React.FormEvent, force = false) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await login(username.trim(), password, {force});
      playSfx('login');
      setPassword('');
    } catch {
      playSfx('error');
    } finally {
      setBusy(false);
    }
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

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword !== repeatPassword) {
      setPasswordError('A két új jelszó nem egyezik.');
      playSfx('error');
      return;
    }
    setBusy(true);
    try {
      await apiSend('/api/profile/password', 'POST', {currentPassword, newPassword});
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      await restore();
      playSfx('success');
    } catch (err) {
      setPasswordError((err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await logout();
    playSfx('logout');
    navigate('/');
  };

  const needsPassword = !!user?.mustChangePassword;
  const needsPhone = !!user && !needsPassword && !user.phone;

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

      <div className="relative z-[1] w-full max-w-[460px] py-16">
        <div className="rm-label">RED MOON / STAFF</div>

        {needsPassword ? (
          <>
            <NeonHeading as="h1" size={2} className="my-5">
              Új jelszó <em>kell.</em>
            </NeonHeading>
            <p className="mb-8 text-[12px] leading-[1.8] text-[#9e9795]">
              Ezt a fiókot ideiglenes jelszóval kaptad. Válassz sajátot, mielőtt belépsz a konzolba: legalább nyolc
              karakter, betűvel és számmal.
            </p>
            <form onSubmit={submitPassword} className="flex flex-col gap-3.5 border border-[color:var(--rm-line)] bg-[#09090b] p-8">
              <Field label="JELENLEGI (IDEIGLENES) JELSZÓ">
                <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" className={inputClass}/>
              </Field>
              <Field label="ÚJ JELSZÓ">
                <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} autoComplete="new-password" className={inputClass}/>
              </Field>
              <Field label="ÚJ JELSZÓ ÚJRA">
                <input type="password" value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} required minLength={8} autoComplete="new-password" className={inputClass}/>
              </Field>
              <Btn type="submit" variant="red" disabled={busy} className="mt-2 justify-center">
                <KeyRound size={13}/> {busy ? 'MENTÉS…' : 'JELSZÓ MENTÉSE'}
              </Btn>
              {passwordError && (
                <p role="alert" className="text-[11px] text-[color:var(--rm-red)]">
                  {passwordError}
                </p>
              )}
              <button type="button" onClick={signOut} className="mt-1 text-left text-[9px] tracking-[0.18em] text-[#777] hover:text-white">
                INKÁBB KIJELENTKEZEM
              </button>
            </form>
          </>
        ) : needsPhone ? (
          <>
            <NeonHeading as="h1" size={2} className="my-5">
              Telefonszám <em>kell.</em>
            </NeonHeading>
            <p className="mb-8 text-[12px] leading-[1.8] text-[#9e9795]">
              Első belépéskor meg kell adnod a telefonszámodat. E nélkül a konzol műveletei nem érhetők el.
            </p>
            <form onSubmit={submitPhone} className="flex flex-col gap-3.5 border border-[color:var(--rm-line)] bg-[#09090b] p-8">
              <Field label="TELEFONSZÁM" hint="Pontosan hét számjegy. A +38-76 előtag adott.">
                <input value={phone} onChange={handlePhoneChange} inputMode="numeric" required className={inputClass}/>
              </Field>
              <Btn type="submit" variant="red" className="mt-2 justify-center">
                <Phone size={13}/> MENTÉS
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
                    {user.jobs.length ? ` · ${user.jobs.map((job) => JOB_LABEL[job as StaffJob] || job).join(', ')}` : ''}
                  </span>
                </div>
              </div>

              <p className="mt-6 text-[11px] leading-[1.8] text-[#8d8584]">
                {roleAtLeast(user.role, 'manager')
                  ? 'Üzletvezetőként nyithatod a házat, kezeled a foglalásokat és jelölőket helyezhetsz a térképre.'
                  : 'A konzolban a műszakod, a kassza és a beszerzések várnak.'}
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <BtnLink to={from.startsWith('/staff') ? from : '/staff'} variant="red">
                  KONZOL ↗
                </BtnLink>
                {user.capabilities.dj && <BtnLink to="/dj">DJ PULT ↗</BtnLink>}
                <Btn onClick={signOut}>
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
              A Red Moon belső konzolja. Egy fiók, minden eszköz: kassza, műszak, DJ pult, ház.
            </p>

            <form onSubmit={submit} className="flex flex-col gap-3.5 border border-[color:var(--rm-line)] bg-[#09090b] p-8">
              <Field label="FELHASZNÁLÓNÉV">
                <input value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" className={inputClass}/>
              </Field>
              <Field label="JELSZÓ">
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" className={inputClass}/>
              </Field>

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

              <p className="mt-2 text-[9px] leading-[1.7] text-[#6f6968]">
                Elfelejtett jelszó? Egy tulajdonos tud újat adni a Fiókok menüben.{' '}
                <Link to="/" className="text-[color:var(--rm-red)] hover:text-white">
                  Vissza a főoldalra ↗
                </Link>
              </p>
            </form>
          </>
        )}
      </div>
    </main>
  );
};
