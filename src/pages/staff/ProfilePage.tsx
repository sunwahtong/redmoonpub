import React, {useMemo, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Camera, Coins, KeyRound, LogOut, Play, Receipt, Timer, Trash2, Truck} from 'lucide-react';
import {Btn} from '../../components/ui/Btn';
import {ActivityCalendar} from '../../components/ui/ActivityCalendar';
import {Avatar, Badge, Chips, Field, inputClass, PageHeader, Panel, Stat} from '../../components/ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatHuf, formatTime} from '../../lib/api';
import {uploadMedia} from '../../lib/media';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {JOB_GLYPH, JOB_LABEL, type StaffJob} from '../../lib/orders';
import {roleAtLeast, useAuthStore, type AuthUser} from '../../stores/useAuthStore';
import {SignatureStudio} from '../../components/profile/SignatureStudio';
import {requiredModules, TOUR_MODULES} from '../../lib/tour';
import {startTour} from '../../stores/useTourStore';

interface PersonalAnalytics {
  totals: {
    shifts: number;
    hours: number;
    sales: number;
    items: number;
    revenue: number;
    orders: number;
    orderEstimated: number;
    orderActual: number;
    orderVariance: number;
  };
  recentShifts: {id: string; startedAt: string; endedAt: string | null; hours: number; revenue: number}[];
  days: {date: string; shifts: number; hours: number; sales: number; revenue: number; orders: number; spend: number}[];
}

type Metric = 'revenue' | 'hours' | 'orders';

const METRIC_LABEL: Record<Metric, string> = {revenue: 'BEVÉTEL', hours: 'LEDOLGOZOTT ÓRA', orders: 'BESZERZÉS'};

const ROLE_LABEL: Record<string, string> = {staff: 'STAFF', manager: 'MANAGER', owner: 'TULAJDONOS'};

const PHONE_PREFIX = '+38-76-';

