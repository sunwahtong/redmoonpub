import React, {useMemo, useState} from 'react';
import {Clock, Coins, RotateCcw, TrendingDown, TrendingUp, Truck, Users} from 'lucide-react';
import {Btn} from '../../components/ui/Btn';
import {Sparkline} from '../../components/ui/Sparkline';
import {Badge, PageHeader, Panel, Stat} from '../../components/ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatHuf} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {dialog} from '../../stores/useDialogStore';
import {toast} from '../../stores/useToastStore';

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
  active?: boolean;
  workedMs?: number;
  workedHours?: number;
  revenue?: number;
  sales?: number;
}

interface Business {
  windowDays: number;
  lifetime: {revenue: number; expense: number; profit: number};
  window: {revenue: number; expense: number; sales: number};
  trend: {date: string; revenue: number; expense: number; sales: number}[];
  topProducts: {product: string; qty: number; revenue: number}[];
  orders: {open: number; running: number; completed: number; variance: number};
  staffCount: number;
}

const hoursOf = (row: ActivityRow) => row.workedHours ?? (row.workedMs ? row.workedMs / 3600000 : 0);

/** A rate only means something once there is a real amount of time behind it. */
const perHour = (revenue: number, hours: number) => (hours >= 0.5 ? formatHuf(Math.round(revenue / hours)) + '/óra' : '—');

/**
 * The owner's numbers: what the house made, who made it, and what it cost.
 * Everything here is read-only except the two counters that can be zeroed.
 */
