import React, {useState} from 'react';
import {Clock, Coins, RotateCcw, TrendingUp} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn} from '../../components/ui/Btn';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatHuf} from '../../lib/api';
import {playSfx} from '../../lib/sfx';

interface StaffPerformance {
  name: string;
  shifts: number;
  revenue: number;
  sales: number;
  items: number;
  hours: number;
  revenuePerHour: number;
}

interface ActivityRow {
  id: string;
  name: string;
  role: string;
  shifts: number;
  workedMs?: number;
  workedHours?: number;
}

const hours = (row: ActivityRow) =>
  row.workedHours ?? (row.workedMs ? row.workedMs / 3600000 : 0);

export const ReportsPage: React.FC = () => {
  const {data: performance} = useLiveData<{staff: StaffPerformance[]}>('/api/owner/performance', {
    intervalMs: 60000
  });
  // The endpoint returns its rows under `staff`, not `rows`.
  const {data: activity, refresh: refreshActivity} = useLiveData<{staff: ActivityRow[]}>('/api/owner/activity', {
    intervalMs: 60000
  });
  const {data: finance, refresh: refreshFinance} = useLiveData<{overallRevenue: number; rawRevenue: number}>(
    '/api/finance/overall',
    {intervalMs: 60000}
  );

  const [message, setMessage] = useState<{kind: 'ok' | 'error'; text: string} | null>(null);

  const staff = performance?.staff || [];
  const rows = activity?.staff || [];

  const run = async (action: () => Promise<unknown>, okText: string) => {
    setMessage(null);
    try {
      await action();
      setMessage({kind: 'ok', text: okText});
      playSfx('success');
    } catch (err) {
      setMessage({kind: 'error', text: (err as Error).message});
      playSfx('error');
    }
  };

  const resetActivity = () => {
    if (!window.confirm('Biztosan nullázod a ledolgozott órák számlálóját? A műszakok megmaradnak.')) return;
    run(async () => {
      await apiSend('/api/owner/activity/reset', 'POST', {});
      refreshActivity();
    }, 'Aktivitás nullázva.');
  };

  const resetFinance = () => {
    if (!window.confirm('Biztosan nullázod az összesített bevételt? Az eladások megmaradnak.')) return;
    run(async () => {
      await apiSend('/api/finance/reset', 'POST', {});
      refreshFinance();
    }, 'Összesített bevétel nullázva.');
  };

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / JELENTÉSEK</div>
        <NeonHeading as="h1" size={2} className="mb-8 mt-3.5">
          A <em>számok.</em>
        </NeonHeading>

        {message && (
          <p className={`mb-6 text-[11px] ${message.kind === 'ok' ? 'text-emerald-400' : 'text-[color:var(--rm-red)]'}`}>
            {message.text}
          </p>
        )}

        <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <div className="rm-card p-6">
            <Coins size={16} className="mb-4 text-[color:var(--rm-red)]"/>
            <span className="block text-[8px] tracking-[0.25em] text-[#777]">ÖSSZESÍTETT BEVÉTEL</span>
            <strong className="mt-2 block font-heading text-[26px] text-white">
              {finance ? formatHuf(finance.overallRevenue) : '—'}
            </strong>
          </div>
          <div className="rm-card p-6">
            <TrendingUp size={16} className="mb-4 text-[color:var(--rm-red)]"/>
            <span className="block text-[8px] tracking-[0.25em] text-[#777]">NYERS BEVÉTEL</span>
            <strong className="mt-2 block font-heading text-[26px] text-white">
              {finance ? formatHuf(finance.rawRevenue) : '—'}
            </strong>
          </div>
          <div className="rm-card p-6">
            <Clock size={16} className="mb-4 text-[color:var(--rm-red)]"/>
            <span className="block text-[8px] tracking-[0.25em] text-[#777]">LEDOLGOZOTT ÓRA</span>
            <strong className="mt-2 block font-heading text-[26px] text-white">
              {rows.reduce((sum, row) => sum + hours(row), 0).toFixed(1)}
            </strong>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <div className="rm-card p-0">
            <div className="border-b border-[color:var(--rm-line)] px-6 py-4">
              <span className="rm-label">TELJESÍTMÉNY</span>
            </div>

            {!staff.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">Még nincs lezárt műszak.</p>}

            {staff
              .slice()
              .sort((a, b) => b.revenue - a.revenue)
              .map((person) => (
                <div key={person.name} className="border-b border-white/[0.04] px-6 py-3">
                  <div className="flex items-center justify-between">
                    <strong className="text-[11px] text-white">{person.name}</strong>
                    <span className="font-heading text-[14px] text-[color:var(--rm-red)]">
                      {formatHuf(person.revenue)}
                    </span>
                  </div>
                  <span className="mt-1 block text-[9px] text-[#777]">
                    {person.shifts} műszak · {person.sales} eladás · {person.items} tétel ·{' '}
                    {person.hours.toFixed(1)} óra · {formatHuf(person.revenuePerHour)}/óra
                  </span>
                </div>
              ))}
          </div>

          <div className="rm-card p-0">
            <div className="flex items-center justify-between border-b border-[color:var(--rm-line)] px-6 py-4">
              <span className="rm-label">AKTIVITÁS</span>
              <button
                type="button"
                onClick={resetActivity}
                className="flex items-center gap-1.5 text-[9px] tracking-[0.2em] text-[#777] transition-colors hover:text-[color:var(--rm-red)]"
              >
                <RotateCcw size={11}/> NULLÁZÁS
              </button>
            </div>

            {!rows.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">Nincs adat.</p>}

            {rows
              .slice()
              .sort((a, b) => hours(b) - hours(a))
              .map((row) => (
                <div key={row.id} className="flex items-center justify-between border-b border-white/[0.04] px-6 py-3">
                  <div>
                    <strong className="block text-[11px] text-white">{row.name}</strong>
                    <span className="text-[9px] uppercase text-[#777]">{row.role}</span>
                  </div>
                  <span className="text-[11px] tabular-nums text-white">
                    {hours(row).toFixed(1)} óra
                    <span className="ml-2 text-[9px] text-[#777]">{row.shifts} műszak</span>
                  </span>
                </div>
              ))}
          </div>
        </div>

        <div className="mt-10">
          <Btn onClick={resetFinance}>
            <RotateCcw size={13}/> ÖSSZESÍTETT BEVÉTEL NULLÁZÁSA
          </Btn>
          <p className="mt-3 text-[10px] leading-[1.7] text-[#777]">
            A nullázás csak a kijelzett összeget állítja vissza. Az eladások és a műszakok érintetlenek maradnak.
          </p>
        </div>
      </section>
    </main>
  );
};
