import React, {useEffect, useMemo, useRef, useState} from 'react';
import {NavLink, useLocation} from 'react-router-dom';
import {ChevronDown} from 'lucide-react';
import {STAFF_NAV, type StaffNavLink} from '../../lib/navigation';
import {can, roleAtLeast, useAuthStore} from '../../stores/useAuthStore';
import {realtimeAvailable, useRealtimeConnected} from '../../lib/realtime';
import {Avatar} from '../ui/console';

/** The console's four areas, in the order they read. */
const GROUPS: StaffNavLink['group'][] = ['MŰSZAK', 'VENDÉG', 'KÉSZLET', 'HÁZ'];

/**
 * Persistent navigation for the staff console, in two levels.
 *
 * The first row is short: the overview, the four areas, the live indicator
 * and the person. The second row shows the tools of one area — the area of
 * the page you are on, or the one you just tapped. Sixteen links used to sit
 * side by side in one row; now at most six do, and the row never scrolls on
 * a desktop.
 *
 * Links are filtered by role (or by a capability, for the DJ booth) so the UI
 * never offers something the route guard would bounce. The guard is still what
 * enforces it — this only decides what is worth showing.
 */
export const ConsoleNav: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const subRef = useRef<HTMLDivElement>(null);
  const connected = useRealtimeConnected();
  const [picked, setPicked] = useState<StaffNavLink['group'] | null>(null);

  const links = useMemo(
    () =>
      STAFF_NAV.filter(
        (link) => link.to !== '/staff' && link.to !== '/staff/profile' && (roleAtLeast(user?.role, link.need) || (link.capability && can(user, link.capability)))
      ),
    [user]
  );
  const groups = GROUPS.filter((group) => links.some((link) => link.group === group));
  const currentGroup = links.find((link) => location.pathname === link.to || location.pathname.startsWith(`${link.to}/`))?.group || null;
  const shown = picked || currentGroup || groups[0];

  // A new page means a new area: the picked one no longer applies.
  useEffect(() => {
    setPicked(null);
  }, [location.pathname]);

  // The rows scroll horizontally on a phone, so the active tool can sit off
  // screen after a reload. Pull it into view.
  useEffect(() => {
    const active = subRef.current?.querySelector('[aria-current="page"]');
    active?.scrollIntoView({block: 'nearest', inline: 'center'});
  }, [location.pathname, shown]);

  if (!user) return null;

  return (
    <>
      {/* Spacer for the fixed site header. Kept outside the sticky element —
          padding on the rail itself would travel with it and leave a 68px band
          below the header once stuck. The staff pages no longer pad themselves. */}
      <div className="h-[68px]" aria-hidden="true"/>

      <div className="rm-console-nav">
        <nav className="rm-console-row rm-console-scroll px-6 lg:px-12" aria-label="Konzol">
          <NavLink to="/staff" end className="rm-console-tab is-home">
            ÁTTEKINTÉS
          </NavLink>
          {groups.map((group) => (
            <button
              key={group}
              type="button"
              onClick={() => setPicked(group)}
              className={`rm-console-tab${shown === group ? ' is-open' : ''}${currentGroup === group ? ' is-current' : ''}`}
              aria-expanded={shown === group}
              aria-controls="rm-console-sub"
            >
              {group}
              <ChevronDown size={11}/>
            </button>
          ))}
          <span className="rm-console-spacer" aria-hidden="true"/>
          <span className={`rm-console-live${connected ? ' is-on' : ''}`} title={connected ? 'A változások azonnal megjelennek' : realtimeAvailable ? 'Kapcsolódás… addig rendszeres frissítés' : 'Rendszeres frissítés'}>
            <i aria-hidden="true"/> {connected ? 'ÉLŐ' : 'FRISSÍTÉS'}
          </span>
          <NavLink to="/staff/profile" className="rm-console-me" title="Profilom">
            <Avatar name={user.name} nickname={user.nickname} src={user.avatar} size={22}/>
            <span>{user.nickname || user.name}</span>
          </NavLink>
        </nav>

        <div id="rm-console-sub" ref={subRef} className="rm-console-sub rm-console-scroll px-6 lg:px-12" aria-label={shown}>
          {links
            .filter((link) => link.group === shown)
            .map((link) => (
              <NavLink key={link.to} to={link.to} className={`rm-console-link${link.to === '/dj' ? ' is-booth' : ''}`}>
                {link.label}
              </NavLink>
            ))}
        </div>
      </div>
    </>
  );
};
