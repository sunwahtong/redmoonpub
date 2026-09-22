import React from 'react';
import {Navigate, useLocation} from 'react-router-dom';
import {useAuthStore, roleAtLeast, type Role} from '../../stores/useAuthStore';
import {ConsoleNav} from '../layout/ConsoleNav';

interface Props {
  /** Minimum rank required to see the page. */
  need?: Role;
  children: React.ReactNode;
}

/**
 * Route guard. Purely a convenience for the UI — every endpoint still enforces
 * its own role check, so hiding a page is never the only thing standing between
 * a visitor and the data.
 *
 * Also the one place the console's navigation is mounted, so every staff page
 * gets it without each page having to remember to render it.
 */
export const RequireRole: React.FC<Props> = ({need = 'staff', children}) => {
  const {user, loading} = useAuthStore();
  const location = useLocation();

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

  if (!roleAtLeast(user.role, need)) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center px-6 pt-[68px] text-center">
        <div>
          <div className="rm-label">RED MOON / 403</div>
          <h1 className="mt-3 font-heading text-[32px] text-white">Nincs jogosultságod.</h1>
          <p className="mt-3 text-[12px] text-[#8d8584]">
            Ehhez az oldalhoz legalább <b className="text-white">{need}</b> szint kell.
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <ConsoleNav/>
      {children}
    </>
  );
};
