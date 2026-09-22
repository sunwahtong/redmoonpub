import React, {useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Coins, KeyRound, LogOut, Receipt, Timer, Truck} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn} from '../../components/ui/Btn';
import {ActivityCalendar} from '../../components/ui/ActivityCalendar';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatHuf, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {JOB_GLYPH, JOB_LABEL, type StaffJob} from '../../lib/orders';
import {useAuthStore} from '../../stores/useAuthStore';

interface PersonalAnalytics {
  totals: {
    shifts: number;
    hours: number;
    sales: number;
    items: number;
    revenue: number;
    wage: number;
    orders: number;
    orderEstimated: number;
    orderActual: number;
    orderVariance: number;
  };
  recentShifts: {id: string; startedAt: string; endedAt: string | null; hours: number; revenue: number}[];
  days: {date: string; shifts: number; hours: number; sales: number; revenue: number; orders: number; spend: number}[];
}

/** Which metric the activity calendar colours by. */
type Metric = 'revenue' | 'hours' | 'orders';

const METRIC_LABEL: Record<Metric, string> = {
  revenue: 'BEVÉTEL',
  hours: 'LEDOLGOZOTT ÓRA',
  orders: 'BESZERZÉS'
};

const ROLE_LABEL: Record<string, string> = {
  staff: 'KASSZÁS / STAFF',
  manager: 'ÜZLETVEZETŐ',
  owner: 'TULAJDONOS',
  dj: 'DJ'
};

type Status = {kind: 'ok' | 'error'; message: string} | null;

