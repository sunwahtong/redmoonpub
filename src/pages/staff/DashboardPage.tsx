import React, {useMemo} from 'react';
import {Link} from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Boxes,
  Check,
  ClipboardList,
  Coins,
  FileText,
  MapPin,
  Package,
  Receipt,
  ScrollText,
  Timer,
  Truck,
  UserCircle,
  UserPlus,
  Users
} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {BtnLink} from '../../components/ui/Btn';
import {Sparkline} from '../../components/ui/Sparkline';
import {ActivityCalendar} from '../../components/ui/ActivityCalendar';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatHuf, formatTime} from '../../lib/api';
import {STAFF_NAV, type StaffNavLink} from '../../lib/navigation';
import {JOB_LABEL, ORDER_STATUS_LABEL, type StaffJob, type SupplyOrder} from '../../lib/orders';
import {useAuthStore, roleAtLeast} from '../../stores/useAuthStore';

/** Order the console's areas are laid out in. */
const GROUPS: StaffNavLink['group'][] = ['MŰSZAK', 'VENDÉG', 'KÉSZLET', 'HÁZ'];

const TOOL_ICON: Record<string, React.ElementType> = {
  '/staff/shift': Timer,
  '/staff/register': Coins,
  '/staff/sales': Receipt,
  '/staff/reservations': ClipboardList,
  '/staff/applications': UserPlus,
  '/staff/orders': Truck,
  '/staff/inventory': Boxes,
  '/staff/products': Package,
  '/staff/documents': FileText,
  '/staff/reports': Activity,
  '/staff/users': Users,
  '/staff/audit': ScrollText,
  '/staff/profile': UserCircle
};

interface Dashboard {
  today: {revenue: number; items: number; salesCount: number};
  overallRevenue: number;
  lowStock: {id: string; name: string; stock: number; minStock: number}[];
  topSales: {product: string; qty: number}[];
  openShift: {id: string; openedByName?: string; openedAt?: string} | null;
}

interface Presence {
  online: {id: string; name: string; role: string}[];
  onlineCount: number;
}

interface Notifications {
  notifications: {id: string; title: string; message: string; at: string}[];
}

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
  openShift: {id: string; startedAt: string} | null;
  claimedOrders: {id: string; code: string; status: string; estimatedTotal: number; items: number}[];
  recentShifts: {id: string; startedAt: string; endedAt: string | null; status: string; hours: number; revenue: number}[];
  days: {date: string; shifts: number; hours: number; sales: number; revenue: number; orders: number; spend: number}[];
}

interface StorageAnalytics {
  windowDays: number;
  products: {
    id: string;
    name: string;
    stock: number;
    minStock: number;
    perDay: number;
    daysLeft: number | null;
    below: boolean;
  }[];
  retailValue: number;
}

interface BusinessAnalytics {
  lifetime: {revenue: number; expense: number; profit: number};
  window: {revenue: number; expense: number; sales: number};
  trend: {date: string; revenue: number; expense: number; sales: number}[];
  topProducts: {product: string; qty: number; revenue: number}[];
  orders: {open: number; running: number; completed: number; variance: number};
  staffCount: number;
}

/** One headline figure. */
const Stat: React.FC<{
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  hint?: string;
  glyph?: string;
  tone?: 'default' | 'warn';
}> = ({icon: Icon, label, value, hint, glyph, tone = 'default'}) => (
  <div className="rm-stat p-6">
    {glyph && (
      <span className="rm-stat-glyph" aria-hidden="true">
        {glyph}
      </span>
    )}
    <Icon size={15} className={`relative mb-4 ${tone === 'warn' ? 'text-amber-400' : 'text-[color:var(--rm-red)]'}`}/>
    <span className="relative block text-[8px] tracking-[0.25em] text-[#777]">{label}</span>
    <strong className="relative mt-2 block font-heading text-[27px] leading-none text-white">{value}</strong>
    {hint && <span className="relative mt-2 block text-[10px] text-[#8d8584]">{hint}</span>}
  </div>
);

const SectionTitle: React.FC<{label: string; title: string; action?: React.ReactNode}> = ({
  label,
  title,
  action
}) => (
  <div className="mb-5 mt-14 flex flex-wrap items-end justify-between gap-4">
    <div>
      <span className="rm-label">{label}</span>
      <h2 className="mt-2 font-heading text-[24px] leading-none text-white">{title}</h2>
    </div>
    {action}
  </div>
);

