import React, {useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Boxes,
  CalendarDays,
  Check,
  ClipboardList,
  Coins,
  DoorClosed,
  DoorOpen,
  FileText,
  MapPin,
  Package,
  Radio,
  Receipt,
  ScrollText,
  Sparkles,
  Timer,
  Truck,
  UserCircle,
  UserPlus,
  Users
} from 'lucide-react';
import {Btn, BtnLink} from '../../components/ui/Btn';
import {Sparkline} from '../../components/ui/Sparkline';
import {ActivityCalendar} from '../../components/ui/ActivityCalendar';
import {Avatar, PageHeader, Panel, SectionTitle, Stat} from '../../components/ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {useHouseStatus} from '../../hooks/useHouseStatus';
import {apiSend, formatHuf, formatTime} from '../../lib/api';
import {STAFF_NAV, type StaffNavLink} from '../../lib/navigation';
import {JOB_LABEL, ORDER_STATUS_LABEL, type StaffJob, type SupplyOrder} from '../../lib/orders';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {dialog} from '../../stores/useDialogStore';
import {useAuthStore, can, roleAtLeast} from '../../stores/useAuthStore';

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
  '/staff/events': CalendarDays,
  '/staff/showcase': Sparkles,
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
  online: {id: string; name: string; nickname: string; role: string; avatar: string}[];
  onlineCount: number;
}

interface Notifications {
  notifications: {id: string; title: string; message: string; at: string; read: boolean}[];
  unread: number;
}

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
  openShift: {id: string; startedAt: string} | null;
  claimedOrders: {id: string; code: string; status: string; estimatedTotal: number; items: number}[];
  recentShifts: {id: string; startedAt: string; endedAt: string | null; status: string; hours: number; revenue: number}[];
  days: {date: string; shifts: number; hours: number; sales: number; revenue: number; orders: number; spend: number}[];
}

interface StorageAnalytics {
  windowDays: number;
  products: {id: string; name: string; stock: number; minStock: number; perDay: number; daysLeft: number | null; below: boolean}[];
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

export const DashboardPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const isManager = roleAtLeast(user?.role, 'manager');
  const isOwner = roleAtLeast(user?.role, 'owner');

  const {data: dashboard, refresh: refreshDashboard} = useLiveData<Dashboard>('/api/dashboard', {intervalMs: 30000, topics: ['house', 'content']});
  const {data: house, refresh: refreshHouse} = useHouseStatus();
  const {data: presence} = useLiveData<Presence>('/api/presence', {intervalMs: 30000, topics: ['staff']});
  const {data: notifications, refresh: refreshNotifications} = useLiveData<Notifications>('/api/notifications', {
    intervalMs: 60000,
    enabled: isManager,
    topics: ['reservations', 'content']
  });
  const {data: me} = useLiveData<PersonalAnalytics>('/api/analytics/me', {intervalMs: 45000});
  const {data: orderData} = useLiveData<{orders: SupplyOrder[]; canRun: boolean}>('/api/orders', {intervalMs: 30000});
  const {data: storage} = useLiveData<StorageAnalytics>('/api/analytics/storage', {intervalMs: 90000, enabled: isManager});
  const {data: business} = useLiveData<BusinessAnalytics>('/api/analytics/business', {intervalMs: 90000, enabled: isOwner});

  const [busy, setBusy] = useState(false);

  const today = dashboard?.today;
  const lowStock = dashboard?.lowStock || [];
  const online = presence?.online || [];
  const feed = (notifications?.notifications || []).filter((item) => !item.read);
  const totals = me?.totals;

  const openOrders = useMemo(() => (orderData?.orders || []).filter((order) => order.status === 'open'), [orderData]);
  const myOrders = me?.claimedOrders || [];
  const canRunOrders = !!orderData?.canRun;

  const urgentStock = useMemo(
    () => (storage?.products || []).filter((product) => product.daysLeft !== null && product.daysLeft <= 5).slice(0, 6),
    [storage]
  );