export const ReportsPage: React.FC = () => {
  const {data: performance} = useLiveData<{staff: StaffPerformance[]}>('/api/owner/performance', {intervalMs: 60000, topics: ['content', 'house']});
  const {data: activity, refresh: refreshActivity} = useLiveData<{staff: ActivityRow[]; resetAt: string | null}>('/api/owner/activity', {intervalMs: 60000, topics: ['house']});
  const {data: finance, refresh: refreshFinance} = useLiveData<{overallRevenue: number; rawRevenue: number}>('/api/finance/overall', {intervalMs: 60000, topics: ['content']});
  const {data: business} = useLiveData<Business>('/api/analytics/business', {intervalMs: 90000, topics: ['content']});

  const [sortBy, setSortBy] = useState<'revenue' | 'hours'>('revenue');

  const staff = useMemo(() => [...(performance?.staff || [])].sort((a, b) => (sortBy === 'revenue' ? b.revenue - a.revenue : b.hours - a.hours)), [performance, sortBy]);
  const rows = useMemo(() => [...(activity?.staff || [])].sort((a, b) => hoursOf(b) - hoursOf(a)), [activity]);
  const topRevenue = Math.max(1, ...staff.map((person) => person.revenue));
  const totalHours = rows.reduce((sum, row) => sum + hoursOf(row), 0);

  const resetActivity = async () => {
    const sure = await dialog.confirm({
      title: 'Nullázod az aktivitást?',
      message: 'A ledolgozott órák számlálója mától indul újra. A műszakok és az eladások megmaradnak.',
      confirmLabel: 'NULLÁZÁS',
      tone: 'danger'
    });
    if (!sure) return;
    try {
      await apiSend('/api/owner/activity/reset', 'POST', {});
      refreshActivity();
      toast.success('Aktivitás nullázva.');
      playSfx('success');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    }
  };

  const resetFinance = async () => {
    const sure = await dialog.confirm({
      title: 'Nullázod az összesített bevételt?',
      message: 'Csak a kijelzett összeg indul újra nulláról. Az eladások, a műszakok és a jelentések érintetlenek maradnak.',
      confirmLabel: 'NULLÁZÁS',
      tone: 'danger'
    });
    if (!sure) return;
    try {
      await apiSend('/api/finance/reset', 'POST', {});
      refreshFinance();
      toast.success('Összesített bevétel nullázva.');
      playSfx('success');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    }
  };

  const profit = business ? business.window.revenue - business.window.expense : 0;

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / JELENTÉSEK"
          title={
            <>
              A <em>számok.</em>
            </>
          }
          lead="Mit hozott a ház, ki hozta, és mibe került. Élő adatok: minden zárt műszak és minden beszerzés azonnal itt van."
          actions={
            <Btn onClick={resetFinance} className="!px-4 !py-2.5 !text-[8px]">
              <RotateCcw size={11}/> ÖSSZESÍTETT BEVÉTEL NULLÁZÁSA
            </Btn>
          }
        />

        {/* ------------------------------------------------ HEADLINE */}
        <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
          <Stat icon={Coins} glyph="金" label="ÖSSZESÍTETT BEVÉTEL" value={finance ? formatHuf(finance.overallRevenue) : '—'} hint={finance && finance.rawRevenue !== finance.overallRevenue ? `nyers: ${formatHuf(finance.rawRevenue)}` : 'a nullázás óta'}/>
          <Stat
            icon={profit >= 0 ? TrendingUp : TrendingDown}
            glyph="利"
            label={`${business?.windowDays ?? 30} NAP EREDMÉNY`}
            value={business ? formatHuf(profit) : '—'}
            tone={profit < 0 ? 'warn' : 'good'}
            hint={business ? `${formatHuf(business.window.revenue)} bevétel · ${formatHuf(business.window.expense)} kiadás` : undefined}
          />
          <Stat icon={Clock} glyph="時" label="LEDOLGOZOTT ÓRA" value={totalHours.toFixed(1)} hint={activity?.resetAt ? 'a nullázás óta' : 'teljes időszak'}/>
          <Stat icon={Truck} glyph="運" label="BESZERZÉS" value={business ? String(business.orders.completed) : '—'} hint={business ? `${business.orders.open} kiírva · ${business.orders.running} folyamatban · ${business.orders.variance > 0 ? '+' : ''}${formatHuf(business.orders.variance)} eltérés` : undefined}/>
        </div>

        {/* ------------------------------------------------ TREND */}
        {business && (
          <Panel
            className="mt-3.5"
            label={`${business.windowDays} NAP`}
            title="Bevétel és kiadás, napról napra."
            action={
              <div className="flex flex-wrap gap-5 text-[10px]">
                <span className="flex items-center gap-2 text-[#c9c2c1]">
                  <span className="h-[2px] w-5 bg-[color:var(--rm-red)]"/> BEVÉTEL {formatHuf(business.window.revenue)}
                </span>
                <span className="flex items-center gap-2 text-[#8d8584]">
                  <span className="h-[2px] w-5 border-t border-dashed border-[#8d8584]"/> KIADÁS {formatHuf(business.window.expense)}
                </span>
                <span className="text-[#6f6968]">{business.window.sales} eladás</span>
              </div>
            }
          >
            <Sparkline
              label="Bevétel és kiadás az elmúlt harminc napban"
              height={110}
              series={[
                {label: 'Bevétel', values: business.trend.map((day) => day.revenue), fill: true},
                {label: 'Kiadás', values: business.trend.map((day) => day.expense), color: '#8d8584'}
              ]}
            />
            <div className="mt-4 flex justify-between text-[8px] tracking-[0.2em] text-[#5f5959]">
              <span>{business.trend[0]?.date}</span>
              <span>{business.trend[business.trend.length - 1]?.date}</span>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-2 border-t border-white/[0.06] pt-5 text-[11px] sm:grid-cols-3">
              <span className="text-[#8d8584]">
                Teljes bevétel eddig <b className="ml-2 text-white">{formatHuf(business.lifetime.revenue)}</b>
              </span>
              <span className="text-[#8d8584]">
                Teljes kiadás eddig <b className="ml-2 text-white">{formatHuf(business.lifetime.expense)}</b>
              </span>
              <span className="text-[#8d8584]">
                Eredmény eddig <b className={`ml-2 ${business.lifetime.profit < 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{formatHuf(business.lifetime.profit)}</b>
              </span>
            </div>
          </Panel>
        )}

        {/* ------------------------------------------------ PEOPLE */}
        <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <Panel
            padded={false}
            label="TELJESÍTMÉNY"
            title="Ki mit hozott."
            action={
              <div className="flex gap-1.5">
                {(
                  [
                    {id: 'revenue', label: 'BEVÉTEL'},
                    {id: 'hours', label: 'ÓRA'}
                  ] as const
                ).map((option) => (
                  <button key={option.id} type="button" onClick={() => setSortBy(option.id)} className={`rm-chip !px-3 !py-1.5 !text-[8px]${sortBy === option.id ? ' is-active' : ''}`}>
                    {option.label}
                  </button>
                ))}
              </div>
            }
          >
            {!staff.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">Még nincs lezárt műszak.</p>}
            {staff.map((person, index) => (
              <div key={person.name} className="border-b border-white/[0.04] px-6 py-3.5 last:border-b-0">
                <div className="flex items-center gap-3">
                  <span className="w-5 font-heading text-[13px] text-[#5f5959]">{index + 1}</span>
                  <strong className="min-w-0 flex-1 truncate text-[11px] text-white">{person.name}</strong>
                  <span className="font-heading text-[15px] text-[color:var(--rm-red)]">{formatHuf(person.revenue)}</span>
                </div>
                <div className="ml-8 mt-2 h-1 bg-white/[0.06]">
                  <div className="h-full bg-[color:var(--rm-red)] transition-[width] duration-500" style={{width: `${Math.round((person.revenue / topRevenue) * 100)}%`}}/>
                </div>
                <span className="ml-8 mt-1.5 block text-[9px] text-[#777]">
                  {person.shifts} műszak · {person.sales} eladás · {person.items} tétel · {person.hours.toFixed(1)} óra · {perHour(person.revenue, person.hours)}
                </span>
              </div>
            ))}
          </Panel>

          <Panel
            padded={false}
            label="AKTIVITÁS"
            title="Ki mennyit volt bent."
            action={
              <button type="button" onClick={resetActivity} className="flex items-center gap-1.5 text-[9px] tracking-[0.2em] text-[#777] transition-colors hover:text-[color:var(--rm-red)]">
                <RotateCcw size={11}/> NULLÁZÁS
              </button>
            }
          >
            {!rows.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">Nincs adat.</p>}
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-3 border-b border-white/[0.04] px-6 py-3 last:border-b-0">
                <Users size={12} className={row.active ? 'text-emerald-400' : 'text-[#5f5959]'}/>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[11px] text-white">
                    {row.name}
                    {row.active && <Badge tone="good" className="ml-2">MŰSZAKBAN</Badge>}
                  </strong>
                  <span className="text-[9px] uppercase tracking-[0.15em] text-[#777]">{row.role}</span>
                </div>
                <span className="text-right text-[11px] tabular-nums text-white">
                  {hoursOf(row).toFixed(1)} óra
                  <span className="block text-[9px] text-[#777]">{row.shifts} műszak</span>
                </span>
              </div>
            ))}
          </Panel>
        </div>

        {/* ------------------------------------------------ PRODUCTS */}
        {business && business.topProducts.length > 0 && (
          <Panel className="mt-3.5" padded={false} label={`LEGTÖBBET HOZÓ TÉTELEK · ${business.windowDays} NAP`}>
            {business.topProducts.map((product, index) => {
              const top = business.topProducts[0]?.revenue || 1;
              return (
                <div key={product.product} className="flex items-center gap-3 border-b border-white/[0.04] px-6 py-3 last:border-b-0">
                  <span className="w-5 font-heading text-[13px] text-[#5f5959]">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-white">{product.product}</span>
                  <div className="hidden h-1 w-40 bg-white/[0.06] sm:block">
                    <div className="h-full bg-[color:var(--rm-red)]" style={{width: `${Math.round((product.revenue / top) * 100)}%`}}/>
                  </div>
                  <span className="w-16 text-right text-[10px] text-[#8d8584]">{product.qty} db</span>
                  <span className="w-28 text-right font-heading text-[14px] text-[color:var(--rm-red)]">{formatHuf(product.revenue)}</span>
                </div>
              );
            })}
          </Panel>
        )}
      </section>
    </main>
  );
};