export const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const {user, setUser, savePhone, logout} = useAuthStore();
  const {data: analytics} = useLiveData<PersonalAnalytics>('/api/analytics/me', {intervalMs: 60000});
  const [metric, setMetric] = useState<Metric>('revenue');

  const totals = analytics?.totals;
  const days = useMemo(() => analytics?.days || [], [analytics]);
  const jobKey = (user?.job || '') as StaffJob;

  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '+38-76-');
  const [profileStatus, setProfileStatus] = useState<Status>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<Status>(null);

  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const prefix = '+38-76-';
    const value = event.target.value;
    const digits = value.startsWith(prefix) ? value.slice(prefix.length).replace(/\D/g, '').slice(0, 7) : '';
    setPhone(prefix + digits);
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileStatus(null);
    try {
      const data = await apiSend<{user: typeof user}>('/api/profile', 'PATCH', {name});
      if (data.user) setUser(data.user);
      if (phone !== user?.phone) await savePhone(phone);
      setProfileStatus({kind: 'ok', message: 'Profil mentve.'});
      playSfx('success');
    } catch (err) {
      setProfileStatus({kind: 'error', message: (err as Error).message});
      playSfx('error');
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordStatus(null);

    if (newPassword !== repeatPassword) {
      setPasswordStatus({kind: 'error', message: 'A két új jelszó nem egyezik.'});
      playSfx('error');
      return;
    }

    try {
      await apiSend('/api/profile/password', 'POST', {currentPassword, newPassword});
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      setPasswordStatus({kind: 'ok', message: 'Jelszó megváltoztatva. A többi eszközön kiléptettünk.'});
      playSfx('success');
    } catch (err) {
      setPasswordStatus({kind: 'error', message: (err as Error).message});
      playSfx('error');
    }
  };

  const field =
    'border border-white/10 bg-black/50 p-3 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]';

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / PROFIL</div>
        <NeonHeading as="h1" size={2} className="mb-3 mt-3.5">
          A te <em>fiókod.</em>
        </NeonHeading>
        <p className="rm-lead mb-12 text-[12px]">
          Amit a ház nyilvántart rólad: ledolgozott órák, eladások, beszerzések.
        </p>

        {/* ------------------------------------------------ RECORD */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {icon: Timer, glyph: '時', label: 'LEDOLGOZOTT ÓRA', value: totals ? String(totals.hours) : '—', hint: totals ? `${totals.shifts} műszak` : undefined},
            {icon: Receipt, glyph: '売', label: 'ELADÁS', value: totals ? String(totals.sales) : '—', hint: totals ? `${totals.items} tétel` : undefined},
            {icon: Coins, glyph: '金', label: 'HOZOTT BEVÉTEL', value: totals ? formatHuf(totals.revenue) : '—', hint: totals ? `Becsült bér: ${formatHuf(totals.wage)}` : undefined},
            {icon: Truck, glyph: '運', label: 'BESZERZÉS', value: totals ? String(totals.orders) : '—', hint: totals ? `${formatHuf(totals.orderActual)} elköltve` : undefined}
          ].map((stat) => (
            <div key={stat.label} className="rm-stat p-6">
              <span className="rm-stat-glyph" aria-hidden="true">{stat.glyph}</span>
              <stat.icon size={15} className="relative mb-4 text-[color:var(--rm-red)]"/>
              <span className="relative block text-[8px] tracking-[0.25em] text-[#777]">{stat.label}</span>
              <strong className="relative mt-2 block font-heading text-[26px] leading-none text-white">{stat.value}</strong>
              {stat.hint && <span className="relative mt-2 block text-[10px] text-[#8d8584]">{stat.hint}</span>}
            </div>
          ))}
        </div>

        {/* The number an audit reads: what the runs were estimated at against
            what they actually cost. */}
        {totals && totals.orders > 0 && (
          <div className="rm-card mt-3.5 flex flex-wrap items-center justify-between gap-6 p-7">
            <div>
              <span className="rm-label">BESZERZÉSI MÉRLEG</span>
              <h3 className="mt-2 font-heading text-[20px] text-white">Becsült és tényleges.</h3>
            </div>
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
                <span
                  className="rm-variance mt-1"
                  data-severity={
                    Math.abs(totals.orderVariance) === 0
                      ? 'none'
                      : Math.abs(totals.orderVariance) > totals.orderEstimated * 0.1
                        ? 'major'
                        : 'minor'
                  }
                >
                  <b className="font-heading text-[15px]">
                    {totals.orderVariance > 0 ? '+' : ''}
                    {formatHuf(totals.orderVariance)}
                  </b>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------ ACTIVITY */}
        {days.length > 0 && (
          <div className="rm-card mt-3.5 p-7">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <span className="rm-label">AKTIVITÁS</span>
                <h3 className="mt-2 font-heading text-[20px] text-white">Az elmúlt fél év.</h3>
              </div>
              <div className="flex gap-2">
                {(Object.keys(METRIC_LABEL) as Metric[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMetric(option)}
                    aria-pressed={metric === option}
                    className={`border px-3.5 py-2 text-[9px] font-bold tracking-[0.16em] transition-all ${
                      metric === option
                        ? 'border-[color:var(--rm-red)] bg-[rgba(227,40,78,0.12)] text-white'
                        : 'border-white/10 text-[#8f8887] hover:border-white/30'
                    }`}
                  >
                    {METRIC_LABEL[option]}
                  </button>
                ))}
              </div>
            </div>

            <ActivityCalendar
              days={days}
              metric={metric}
              describe={(day, date) =>
                day
                  ? `${date} · ${day.sales} eladás · ${formatHuf(Number(day.revenue))} · ${Number(day.hours).toFixed(1)} óra · ${day.orders} beszerzés`
                  : `${date} · nincs aktivitás`
              }
            />
          </div>
        )}

        {/* ------------------------------------------------ RECENT SHIFTS */}
        {analytics && analytics.recentShifts.length > 0 && (
          <div className="rm-card mt-3.5 p-0">
            <div className="border-b border-[color:var(--rm-line)] px-7 py-5">
              <span className="rm-label">MŰSZAKOK</span>
              <h3 className="mt-2 font-heading text-[20px] text-white">Legutóbbi napjaid.</h3>
            </div>
            {analytics.recentShifts.map((shift) => (
              <div
                key={shift.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.04] px-7 py-4 last:border-b-0"
              >
                <span className="text-[11px] text-white">
                  {new Date(shift.startedAt).toLocaleDateString('hu-HU')} · {formatTime(shift.startedAt)}
                  {shift.endedAt ? ` – ${formatTime(shift.endedAt)}` : ' – folyamatban'}
                </span>
                <span className="flex gap-7 text-[10px] text-[#8d8584]">
                  <span>{shift.hours} óra</span>
                  <span className="text-[color:var(--rm-red)]">{formatHuf(shift.revenue)}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="rm-gilt my-14"/>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <form onSubmit={saveProfile} className="rm-card flex flex-col gap-3.5 p-7">
            <span className="rm-label">ADATOK</span>
            <h2 className="mb-2 font-heading text-[22px] text-white">Alapadatok</h2>

            <div className="mb-2 flex items-center gap-3 border border-white/[0.06] bg-black/30 p-3">
              <span className="grid h-10 w-10 place-items-center rounded-full border border-[rgba(213,31,60,0.4)] bg-[radial-gradient(circle,#250811,#09090b_70%)] font-heading text-[13px] text-white">
                {(user?.nickname || user?.name || '?').slice(0, 2).toUpperCase()}
              </span>
              <div>
                <strong className="block text-[12px] text-white">{user?.username}</strong>
                <span className="text-[9px] tracking-[0.2em] text-[color:var(--rm-red)]">
                  {ROLE_LABEL[user?.role || ''] || user?.role}
                  {user?.job ? (
                    <span className="ml-2 text-[#8d8584]">
                      {JOB_GLYPH[jobKey]} {JOB_LABEL[jobKey]}
                    </span>
                  ) : null}
                </span>
              </div>
            </div>

            <label className="flex flex-col gap-2">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">NÉV</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className={field}/>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">TELEFONSZÁM</span>
              <input value={phone} onChange={handlePhoneChange} inputMode="numeric" className={field}/>
            </label>

            <Btn type="submit" variant="red" className="mt-2 justify-center">
              MENTÉS
            </Btn>

            {profileStatus && (
              <p className={`text-[11px] ${profileStatus.kind === 'ok' ? 'text-emerald-400' : 'text-[color:var(--rm-red)]'}`}>
                {profileStatus.message}
              </p>
            )}
          </form>

          <form onSubmit={changePassword} className="rm-card flex flex-col gap-3.5 p-7">
            <span className="rm-label">BIZTONSÁG</span>
            <h2 className="mb-2 font-heading text-[22px] text-white">Jelszó csere</h2>
            <p className="mb-2 text-[10px] leading-[1.7] text-[#8d8584]">
              Jelszócsere után minden más eszközön megszűnik a munkamenet.
            </p>

            <label className="flex flex-col gap-2">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">JELENLEGI JELSZÓ</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                autoComplete="current-password"
                className={field}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">ÚJ JELSZÓ</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={field}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">ÚJ JELSZÓ ÚJRA</span>
              <input
                type="password"
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={field}
              />
            </label>

            <Btn type="submit" variant="red" className="mt-2 justify-center">
              <KeyRound size={13}/> JELSZÓ MENTÉSE
            </Btn>

            {passwordStatus && (
              <p className={`text-[11px] ${passwordStatus.kind === 'ok' ? 'text-emerald-400' : 'text-[color:var(--rm-red)]'}`}>
                {passwordStatus.message}
              </p>
            )}
          </form>
        </div>

        <div className="mt-12">
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
      </section>
    </main>
  );
};
