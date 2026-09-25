import React, {useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {Activity, ArrowUpRight, Bell, Boxes, Check, ClipboardList, Coins, Crown, DoorClosed, DoorOpen, FileText, Newspaper, Radio, Timer, Truck, UserPlus, Users} from 'lucide-react';
import {Btn, BtnLink} from '../../components/ui/Btn';
import {Sparkline} from '../../components/ui/Sparkline';
import {Avatar, PageHeader, Panel, SectionTitle} from '../../components/ui/console';
import {StaffBoard} from '../../components/staff/StaffBoard';
import {useLiveData} from '../../hooks/useLiveData';
import {useHouseStatus} from '../../hooks/useHouseStatus';
import {useElapsed} from '../../hooks/useElapsed';
import {apiSend, formatHuf, formatTime} from '../../lib/api';
import {JOB_LABEL, type StaffJob} from '../../lib/orders';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {dialog} from '../../stores/useDialogStore';
import {useAuthStore, can, roleAtLeast} from '../../stores/useAuthStore';
import {useShiftReportStore} from '../../stores/useShiftReportStore';

interface Dashboard {
  today: {revenue: number; items: number; salesCount: number};
  overallRevenue: number;
  lowStock: {id: string; name: string; stock: number; minStock: number}[];
  topSales: {product: string; qty: number}[];
  openShift: {id: string; openedByName?: string; openedAt?: string} | null;
  counts: {reservationsToday: number; reservationsPending: number; applicationsPending: number; ordersOpen: number; unread: number; lowStock: number; memberMessages?: number};
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
  totals: {shifts: number; hours: number; sales: number; items: number; revenue: number; orders: number};
  openShift: {id: string; startedAt: string} | null;
}

interface StorageAnalytics {
  windowDays: number;
  products: {id: string; name: string; stock: number; minStock: number; perDay: number; daysLeft: number | null; below: boolean}[];
}

interface BusinessAnalytics {
  lifetime: {revenue: number; expense: number; profit: number};
  window: {revenue: number; expense: number; sales: number};
  trend: {date: string; revenue: number; expense: number; sales: number}[];
  topProducts: {product: string; qty: number; revenue: number}[];
}

interface Quick {
  to: string;
  label: string;
  hint: string;
  icon: React.ElementType;
  badge?: number;
  primary?: boolean;
}

/**
 * The console's front page: what is happening right now, the handful of
 * things you would do next, tonight in numbers, the staff board — and
 * nothing else. The full tool list lives in the navigation above.
 */
export const DashboardPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const isManager = roleAtLeast(user?.role, 'manager');
  const isOwner = roleAtLeast(user?.role, 'owner');

  const {data: dashboard, refresh: refreshDashboard} = useLiveData<Dashboard>('/api/dashboard', {intervalMs: 30000, topics: ['house', 'content', 'reservations', 'staff']});
  const {data: house, refresh: refreshHouse} = useHouseStatus();
  const {data: presence} = useLiveData<Presence>('/api/presence', {intervalMs: 30000, topics: ['staff']});
  const {data: notifications, refresh: refreshNotifications} = useLiveData<Notifications>('/api/notifications', {intervalMs: 60000, enabled: isManager, topics: ['reservations', 'content']});
  const {data: me} = useLiveData<PersonalAnalytics>('/api/analytics/me', {intervalMs: 60000});
  const {data: storage} = useLiveData<StorageAnalytics>('/api/analytics/storage', {intervalMs: 90000, enabled: isManager});
  const {data: business} = useLiveData<BusinessAnalytics>('/api/analytics/business', {intervalMs: 90000, enabled: isOwner});
  const shiftElapsed = useElapsed(dashboard?.openShift?.openedAt || null);

  const [busy, setBusy] = useState(false);
  const pendingReports = useShiftReportStore((state) => state.queue.length);
  const wakeReports = useShiftReportStore((state) => state.wake);

  const today = dashboard?.today;
  const counts = dashboard?.counts;
  const online = presence?.online || [];
  const feed = (notifications?.notifications || []).filter((item) => !item.read).slice(0, 5);
  const totals = me?.totals;
  const shiftOpen = !!dashboard?.openShift;
  const urgentStock = useMemo(() => (storage?.products || []).filter((product) => product.daysLeft !== null && product.daysLeft <= 5).slice(0, 4), [storage]);

  const toggleDoor = async () => {
    if (!house || busy) return;
    if (house.open) {
      const sure = await dialog.confirm({title: 'Bezárod a házat?', message: 'A nyilvános oldal azonnal zárvát mutat. A műszak nyitva marad.', confirmLabel: 'BEZÁRÁS'});
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

  const markRead = async (id?: string) => {
    try {
      await apiSend('/api/notifications/read', 'POST', id ? {id} : {all: true});
      refreshNotifications();
      refreshDashboard();
      playSfx('success');
    } catch {
      /* nothing to recover from */
    }
  };

  const jobLabels = (user?.jobs || []).map((job) => JOB_LABEL[job as StaffJob] || job).join(', ');

  /* The one thing the evening asks for next. */
  const primary = !shiftOpen
    ? {to: '/staff/shift', label: 'MŰSZAK NYITÁSA'}
    : !house?.open && isManager
      ? {action: toggleDoor, label: 'HÁZ NYITÁSA'}
      : {to: '/staff/register', label: 'KASSZA'};

  const quick: Quick[] = [
    {to: '/staff/register', label: 'KASSZA', hint: shiftOpen ? 'Eladás rögzítése' : 'Előbb műszak kell', icon: Coins, primary: shiftOpen},
    {to: '/staff/shift', label: 'MŰSZAK', hint: shiftOpen ? 'Tagok, ajtó, zárás' : 'Az este kezdete', icon: Timer, primary: !shiftOpen},
    {to: '/staff/reservations', label: 'FOGLALÁSOK', hint: counts ? `${counts.reservationsToday} ma estére` : 'Asztalok', icon: ClipboardList, badge: counts?.reservationsPending},
    {to: '/staff/orders', label: 'BESZERZÉS', hint: counts?.ordersOpen ? `${counts.ordersOpen} kiírva` : 'Kiírt és futó', icon: Truck, badge: counts?.ordersOpen},
    ...(isManager
      ? [
          {to: '/staff/inventory', label: 'RAKTÁR', hint: counts?.lowStock ? `${counts.lowStock} tétel fogy` : 'Készlet rendben', icon: Boxes, badge: counts?.lowStock},
          {to: '/staff/applications', label: 'JELENTKEZÉSEK', hint: 'Új emberek', icon: UserPlus, badge: counts?.applicationsPending},
          {to: '/staff/members', label: 'A HOUSE', hint: counts?.memberMessages ? `${counts.memberMessages} üzenet a tagoktól` : 'Tagság, kódok, látogatások', icon: Crown, badge: counts?.memberMessages},
          {to: '/staff/documents', label: 'BIZONYLATOK', hint: 'Nyugta, számla, jelentés', icon: FileText}
        ]
      : []),
    ...(can(user, 'dj') ? [{to: '/dj', label: 'DJ PULT', hint: house?.onAir ? 'Adásban' : house?.live ? 'Bejelentkezve, a rádió csendes' : 'A pult csendes', icon: Radio}] : []),
    ...(isOwner
      ? [
          {to: '/staff/posts', label: 'HÍREK', hint: 'A ház hírei', icon: Newspaper},
          {to: '/staff/users', label: 'FIÓKOK', hint: 'Csapat és jogok', icon: Users}
        ]
      : [])
  ];

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
              <span className="border border-[color:var(--rm-line-red)] px-2.5 py-1 text-[8px] tracking-[0.2em] text-[color:var(--rm-red)]">{(user?.role || '').toUpperCase()}</span>
              {jobLabels && <span className="text-[10px] tracking-[0.15em] text-[#8d8584]">{jobLabels}</span>}
            </span>
          }
          actions={
            <>
              {'action' in primary ? (
                <Btn variant="red" onClick={primary.action} disabled={busy}>
                  <DoorOpen size={13}/> {primary.label}
                </Btn>
              ) : (
                <BtnLink to={primary.to} variant="red">
                  {primary.label} ↗
                </BtnLink>
              )}
              <BtnLink to="/staff/profile">PROFILOM ↗</BtnLink>
            </>
          }
        />

        {pendingReports > 0 && (
          <button type="button" onClick={wakeReports} className="rm-closing-banner">
            <span className="rm-label">FONTOS</span>
            <strong>{pendingReports === 1 ? 'Egy műszakzárás vár rád: az utalás részletei.' : `${pendingReports} műszakzárás vár rád: az utalások részletei.`}</strong>
            <span>MEGNYITOM →</span>
          </button>
        )}

        {/* ------------------------------------------------ NOW */}
        <div className="rm-now-grid" data-tour="now">
          <div className={`rm-now-tile ${house?.open ? 'is-good' : 'is-red'}`} data-tour="door">
            <span className="rm-now-tile-glyph" aria-hidden="true">{house?.open ? '開' : '閉'}</span>
            <span className="rm-now-tile-label">
              {house?.open ? <DoorOpen size={10}/> : <DoorClosed size={10}/>} A HÁZ
            </span>
            <strong className="rm-now-tile-value">{house?.open ? 'Nyitva' : 'Zárva'}</strong>
            <span className="rm-now-tile-hint">
              {house?.open
                ? `${house.since ? `${formatTime(house.since)} óta` : ''}${house.openedBy ? ` · ${house.openedBy}` : ''}${house.note ? ` · ${house.note}` : ''}`
                : house?.shiftOpen
                  ? 'A műszak fut, az ajtó zárva.'
                  : 'Csendes a ház.'}
            </span>
            {isManager && (
              <button type="button" onClick={toggleDoor} disabled={busy || (!house?.open && !house?.shiftOpen)} className="rm-now-tile-action">
                {house?.open ? 'BEZÁRÁS' : 'NYITÁS'}
              </button>
            )}
          </div>

          <Link to="/staff/shift" className="rm-now-tile">
            <span className="rm-now-tile-glyph" aria-hidden="true">時</span>
            <span className="rm-now-tile-label">
              <Timer size={10}/> MŰSZAK
            </span>
            <strong className="rm-now-tile-value">{dashboard?.openShift ? dashboard.openShift.id : 'Nincs nyitva'}</strong>
            <span className="rm-now-tile-hint">{dashboard?.openShift ? `${dashboard.openShift.openedByName || ''}${shiftElapsed ? ` · ${shiftElapsed}` : ''}` : 'Nyisd meg, ha kezdődik az este.'}</span>
          </Link>

          <Link to={can(user, 'dj') ? '/dj' : '/club'} className={`rm-now-tile${house?.onAir ? ' is-red' : ''}`}>
            <span className="rm-now-tile-glyph" aria-hidden="true">音</span>
            <span className="rm-now-tile-label">
              <Radio size={10}/> A PULT
            </span>
            <strong className="rm-now-tile-value">{house?.live ? house.dj || 'Red Moon DJ' : 'Csend'}</strong>
            <span className="rm-now-tile-hint">{house?.live ? (house.onAir ? `Adásban · ${house.stationListeners} hallgató` : 'Bejelentkezve, a rádió még csendes') : 'Nincs adás'}</span>
          </Link>

          <div className="rm-now-tile">
            <span className="rm-now-tile-glyph" aria-hidden="true">人</span>
            <span className="rm-now-tile-label">
              <Users size={10}/> CSAPAT
            </span>
            <strong className="rm-now-tile-value">{presence ? `${presence.onlineCount} online` : '—'}</strong>
            <span className="mt-3 flex -space-x-2">
              {online.slice(0, 7).map((person) => (
                <span key={person.id} title={person.name}>
                  <Avatar name={person.name} nickname={person.nickname} src={person.avatar} size={24}/>
                </span>
              ))}
              {!online.length && <span className="rm-now-tile-hint">Most senki más nincs bent.</span>}
            </span>
          </div>
        </div>

        {/* ------------------------------------------------ QUICK */}
        <SectionTitle label="01 / GYORS" title="Amit most csinálnál."/>
        <div className="rm-quick-grid" data-tour="quick">
          {quick.map((item) => (
            <Link key={item.to} to={item.to} className={`rm-quick${item.primary ? ' is-primary' : ''}`}>
              <item.icon size={16}/>
              <span>
                <b>{item.label}</b>
                <small className="mt-1 block">{item.hint}</small>
              </span>
              {!!item.badge && <span className="rm-quick-badge">{item.badge}</span>}
            </Link>
          ))}
        </div>

        {/* ------------------------------------------------ TONIGHT + BOARD */}
        <SectionTitle label="02 / MA ESTE" title="A ház számokban."/>
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <div className="flex flex-col gap-3.5 lg:col-span-2">
            <Panel label="MAI FORGALOM" title={today ? formatHuf(today.revenue) : '—'} action={<BtnLink to="/staff/sales">ELADÁSOK ↗</BtnLink>}>
              <div className="rm-mini-stats">
                <div className="rm-mini">
                  <span>ELADÁS</span>
                  <b>{today ? today.salesCount : '—'}</b>
                </div>
                <div className="rm-mini">
                  <span>TÉTEL</span>
                  <b>{today ? today.items : '—'}</b>
                </div>
                <div className="rm-mini">
                  <span>FOGLALÁS MA</span>
                  <b>{counts ? counts.reservationsToday : '—'}</b>
                </div>
              </div>
              {!!dashboard?.topSales.length && (
                <div className="mt-5 border-t border-white/[0.06] pt-4">
                  <span className="text-[8px] tracking-[0.25em] text-[#777]">MA A LEGTÖBBET</span>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 text-[11px]">
                    {dashboard.topSales.slice(0, 5).map((item) => (
                      <span key={item.product} className="text-[#c9c2c1]">
                        {item.product}
                        <span className="ml-2 text-[color:var(--rm-red)]">{item.qty}×</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            {isManager && (
              <Panel label="KÉSZLET" title={urgentStock.length ? 'Ami előbb fogy ki.' : 'Semmi nem fogy ki a héten.'} action={<BtnLink to="/staff/inventory">RAKTÁR ↗</BtnLink>}>
                {!urgentStock.length ? (
                  <p className="text-[11px] text-[#8d8584]">{storage ? `${storage.windowDays} nap fogyása alapján minden tétel kitart.` : 'Számolunk…'}</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {urgentStock.map((product) => {
                      const share = product.daysLeft === null ? 1 : Math.min(1, product.daysLeft / 10);
                      return (
                        <li key={product.id}>
                          <div className="flex items-baseline justify-between gap-3 text-[11px]">
                            <span className="truncate text-white">{product.name}</span>
                            <span className={product.daysLeft !== null && product.daysLeft <= 2 ? 'text-[color:var(--rm-red)]' : 'text-[#8d8584]'}>
                              {product.daysLeft === null ? 'nincs adat' : `${product.daysLeft} nap`} · {product.stock} db
                            </span>
                          </div>
                          <div className="rm-gauge mt-1.5" data-state={share < 0.3 ? 'low' : share > 0.7 ? 'healthy' : 'mid'}>
                            <span style={{width: `${Math.max(4, share * 100)}%`}}/>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            )}

            {isOwner && business && (
              <Panel
                label="30 NAP"
                title="Bevétel és kiadás."
                action={
                  <div className="flex gap-5 text-[10px]">
                    <span className="flex items-center gap-2 text-[#c9c2c1]">
                      <span className="h-[2px] w-5 bg-[color:var(--rm-red)]"/>
                      {formatHuf(business.window.revenue)}
                    </span>
                    <span className="flex items-center gap-2 text-[#8d8584]">
                      <span className="h-[2px] w-5 border-t border-dashed border-[#8d8584]"/>
                      {formatHuf(business.window.expense)}
                    </span>
                  </div>
                }
              >
                <Sparkline
                  label="Bevétel és kiadás az elmúlt 30 napban"
                  height={80}
                  series={[
                    {label: 'Bevétel', values: business.trend.map((day) => day.revenue), fill: true},
                    {label: 'Kiadás', values: business.trend.map((day) => day.expense), color: '#8d8584'}
                  ]}
                />
                <div className="rm-mini-stats mt-5">
                  <div className="rm-mini">
                    <span>ÖSSZES BEVÉTEL</span>
                    <b>{formatHuf(business.lifetime.revenue)}</b>
                  </div>
                  <div className="rm-mini">
                    <span>ÖSSZES KIADÁS</span>
                    <b>{formatHuf(business.lifetime.expense)}</b>
                  </div>
                  <div className={`rm-mini${business.lifetime.profit < 0 ? ' is-warn' : ' is-good'}`}>
                    <span>EREDMÉNY</span>
                    <b>{formatHuf(business.lifetime.profit)}</b>
                  </div>
                </div>
                <div className="mt-4">
                  <BtnLink to="/staff/reports">
                    <Activity size={12}/> JELENTÉSEK ↗
                  </BtnLink>
                </div>
              </Panel>
            )}
          </div>

          <div className="flex flex-col gap-3.5">
            <div data-tour="board">
              <StaffBoard/>
            </div>

            {isManager && (
              <Panel
                padded={false}
                label="ÉRTESÍTÉSEK"
                action={
                  feed.length > 0 ? (
                    <button type="button" onClick={() => markRead()} className="text-[9px] tracking-[0.2em] text-[#777] transition-colors hover:text-emerald-400">
                      MIND OLVASOTT
                    </button>
                  ) : (
                    <span className="text-[9px] text-[#777]">nincs új</span>
                  )
                }
              >
                <ul className="flex flex-col">
                  {!feed.length && <li className="px-5 py-4 text-[11px] text-[#8d8584]">Minden olvasva.</li>}
                  {feed.map((item) => (
                    <li key={item.id} className="group flex gap-3 border-b border-white/[0.04] px-5 py-3 last:border-b-0">
                      <Bell size={11} className="mt-0.5 shrink-0 text-[color:var(--rm-red)]"/>
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-[11px] text-white">{item.title}</strong>
                        <span className="text-[10px] leading-[1.5] text-[#8d8584]">{item.message}</span>
                        <span className="ml-2 text-[9px] text-[#6f6968]">{formatTime(item.at)}</span>
                      </div>
                      <button type="button" onClick={() => markRead(item.id)} aria-label="Olvasottnak jelölés" className="shrink-0 text-[#777] hover:text-emerald-400">
                        <Check size={12}/>
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel label="RÓLAD" title="Az estéid." action={<Link to="/staff/profile" className="text-[9px] tracking-[0.2em] text-[#777] hover:text-white">PROFIL ↗</Link>}>
              <div className="rm-mini-stats">
                <div className="rm-mini">
                  <span>ÓRA</span>
                  <b>{totals ? totals.hours : '—'}</b>
                </div>
                <div className="rm-mini">
                  <span>ELADÁS</span>
                  <b>{totals ? totals.sales : '—'}</b>
                </div>
                <div className="rm-mini">
                  <span>BEVÉTEL</span>
                  <b className="!text-[13px]">{totals ? formatHuf(totals.revenue) : '—'}</b>
                </div>
              </div>
              <p className="mt-3 text-[10px] text-[#8d8584]">
                {totals ? `${totals.shifts} műszak · ${totals.orders} beszerzés.` : 'Számolunk…'}
                <Link to="/staff/profile" className="ml-1 inline-flex items-center gap-1 text-[color:var(--rm-red-bright)]">
                  Részletek <ArrowUpRight size={10}/>
                </Link>
              </p>
            </Panel>
          </div>
        </div>
      </section>
    </main>
  );
};
