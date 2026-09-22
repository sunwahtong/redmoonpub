import React, {useEffect, useMemo, useRef} from 'react';
import {NavLink, useLocation} from 'react-router-dom';
import {STAFF_NAV} from '../../lib/navigation';
import {roleAtLeast, useAuthStore} from '../../stores/useAuthStore';

/**
 * Persistent navigation for the staff console.
 *
 * Before this, the console was reachable only through a row of buttons on the
 * dashboard: every move from one tool to another meant going back to `/staff`
 * first, and two of the newer pages had no entry point at all outside the
 * address bar.
 *
 * Links are filtered by role so the UI never offers something the route guard
 * would bounce. The guard is still what enforces it — this only decides what is
 * worth showing.
 */
export const ConsoleNav: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const links = useMemo(
    () => STAFF_NAV.filter((link) => roleAtLeast(user?.role, link.need)),
    [user?.role]
  );

  // The rail scrolls horizontally on a phone, so the active tool can sit off
  // screen after a reload. Pull it into view.
  useEffect(() => {
    const active = scrollRef.current?.querySelector('[aria-current="page"]');
    active?.scrollIntoView({block: 'nearest', inline: 'center'});
  }, [location.pathname]);

  if (!user) return null;

  let previousGroup = '';

  return (
    <>
      {/* Spacer for the fixed site header. Kept outside the sticky element —
          padding on the rail itself would travel with it and leave a 68px band
          below the header once stuck. The staff pages no longer pad themselves. */}
      <div className="h-[68px]" aria-hidden="true"/>

      <div className="rm-console-nav">
      <nav ref={scrollRef} className="rm-console-scroll px-6 lg:px-12" aria-label="Konzol">
        {links.map((link) => {
          const first = link.group !== previousGroup;
          previousGroup = link.group;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/staff'}
              data-first={first}
              className="rm-console-link"
              title={link.group}
            >
              {link.label}
            </NavLink>
          );
        })}
      </nav>
      </div>
    </>
  );
};