/** Shrinks a picked image to a small square JPEG data URL. */
/** Square crop at a modest size: the picture is uploaded, so it stays small. */
async function resizeAvatar(file: File, size = 320): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('A kép nem olvasható.'));
      element.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A kép nem dolgozható fel.');
    const side = Math.min(image.width, image.height);
    const sx = (image.width - side) / 2;
    const sy = (image.height - side) / 2;
    context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('A kép nem dolgozható fel.');
    return new File([blob], 'avatar.jpg', {type: 'image/jpeg'});
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const {user, setUser, savePhone, logout} = useAuthStore();
  const {data: analytics} = useLiveData<PersonalAnalytics>('/api/analytics/me', {intervalMs: 60000});
  const [metric, setMetric] = useState<Metric>('revenue');
  const fileRef = useRef<HTMLInputElement>(null);

  const totals = analytics?.totals;
  const days = useMemo(() => analytics?.days || [], [analytics]);

  const [name, setName] = useState(user?.name || '');
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [idNumber, setIdNumber] = useState(user?.idNumber || '');
  const [phone, setPhone] = useState(user?.phone || PHONE_PREFIX);
  const [busy, setBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');

  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const digits = value.startsWith(PHONE_PREFIX) ? value.slice(PHONE_PREFIX.length).replace(/\D/g, '').slice(0, 7) : '';
    setPhone(PHONE_PREFIX + digits);
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const data = await apiSend<{user: AuthUser}>('/api/profile', 'PATCH', {name, nickname, idNumber});
      setUser(data.user);
      if (!user?.phone && phone !== PHONE_PREFIX) await savePhone(phone);
      toast.success('Profil mentve.');
      playSfx('success');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error('PNG, JPG vagy WebP képet válassz.');
      return;
    }
    try {
      const media = await uploadMedia('image', 'avatar', await resizeAvatar(file));
      const data = await apiSend<{user: AuthUser}>('/api/profile', 'PATCH', {avatar: media.url, avatarPublicId: media.publicId});
      setUser(data.user);
      toast.success('Profilkép frissítve.');
      playSfx('success');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clearAvatar = async () => {
    try {
      const data = await apiSend<{user: AuthUser}>('/api/profile', 'PATCH', {avatar: '', avatarPublicId: ''});
      setUser(data.user);
      playSfx('delete');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== repeatPassword) {
      toast.error('A két új jelszó nem egyezik.');
      playSfx('error');
      return;
    }
    try {
      await apiSend('/api/profile/password', 'POST', {currentPassword, newPassword});
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      toast.success('Jelszó megváltoztatva.', 'A többi eszközön kiléptettünk.');
      playSfx('success');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    }
  };

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / PROFIL"
          title={
            <>
              A te <em>fiókod.</em>
            </>
          }
          lead="Amit a ház nyilvántart rólad: ledolgozott órák, eladások, beszerzések — és az aláírásod, ha managerként vagy tulajdonosként dokumentumot állítasz ki."
          actions={
            <Btn
              onClick={async () => {
                await logout();
                playSfx('logout');
                navigate('/');
              }}
            >
              <LogOut size={13}/> KIJELENTKEZÉS
            </Btn>
          }
        />

        {/* ------------------------------------------------ IDENTITY */}
        <Panel className="mb-3.5">
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            <div className="relative">
              <Avatar name={user?.name || ''} nickname={user?.nickname} src={user?.avatar} size={96}/>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Profilkép cseréje"
                className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center border border-[color:var(--rm-red)] bg-[#09090b] text-white transition-colors hover:bg-[color:var(--rm-red)]"
              >
                <Camera size={13}/>
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pickAvatar} className="hidden"/>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="font-heading text-[24px] leading-none text-white">{user?.name}</strong>
                <Badge tone="red">{ROLE_LABEL[user?.role || ''] || user?.role}</Badge>
              </div>
              <p className="mt-2 text-[10px] text-[#8d8584]">
                {user?.username}
                {user?.title ? ` · ${user.title}` : ''}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(user?.jobs || []).map((job) => (
                  <Badge key={job} tone="muted">
                    <span className="font-heading text-[11px] text-[color:var(--rm-red)]">{JOB_GLYPH[job as StaffJob] || '·'}</span>
                    {JOB_LABEL[job as StaffJob] || job}
                  </Badge>
                ))}
                {!user?.jobs?.length && <span className="text-[10px] text-[#6f6968]">Nincs beosztás megadva.</span>}
              </div>
              {user?.avatar && (
                <button type="button" onClick={clearAvatar} className="mt-3 inline-flex items-center gap-1.5 text-[9px] tracking-[0.18em] text-[#777] hover:text-[color:var(--rm-red)]">
                  <Trash2 size={10}/> PROFILKÉP TÖRLÉSE
                </button>
              )}
            </div>
          </div>
        </Panel>

        {user && roleAtLeast(user.role, 'manager') && (
          <div className="mb-3.5">
            <SignatureStudio user={user}/>
          </div>
        )}

        {/* ------------------------------------------------ RECORD */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={Timer} glyph="時" label="LEDOLGOZOTT ÓRA" value={totals ? String(totals.hours) : '—'} hint={totals ? `${totals.shifts} műszak` : undefined}/>
          <Stat icon={Receipt} glyph="売" label="ELADÁS" value={totals ? String(totals.sales) : '—'} hint={totals ? `${totals.items} tétel` : undefined}/>
          <Stat icon={Coins} glyph="金" label="HOZOTT BEVÉTEL" value={totals ? formatHuf(totals.revenue) : '—'}/>
          <Stat icon={Truck} glyph="運" label="BESZERZÉS" value={totals ? String(totals.orders) : '—'} hint={totals ? `${formatHuf(totals.orderActual)} elköltve` : undefined}/>
        </div>

        {totals && totals.orders > 0 && (
          <Panel className="mt-3.5" label="BESZERZÉSI MÉRLEG" title="Becsült és tényleges.">
            <div className="flex flex-wrap gap-9">
              <div>
                <span className="block text-[8px] tracking-[0.22em] text-[#777]">BECSÜLT</span>
                <strong className="font-heading text-[19px] text-white">{formatHuf(totals.orderEstimated)}</strong>
              </div>
              <div>
                <span className="block text-[8px] tracking-[0.22em] text-[#777]">TÉNYLEGES</span>
                <strong className="font-heading text-[19px] text-white">{formatHuf(totals.orderActual)}</strong>
              </div>
              <div>
                <span className="block text-[8px] tracking-[0.22em] text-[#777]">ELTÉRÉS</span>
                <span className="rm-variance mt-1" data-severity={Math.abs(totals.orderVariance) === 0 ? 'none' : Math.abs(totals.orderVariance) > totals.orderEstimated * 0.1 ? 'major' : 'minor'}>
                  <b className="font-heading text-[15px]">
                    {totals.orderVariance > 0 ? '+' : ''}
                    {formatHuf(totals.orderVariance)}
                  </b>
                </span>
              </div>
            </div>
          </Panel>
        )}

        {days.length > 0 && (
          <Panel className="mt-3.5" label="AKTIVITÁS" title="Az elmúlt fél év." action={<Chips value={metric} onChange={setMetric} options={(Object.keys(METRIC_LABEL) as Metric[]).map((option) => ({id: option, label: METRIC_LABEL[option]}))}/>}>
            <ActivityCalendar
              days={days}
              metric={metric}
              describe={(day, date) =>
                day
                  ? `${date} · ${day.sales} eladás · ${formatHuf(Number(day.revenue))} · ${Number(day.hours).toFixed(1)} óra · ${day.orders} beszerzés`
                  : `${date} · nincs aktivitás`
              }
            />
          </Panel>
        )}

        {analytics && analytics.recentShifts.length > 0 && (
          <Panel className="mt-3.5" padded={false} label="MŰSZAKOK">
            {analytics.recentShifts.map((shift) => (
              <div key={shift.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.04] px-7 py-4 last:border-b-0">
                <span className="text-[11px] text-white">
                  {shift.id} · {new Date(shift.startedAt).toLocaleDateString('hu-HU')} · {formatTime(shift.startedAt)}
                  {shift.endedAt ? ` – ${formatTime(shift.endedAt)}` : ' – folyamatban'}
                </span>
                <span className="flex gap-7 text-[10px] text-[#8d8584]">
                  <span>{shift.hours} óra</span>
                  <span className="text-[color:var(--rm-red)]">{formatHuf(shift.revenue)}</span>
                </span>
              </div>
            ))}
          </Panel>
        )}

        <div className="rm-gilt my-14"/>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <form onSubmit={saveProfile} className="rm-card flex flex-col gap-3.5 p-7" data-tour="profile">
            <span className="rm-label">ADATOK</span>
            <h2 className="mb-2 font-heading text-[22px] text-white">Alapadatok</h2>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label="NÉV">
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className={inputClass}/>
              </Field>
              <Field label="BECENÉV">
                <input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={40} className={inputClass}/>
              </Field>
            </div>
            <Field label="IGAZOLVÁNYSZÁM" hint="A dokumentumok aláírásblokkjában jelenik meg.">
              <input value={idNumber} onChange={(event) => setIdNumber(event.target.value)} maxLength={40} className={inputClass}/>
            </Field>
            <Field label="TELEFONSZÁM" hint={user?.phone ? 'A számot csak a tulajdonos törölheti.' : 'Egyszer adható meg.'}>
              <input value={phone} onChange={handlePhoneChange} inputMode="numeric" disabled={!!user?.phone} className={inputClass}/>
            </Field>
            <Btn type="submit" variant="red" disabled={busy} className="mt-2 justify-center">
              MENTÉS
            </Btn>
          </form>

          <form onSubmit={changePassword} className="rm-card flex flex-col gap-3.5 p-7">
            <span className="rm-label">BIZTONSÁG</span>
            <h2 className="mb-2 font-heading text-[22px] text-white">Jelszó csere</h2>
            <p className="mb-2 text-[10px] leading-[1.7] text-[#8d8584]">Jelszócsere után minden más eszközön megszűnik a munkamenet. Legalább nyolc karakter, betűvel és számmal.</p>
            <Field label="JELENLEGI JELSZÓ">
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" className={inputClass}/>
            </Field>
            <Field label="ÚJ JELSZÓ">
              <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} autoComplete="new-password" className={inputClass}/>
            </Field>
            <Field label="ÚJ JELSZÓ ÚJRA">
              <input type="password" value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} required minLength={8} autoComplete="new-password" className={inputClass}/>
            </Field>
            <Btn type="submit" variant="red" className="mt-2 justify-center">
              <KeyRound size={13}/> JELSZÓ MENTÉSE
            </Btn>
          </form>
        </div>

        {/* The guided tour, replayable part by part. */}
        <Panel className="mt-3.5" label="BEMUTATÓ" title="A konzol, lépésről lépésre.">
          <p className="text-[11px] leading-[1.7] text-[#8d8584]">Az első belépéskor végigvezettünk a konzolon. Bármelyik részt újranézheted — vagy az egészet elölről.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {requiredModules(user).map((id) => {
              const module = TOUR_MODULES[id];
              const state = user?.tours?.[id];
              return (
                <button key={id} type="button" onClick={() => startTour([id])} className="rm-chip" title={module.blurb}>
                  <Play size={9}/> {module.label}
                  <span className="rm-chip-count">{state === 'done' ? 'megnézve' : state === 'skipped' ? 'kihagyva' : 'új'}</span>
                </button>
              );
            })}
            <button type="button" onClick={() => startTour(requiredModules(user))} className="rm-chip is-active">
              MIND ELÖLRŐL
            </button>
          </div>
        </Panel>
      </section>
    </main>
  );
};
