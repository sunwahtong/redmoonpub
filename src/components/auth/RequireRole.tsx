import React, {useEffect} from 'react';
import {Navigate, useLocation} from 'react-router-dom';
import {useAuthStore, roleAtLeast, type Role} from '../../stores/useAuthStore';
import {apiSend} from '../../lib/api';
import {ConsoleNav} from '../layout/ConsoleNav';

interface Props {
  /** Minimum rank required to see the page. */
  need?: Role;
  children: React.ReactNode;
}

const HEARTBEAT_MS = 30000;

/**
 * Route guard. Purely a convenience for the UI — every endpoint still enforces
 * its own role check, so hiding a page is never the only thing standing between
 * a visitor and the data.
 *
 * Also the one place the console's navigation is mounted and the presence
 * heartbeat runs, so every staff page gets both without remembering to.
 *
 * Two gates sit in front of the console: a password that must be changed
 * (seeded or reset accounts) and a phone number that must be on file. Both are
 * handled on the login page, which the guard sends the person back to.
 */
export const RequireRole: React.FC<Props> = ({need = 'staff', children}) => {
  const {user, loading, restore} = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (!user) return;
    const beat = () =>
      apiSend('/api/presence/heartbeat', 'POST', {}).catch((error) => {
        // A 401 means the session ended elsewhere (takeover, revocation): re-check.
        if ((error as {status?: number}).status === 401) restore();
      });
    beat();
    const timer = window.setInterval(() => {
      if (!document.hidden) beat();
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [user, restore]);

  if (loading) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center pt-[68px]">
        <span className="text-[10px] tracking-[0.3em] text-[#777]">BETÖLTÉS…</span>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/staff-login" replace state={{from: location.pathname}}/>;
  }

  if (user.mustChangePassword || !user.phone) {
    return <Navigate to="/staff-login" replace state={{from: location.pathname}}/>;
  }

  if (!roleAtLeast(user.role, need)) {
    return (
      <>
        <ConsoleNav/>
        <main className="flex min-h-[60vh] items-center justify-center px-6 text-center">
          <div>
            <div className="rm-label">RED MOON / 403</div>
            <h1 className="mt-3 font-heading text-[32px] text-white">Nincs jogosultságod.</h1>
            <p className="mt-3 text-[12px] text-[#8d8584]">
              Ehhez az oldalhoz legalább <b className="text-white">{need}</b> szint kell.
            </p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <ConsoleNav/>
      {children}
    </>
  );
};