  const markAllRead = async () => {
    try {
      await apiSend('/api/notifications/read', 'POST', {all: true});
      refreshNotifications();
      playSfx('success');
    } catch {
      /* nothing to recover from */
    }
  };

  const markRead = async (id: string) => {
    try {
      await apiSend('/api/notifications/read', 'POST', {id});
      refreshNotifications();
    } catch {
      /* nothing to recover from */
    }
  };

  const toggleDoor = async () => {
    if (!house || busy) return;
    if (house.open) {
      const sure = await dialog.confirm({
        title: 'Bezárod a házat?',
        message: 'A nyilvános oldal azonnal zárvát mutat. A műszak nyitva marad.',
        confirmLabel: 'BEZÁRÁS'
      });
      if (!sure) return;
    }
    setBusy(true);
    try {
      await apiSend(house.open ? '/api/house/pub/close' : '/api/house/pub/open', 'POST', {});
      toast.success(house.open ? 'A ház bezárt.' : 'A ház kinyitott.');
      playSfx(house.open ? 'cash_close' : 'cash_open');
      refreshHouse();
      refreshDashboard();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const jobLabels = (user?.jobs || []).map((job) => JOB_LABEL[job as StaffJob] || job).join(', ');

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / KONZOL"
          title={
            <>
              Szia, <em>{user?.nickname || user?.name}.</em>
            </>
          }
          lead={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="border border-[color:var(--rm-line-red)] px-2.5 py-1 text-[8px] tracking-[0.2em] text-[color:var(--rm-red)]">
                {(user?.role || '').toUpperCase()}
              </span>
              {jobLabels && <span className="text-[10px] tracking-[0.15em] text-[#8d8584]">{jobLabels}</span>}
              <span>
                {dashboard?.openShift
                  ? `Nyitott műszak · ${dashboard.openShift.id} · ${dashboard.openShift.openedByName || ''}`
                  : 'Most nincs nyitott műszak.'}
              </span>
            </span>
          }
          actions={
            <>
              {me?.openShift ? (
                <BtnLink to="/staff/register" variant="red">
                  KASSZA ↗
                </BtnLink>
              ) : (
                <BtnLink to="/staff/shift" variant="red">
                  MŰSZAK ↗
                </BtnLink>
              )}
              {can(user, 'dj') && <BtnLink to="/dj">DJ PULT ↗</BtnLink>}
              <BtnLink to="/staff/profile">PROFILOM ↗</BtnLink>
            </>
          }
        />

        {/* ------------------------------------------------ THE DOOR */}
        <div className={`relative mb-3.5 overflow-hidden border p-6 md:p-7 ${house?.open ? 'border-[rgba(99,231,169,0.3)] bg-[linear-gradient(135deg,rgba(7,24,16,0.7),#09090b_60%)]' : 'border-[color:var(--rm-line-red)] bg-[linear-gradient(135deg,rgba(28,7,11,0.8),#09090b_60%)]'}`}>
          <span className="pointer-events-none absolute -right-3 -top-6 font-heading text-[120px] leading-none text-white/[0.03]" aria-hidden="true">
            {house?.open ? '開' : '閉'}
          </span>
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-5">
              <span className={`rm-door-chip !px-4 !py-3 !text-[9px] ${house?.open ? 'is-open' : 'is-closed'}`}>
                <span className="rm-door-dot" aria-hidden="true"/>
                {house?.open ? 'A HÁZ NYITVA' : 'A HÁZ ZÁRVA'}
              </span>
              <div>
                <strong className="block font-heading text-[20px] leading-tight text-white">
                  {house?.open ? `${house.since ? formatTime(house.since) : ''} óta fogadunk vendéget.` : house?.shiftOpen ? 'A műszak fut, az ajtó zárva.' : 'Csendes a ház.'}
                </strong>
                <span className="mt-1 block text-[10px] text-[#8d8584]">
                  {house?.open
                    ? `${house.openedBy ? `Nyitotta: ${house.openedBy}.` : ''}${house.note ? ` Ma este: ${house.note}.` : ''} A vendégek nyitvát látnak.`
                    : house?.shiftOpen
                      ? 'Nyisd ki, ha jöhetnek a vendégek. A nyilvános oldal azonnal frissül.'
                      : 'Előbb műszakot kell nyitni, csak utána nyílhat az ajtó.'}
                  {house?.live && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[color:var(--rm-red)]">
                      <Radio size={10}/> LIVE DJ · {house.dj}
                    </span>
                  )}
                </span>
              </div>
            </div>
            {isManager ? (
              <Btn variant={house?.open ? 'outline' : 'red'} onClick={toggleDoor} disabled={busy || (!house?.open && !house?.shiftOpen)}>
                {house?.open ? (
                  <>
                    <DoorClosed size={13}/> HÁZ BEZÁRÁSA
                  </>
                ) : (
                  <>
                    <DoorOpen size={13}/> HÁZ NYITÁSA
                  </>
                )}
              </Btn>
            ) : (
              <BtnLink to="/staff/shift">MŰSZAK ↗</BtnLink>
            )}
          </div>
        </div>

        {/* ------------------------------------------------ MINE */}
        <SectionTitle label="01 / SAJÁT" title="A te estéd."/>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={Timer} glyph="時" label="LEDOLGOZOTT ÓRA" value={totals ? `${totals.hours}` : '—'} hint={totals ? `${totals.shifts} műszak` : undefined}/>
          <Stat icon={Receipt} glyph="売" label="SAJÁT ELADÁS" value={totals ? String(totals.sales) : '—'} hint={totals ? `${totals.items} tétel` : undefined}/>
          <Stat icon={Coins} glyph="金" label="ÁLTALAD HOZOTT BEVÉTEL" value={totals ? formatHuf(totals.revenue) : '—'}/>
          <Stat icon={Truck} glyph="運" label="BESZERZÉS" value={totals ? String(totals.orders) : '—'} hint={totals ? `${formatHuf(totals.orderActual)} elköltve` : undefined}/>
        </div>

        {me && me.days.length > 0 && (
          <Panel className="mt-3.5" label="AKTIVITÁS" title="Az elmúlt fél év." action={<span className="text-[10px] text-[#8d8584]">Minden négyzet egy nap.</span>}>
            <ActivityCalendar
              days={me.days}
              metric="revenue"
              describe={(day, date) =>
                day
                  ? `${date} · ${day.sales} eladás · ${formatHuf(Number(day.revenue))} · ${Number(day.hours).toFixed(1)} óra`
                  : `${date} · nincs aktivitás`
              }
            />
          </Panel>
        )}

        {/* ------------------------------------------------ SUPPLY RUNS */}
        {(canRunOrders || myOrders.length > 0) && (
          <>
            <SectionTitle label="02 / BESZERZÉS" title={myOrders.length ? 'Nálad van.' : 'Elvihető munka.'} action={<BtnLink to="/staff/orders">MINDEN BESZERZÉS ↗</BtnLink>}/>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {myOrders.map((order) => (
                <Link key={order.id} to="/staff/orders" className="group flex items-center justify-between gap-4 border border-[color:var(--rm-line-red)] bg-[rgba(227,40,78,0.06)] p-5 transition-all hover:-translate-y-0.5">
                  <div>
                    <strong className="font-heading text-[17px] text-white">{order.code}</strong>
                    <p className="mt-1 text-[10px] text-[#8d8584]">
                      {ORDER_STATUS_LABEL[order.status as 'claimed' | 'progress']} · {order.items} tétel · {formatHuf(order.estimatedTotal)}
                    </p>
                  </div>
                  <ArrowUpRight size={14} className="text-[color:var(--rm-red)] transition-transform group-hover:-translate-y-0.5"/>
                </Link>
              ))}
              {openOrders.slice(0, 4).map((order) => (
                <Link key={order.id} to="/staff/orders" className="group flex items-center justify-between gap-4 border border-[color:var(--rm-line)] bg-[#09090b] p-5 transition-all hover:-translate-y-0.5 hover:border-[rgba(213,31,60,0.5)]">
                  <div>
                    <strong className="font-heading text-[17px] text-white">{order.code}</strong>
                    <p className="mt-1 text-[10px] text-[#8d8584]">
                      {order.items.length} tétel · {formatHuf(order.estimatedTotal)} · {order.source}
                    </p>
                  </div>
                  <Truck size={14} className="text-[#6f6968] transition-colors group-hover:text-[color:var(--rm-red)]"/>
                </Link>
              ))}
              {!myOrders.length && !openOrders.length && <p className="rm-card p-6 text-[11px] text-[#8d8584]">Most nincs kiírt beszerzés.</p>}
            </div>
          </>
        )}

        {/* ------------------------------------------------ HOUSE TONIGHT */}
        <SectionTitle label="03 / MA ESTE" title="A ház."/>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={Coins} glyph="日" label="MAI BEVÉTEL" value={today ? formatHuf(today.revenue) : '—'} hint={today ? `${today.salesCount} eladás · ${today.items} tétel` : undefined}/>
          <div className="rm-stat p-6">
            <span className="rm-stat-glyph" aria-hidden="true">人</span>
            <Users size={15} className="relative mb-4 text-[color:var(--rm-red)]"/>
            <span className="relative block text-[8px] tracking-[0.25em] text-[#777]">ONLINE</span>
            <strong className="relative mt-2 block font-heading text-[26px] leading-none text-white">{presence ? String(presence.onlineCount) : '—'}</strong>
            <span className="relative mt-3 flex -space-x-2">
              {online.slice(0, 6).map((person) => (
                <span key={person.id} title={person.name}>
                  <Avatar name={person.name} nickname={person.nickname} src={person.avatar} size={24}/>
                </span>
              ))}
            </span>
          </div>
          <Stat icon={Boxes} glyph="庫" label="FOGYÓ KÉSZLET" value={String(lowStock.length)} hint={lowStock.length ? 'Feltöltés javasolt' : 'Minden rendben'} tone={lowStock.length ? 'warn' : 'default'}/>
          <Stat icon={Truck} glyph="運" label="NYITOTT BESZERZÉS" value={String(openOrders.length)}/>
        </div>

        {/* ------------------------------------------------ MANAGER */}
        {isManager && (
          <>
            <SectionTitle label="04 / ÜZLETVEZETÉS" title="Ami rád tartozik." action={<BtnLink to="/staff/documents">BIZONYLAT KÉSZÍTÉSE ↗</BtnLink>}/>
            <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
              <Panel label="KÉSZLET-ELŐREJELZÉS" title="Mi fogy ki előbb?" action={storage && <span className="text-[9px] tracking-[0.15em] text-[#6f6968]">{storage.windowDays} NAP ALAPJÁN</span>}>
                {!urgentStock.length ? (
                  <p className="text-[11px] text-[#8d8584]">Egyik tétel sem fogy ki a következő öt napban.</p>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {urgentStock.map((product) => {
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
              </Panel>

              <Panel
                label="ÉRTESÍTÉSEK"
                title={feed.length ? `${feed.length} olvasatlan` : 'Minden olvasva'}
                action={
                  feed.length > 0 ? (
                    <button type="button" onClick={markAllRead} className="text-[9px] tracking-[0.2em] text-[#777] transition-colors hover:text-emerald-400">
                      MIND OLVASOTT
                    </button>
                  ) : undefined
                }
              >
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
                          <span className="ml-2 text-[9px] text-[#6f6968]">{formatTime(item.at)}</span>
                        </div>
                        <button type="button" onClick={() => markRead(item.id)} aria-label="Olvasottnak jelölés" className="shrink-0 text-[#777] transition-opacity hover:text-emerald-400 md:opacity-0 md:group-hover:opacity-100">
                          <Check size={12}/>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </>
        )}

        {/* ------------------------------------------------ OWNER */}
        {isOwner && business && (
          <>
            <SectionTitle label="05 / A VÁLLALKOZÁS" title="Az egész ház." action={<BtnLink to="/staff/reports">JELENTÉSEK ↗</BtnLink>}/>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <Stat icon={Coins} glyph="収" label="ÖSSZES BEVÉTEL" value={formatHuf(business.lifetime.revenue)}/>
              <Stat icon={Truck} glyph="出" label="ÖSSZES KIADÁS" value={formatHuf(business.lifetime.expense)}/>
              <Stat icon={Activity} glyph="利" label="EREDMÉNY" value={formatHuf(business.lifetime.profit)} hint={business.lifetime.profit < 0 ? 'Veszteséges' : 'Nyereséges'} tone={business.lifetime.profit < 0 ? 'warn' : 'good'}/>
              <Stat icon={AlertTriangle} glyph="差" label="BESZERZÉSI ELTÉRÉS" value={formatHuf(business.orders.variance)} hint={`${business.orders.completed} teljesített`} tone={Math.abs(business.orders.variance) > 0 ? 'warn' : 'default'}/>
            </div>

            <Panel
              className="mt-3.5"
              label="30 NAP"
              title="Bevétel és kiadás."
              action={
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
              }
            >
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
            </Panel>
          </>
        )}

        {/* ------------------------------------------------ TOOLS */}
        <SectionTitle label="06 / ESZKÖZÖK" title="A konzol."/>

        {GROUPS.map((group) => {
          const links = STAFF_NAV.filter((link) => link.group === group && link.to !== '/staff' && roleAtLeast(user?.role, link.need));
          if (!links.length) return null;
          return (
            <div key={group} className="mb-8">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">{group}</span>
              <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
                {links.map((link) => {
                  const Icon = TOOL_ICON[link.to] || Activity;
                  return (
                    <Link key={link.to} to={link.to} className="group relative flex items-center gap-3.5 overflow-hidden border border-[color:var(--rm-line)] bg-[#09090b] p-5 transition-all hover:-translate-y-1 hover:border-[rgba(213,31,60,0.55)]">
                      <span className="pointer-events-none absolute inset-y-0 left-0 w-[2px] scale-y-0 bg-[color:var(--rm-red)] transition-transform duration-300 group-hover:scale-y-100"/>
                      <Icon size={15} className="shrink-0 text-[color:var(--rm-red)]"/>
                      <span className="text-[10px] font-bold tracking-[0.16em] text-white">{link.label}</span>
                      <ArrowUpRight size={13} className="ml-auto shrink-0 text-[#6f6968] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white"/>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2.5">
          {can(user, 'dj') && (
            <BtnLink to="/dj">
              <Radio size={13}/> DJ PULT ↗
            </BtnLink>
          )}
          {isManager && (
            <BtnLink to="/location">
              <MapPin size={13}/> TÉRKÉP JELÖLŐK ↗
            </BtnLink>
          )}
        </div>

        {me && me.recentShifts.length > 0 && (
          <>
            <SectionTitle label="07 / ELŐZMÉNY" title="Legutóbbi műszakjaid."/>
            <Panel padded={false}>
              {me.recentShifts.slice(0, 6).map((shift) => (
                <div key={shift.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.04] px-6 py-4 last:border-b-0">
                  <span className="text-[11px] text-white">
                    {shift.id} · {new Date(shift.startedAt).toLocaleDateString('hu-HU')} · {formatTime(shift.startedAt)}
                    {shift.endedAt ? ` – ${formatTime(shift.endedAt)}` : ' – folyamatban'}
                  </span>
                  <span className="flex gap-6 text-[10px] text-[#8d8584]">
                    <span>{shift.hours} óra</span>
                    <span className="text-[color:var(--rm-red)]">{formatHuf(shift.revenue)}</span>
                  </span>
                </div>
              ))}
            </Panel>
          </>
        )}
      </section>
    </main>
  );
};