export const DashboardPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const isManager = roleAtLeast(user?.role, 'manager');
  const isOwner = roleAtLeast(user?.role, 'owner');

  const {data: dashboard} = useLiveData<Dashboard>('/api/dashboard', {intervalMs: 30000});
  const {data: presence} = useLiveData<Presence>('/api/presence', {intervalMs: 30000});
  const {data: notifications, refresh: refreshNotifications} = useLiveData<Notifications>('/api/notifications', {
    intervalMs: 60000,
    enabled: isManager
  });
  const {data: me} = useLiveData<PersonalAnalytics>('/api/analytics/me', {intervalMs: 45000});
  const {data: orderData} = useLiveData<{orders: SupplyOrder[]; canRun: boolean}>('/api/orders', {
    intervalMs: 30000
  });
  const {data: storage} = useLiveData<StorageAnalytics>('/api/analytics/storage', {
    intervalMs: 90000,
    enabled: isManager
  });
  const {data: business} = useLiveData<BusinessAnalytics>('/api/analytics/business', {
    intervalMs: 90000,
    enabled: isOwner
  });

  const today = dashboard?.today;
  const lowStock = dashboard?.lowStock || [];
  const online = presence?.online || [];
  const feed = notifications?.notifications || [];
  const totals = me?.totals;

  const openOrders = useMemo(
    () => (orderData?.orders || []).filter((order) => order.status === 'open'),
    [orderData]
  );
  const myOrders = me?.claimedOrders || [];
  const canRunOrders = !!orderData?.canRun;

  const urgentStock = useMemo(
    () => (storage?.products || []).filter((product) => product.daysLeft !== null && product.daysLeft <= 5).slice(0, 6),
    [storage]
  );

  const markRead = async (id: string) => {
    try {
      await apiSend('/api/notifications/read', 'POST', {id});
      refreshNotifications();
    } catch {
      /* nothing to recover from */
    }
  };

  const jobLabel = JOB_LABEL[(user?.job || '') as StaffJob];

  return (
    <main>
      <section className="rm-section">
        {/* ------------------------------------------------ GREETING */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="rm-label">RED MOON / KONZOL</div>
            <NeonHeading as="h1" size={2} className="mb-3 mt-3.5">
              Szia, <em>{user?.nickname || user?.name}.</em>
            </NeonHeading>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#8d8584]">
              <span className="border border-[color:var(--rm-line-red)] px-2.5 py-1 text-[8px] tracking-[0.2em] text-[color:var(--rm-red)]">
                {(user?.role || '').toUpperCase()}
              </span>
              {user?.job && <span className="text-[10px] tracking-[0.15em] text-[#8d8584]">{jobLabel}</span>}
              <span>
                {dashboard?.openShift
                  ? `Nyitott műszak · ${dashboard.openShift.openedByName || ''}`
                  : 'Most nincs nyitott műszak.'}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {me?.openShift ? (
              <BtnLink to="/staff/register" variant="red">
                KASSZA ↗
              </BtnLink>
            ) : (
              <BtnLink to="/staff/shift" variant="red">
                MŰSZAK ↗
              </BtnLink>
            )}
            <BtnLink to="/staff/profile">PROFILOM ↗</BtnLink>
          </div>
        </div>

        {/* ------------------------------------------------ MINE */}
        <SectionTitle label="01 / SAJÁT" title="A te estéd."/>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            icon={Timer}
            glyph="時"
            label="LEDOLGOZOTT ÓRA"
            value={totals ? `${totals.hours}` : '—'}
            hint={totals ? `${totals.shifts} műszak` : undefined}
          />
          <Stat
            icon={Receipt}
            glyph="売"
            label="SAJÁT ELADÁS"
            value={totals ? String(totals.sales) : '—'}
            hint={totals ? `${totals.items} tétel` : undefined}
          />
          <Stat
            icon={Coins}
            glyph="金"
            label="ÁLTALAD HOZOTT BEVÉTEL"
            value={totals ? formatHuf(totals.revenue) : '—'}
          />
          <Stat
            icon={Activity}
            glyph="給"
            label="BÉR (BECSÜLT)"
            value={totals ? formatHuf(totals.wage) : '—'}
            hint="Óradíj alapján"
          />
        </div>

        {me && me.days.length > 0 && (
          <div className="rm-card mt-3.5 p-7">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <span className="rm-label">AKTIVITÁS</span>
                <h3 className="mt-2 font-heading text-[20px] text-white">Az elmúlt fél év.</h3>
              </div>
              <span className="text-[10px] text-[#8d8584]">Minden négyzet egy nap.</span>
            </div>
            <ActivityCalendar
              days={me.days}
              metric="revenue"
              describe={(day, date) =>
                day
                  ? `${date} · ${day.sales} eladás · ${formatHuf(Number(day.revenue))} · ${Number(day.hours).toFixed(1)} óra`
                  : `${date} · nincs aktivitás`
              }
            />
          </div>
        )}

        {/* ------------------------------------------------ SUPPLY RUNS */}
        {(canRunOrders || myOrders.length > 0) && (
          <>
            <SectionTitle
              label="02 / BESZERZÉS"
              title={myOrders.length ? 'Nálad van.' : 'Elvihető munka.'}
              action={<BtnLink to="/staff/orders">MINDEN BESZERZÉS ↗</BtnLink>}
            />

            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {myOrders.map((order) => (
                <Link
                  key={order.id}
                  to="/staff/orders"
                  className="group flex items-center justify-between gap-4 border border-[color:var(--rm-line-red)] bg-[rgba(227,40,78,0.06)] p-5 transition-all hover:-translate-y-0.5"
                >
                  <div>
                    <strong className="font-heading text-[17px] text-white">{order.code}</strong>
                    <p className="mt-1 text-[10px] text-[#8d8584]">
                      {ORDER_STATUS_LABEL[order.status as 'claimed' | 'progress']} · {order.items} tétel ·{' '}
                      {formatHuf(order.estimatedTotal)}
                    </p>
                  </div>
                  <ArrowUpRight size={14} className="text-[color:var(--rm-red)] transition-transform group-hover:-translate-y-0.5"/>
                </Link>
              ))}

              {openOrders.slice(0, 4).map((order) => (
                <Link
                  key={order.id}
                  to="/staff/orders"
                  className="group flex items-center justify-between gap-4 border border-[color:var(--rm-line)] bg-[#09090b] p-5 transition-all hover:-translate-y-0.5 hover:border-[rgba(213,31,60,0.5)]"
                >
                  <div>
                    <strong className="font-heading text-[17px] text-white">{order.code}</strong>
                    <p className="mt-1 text-[10px] text-[#8d8584]">
                      {order.items.length} tétel · {formatHuf(order.estimatedTotal)} · {order.source}
                    </p>
                  </div>
                  <Truck size={14} className="text-[#6f6968] transition-colors group-hover:text-[color:var(--rm-red)]"/>
                </Link>
              ))}

              {!myOrders.length && !openOrders.length && (
                <p className="rm-card p-6 text-[11px] text-[#8d8584]">Most nincs kiírt beszerzés.</p>
              )}
            </div>
          </>
        )}

        {/* ------------------------------------------------ HOUSE TONIGHT */}
        <SectionTitle label="03 / MA ESTE" title="A ház."/>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            icon={Coins}
            glyph="日"
            label="MAI BEVÉTEL"
            value={today ? formatHuf(today.revenue) : '—'}
            hint={today ? `${today.salesCount} eladás · ${today.items} tétel` : undefined}
          />
          <Stat icon={Users} glyph="人" label="ONLINE" value={presence ? String(presence.onlineCount) : '—'}
            hint={online.slice(0, 3).map((person) => person.name).join(', ') || undefined}/>
          <Stat
            icon={Boxes}
            glyph="庫"
            label="FOGYÓ KÉSZLET"
            value={String(lowStock.length)}
            hint={lowStock.length ? 'Feltöltés javasolt' : 'Minden rendben'}
            tone={lowStock.length ? 'warn' : 'default'}
          />
          <Stat
            icon={Truck}
            glyph="運"
            label="NYITOTT BESZERZÉS"
            value={String(openOrders.length)}
          />
        </div>

        {/* ------------------------------------------------ MANAGER */}
        {isManager && (
          <>
            <SectionTitle
              label="04 / ÜZLETVEZETÉS"
              title="Ami rád tartozik."
              action={<BtnLink to="/staff/documents">BIZONYLAT KÉSZÍTÉSE ↗</BtnLink>}
            />

            <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
              <div className="rm-card p-7">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="rm-label">KÉSZLET-ELŐREJELZÉS</span>
                    <h3 className="mt-2 font-heading text-[20px] text-white">Mi fogy ki előbb?</h3>
                  </div>
                  {storage && (
                    <span className="text-[9px] tracking-[0.15em] text-[#6f6968]">
                      {storage.windowDays} NAP ALAPJÁN
                    </span>
                  )}
                </div>

                {!urgentStock.length ? (
                  <p className="mt-5 text-[11px] text-[#8d8584]">
                    Egyik tétel sem fogy ki a következő öt napban.
                  </p>
                ) : (
                  <ul className="mt-5 flex flex-col gap-4">
                    {urgentStock.map((product) => {
                      // The bar shows how much of a ten day buffer is left, so a
                      // short shelf reads as short without needing the number.
                      const share = product.daysLeft === null ? 1 : Math.min(1, product.daysLeft / 10);
                      return (
                        <li key={product.id}>
                          <div className="flex items-baseline justify-between gap-3 text-[11px]">
                            <span className="truncate text-white">{product.name}</span>
                            <span className={product.daysLeft !== null && product.daysLeft <= 2 ? 'text-[color:var(--rm-red)]' : 'text-[#8d8584]'}>
                              {product.daysLeft === null ? 'nincs adat' : `${product.daysLeft} nap`}
                            </span>
                          </div>
                          <div className="rm-gauge mt-2" data-state={share < 0.3 ? 'low' : share > 0.7 ? 'healthy' : 'mid'}>
                            <span style={{width: `${Math.max(4, share * 100)}%`}}/>
                          </div>
                          <span className="mt-1.5 block text-[9px] text-[#6f6968]">
                            {product.stock} db készleten · {product.perDay}/nap fogyás
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="mt-7">
                  <BtnLink to="/staff/orders">BESZERZÉS KIÍRÁSA ↗</BtnLink>
                </div>
              </div>

              <div className="rm-card p-7">
                <span className="rm-label">ÉRTESÍTÉSEK</span>
                <h3 className="mb-5 mt-2 font-heading text-[20px] text-white">Legutóbbi</h3>
                {feed.length === 0 ? (
                  <p className="text-[11px] text-[#8d8584]">Nincs új értesítés.</p>
                ) : (
                  <ul className="flex flex-col gap-3.5">
                    {feed.slice(0, 7).map((item) => (
                      <li key={item.id} className="group flex gap-3">
                        <Bell size={12} className="mt-0.5 shrink-0 text-[color:var(--rm-red)]"/>
                        <div className="flex-1">
                          <strong className="block text-[11px] text-white">{item.title}</strong>
                          <span className="text-[10px] leading-[1.6] text-[#8d8584]">{item.message}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => markRead(item.id)}
                          aria-label="Olvasottnak jelölés"
                          className="shrink-0 text-[#777] opacity-0 transition-opacity hover:text-emerald-400 group-hover:opacity-100"
                        >
                          <Check size={12}/>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}

        {/* ------------------------------------------------ OWNER */}
        {isOwner && business && (
          <>
            <SectionTitle
              label="05 / A VÁLLALKOZÁS"
              title="Az egész ház."
              action={<BtnLink to="/staff/reports">JELENTÉSEK ↗</BtnLink>}
            />

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <Stat icon={Coins} glyph="収" label="ÖSSZES BEVÉTEL" value={formatHuf(business.lifetime.revenue)}/>
              <Stat icon={Truck} glyph="出" label="ÖSSZES KIADÁS" value={formatHuf(business.lifetime.expense)}/>
              <Stat
                icon={Activity}
                glyph="利"
                label="EREDMÉNY"
                value={formatHuf(business.lifetime.profit)}
                hint={business.lifetime.profit < 0 ? 'Veszteséges' : 'Nyereséges'}
                tone={business.lifetime.profit < 0 ? 'warn' : 'default'}
              />
              <Stat
                icon={AlertTriangle}
                glyph="差"
                label="BESZERZÉSI ELTÉRÉS"
                value={formatHuf(business.orders.variance)}
                hint={`${business.orders.completed} teljesített`}
                tone={Math.abs(business.orders.variance) > 0 ? 'warn' : 'default'}
              />
            </div>

            <div className="rm-card mt-3.5 p-7">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <span className="rm-label">30 NAP</span>
                  <h3 className="mt-2 font-heading text-[20px] text-white">Bevétel és kiadás.</h3>
                </div>
                <div className="flex gap-6 text-[10px]">
                  <span className="flex items-center gap-2 text-[#c9c2c1]">
                    <span className="h-[2px] w-5 bg-[color:var(--rm-red)]"/>
                    BEVÉTEL {formatHuf(business.window.revenue)}
                  </span>
                  <span className="flex items-center gap-2 text-[#8d8584]">
                    <span className="h-[2px] w-5 border-t border-dashed border-[#8d8584]"/>
                    KIADÁS {formatHuf(business.window.expense)}
                  </span>
                </div>
              </div>

              <Sparkline
                label="Bevétel és kiadás az elmúlt 30 napban"
                height={90}
                series={[
                  {label: 'Bevétel', values: business.trend.map((day) => day.revenue), fill: true},
                  {label: 'Kiadás', values: business.trend.map((day) => day.expense), color: '#8d8584'}
                ]}
              />

              {business.topProducts.length > 0 && (
                <div className="mt-7 border-t border-white/[0.06] pt-5">
                  <span className="text-[8px] tracking-[0.25em] text-[#777]">LEGTÖBBET HOZÓ TÉTELEK</span>
                  <div className="mt-3 flex flex-wrap gap-x-7 gap-y-2 text-[11px]">
                    {business.topProducts.slice(0, 5).map((product) => (
                      <span key={product.product} className="text-[#c9c2c1]">
                        {product.product}
                        <span className="ml-2 text-[color:var(--rm-red)]">{formatHuf(product.revenue)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ------------------------------------------------ TOOLS */}
        <SectionTitle label="06 / ESZKÖZÖK" title="A konzol."/>

        {GROUPS.map((group) => {
          const links = STAFF_NAV.filter(
            (link) => link.group === group && link.to !== '/staff' && roleAtLeast(user?.role, link.need)
          );
          if (!links.length) return null;

          return (
            <div key={group} className="mb-8">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">{group}</span>
              <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
                {links.map((link) => {
                  const Icon = TOOL_ICON[link.to] || Activity;
                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                      className="group relative flex items-center gap-3.5 overflow-hidden border border-[color:var(--rm-line)] bg-[#09090b] p-5 transition-all hover:-translate-y-1 hover:border-[rgba(213,31,60,0.55)]"
                    >
                      <span className="pointer-events-none absolute inset-y-0 left-0 w-[2px] scale-y-0 bg-[color:var(--rm-red)] transition-transform duration-300 group-hover:scale-y-100"/>
                      <Icon size={15} className="shrink-0 text-[color:var(--rm-red)]"/>
                      <span className="text-[10px] font-bold tracking-[0.16em] text-white">{link.label}</span>
                      <ArrowUpRight
                        size={13}
                        className="ml-auto shrink-0 text-[#6f6968] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white"
                      />
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}

        {isManager && (
          <BtnLink to="/location">
            <MapPin size={13}/> TÉRKÉP JELÖLŐK ↗
          </BtnLink>
        )}

        {me && me.recentShifts.length > 0 && (
          <>
            <SectionTitle label="07 / ELŐZMÉNY" title="Legutóbbi műszakjaid."/>
            <div className="rm-card p-0">
              {me.recentShifts.slice(0, 6).map((shift) => (
                <div
                  key={shift.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.04] px-6 py-4 last:border-b-0"
                >
                  <span className="text-[11px] text-white">
                    {new Date(shift.startedAt).toLocaleDateString('hu-HU')} · {formatTime(shift.startedAt)}
                    {shift.endedAt ? ` – ${formatTime(shift.endedAt)}` : ' – folyamatban'}
                  </span>
                  <span className="flex gap-6 text-[10px] text-[#8d8584]">
                    <span>{shift.hours} óra</span>
                    <span className="text-[color:var(--rm-red)]">{formatHuf(shift.revenue)}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
};
