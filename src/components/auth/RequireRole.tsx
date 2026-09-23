import React, {useEffect, useRef} from 'react';
import {Navigate, useLocation, useNavigate} from 'react-router-dom';
import {useAuthStore, roleAtLeast, type Role} from '../../stores/useAuthStore';
import {apiSend} from '../../lib/api';
import {dialog} from '../../stores/useDialogStore';
import {ConsoleNav} from '../layout/ConsoleNav';

interface Props {
  /** Minimum rank required to see the page. */
  need?: Role;
  children: React.ReactNode;
}

const HEARTBEAT_MS = 30000;
const PROMPT_KEY = 'rm-signature-prompted';

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
 *
 * A third thing happens here, once per visit: a manager or owner who has not
 * chosen their signature yet is asked to — at the moment of the promotion if
 * they are signed in, otherwise at their next sign-in.
 */
export const RequireRole: React.FC<Props> = ({need = 'staff', children}) => {
  const {user, loading, restore} = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const asking = useRef(false);

  useEffect(() => {
    if (!user) return;
    const beat = () =>
      apiSend<{signaturePrompt?: boolean; role?: string}>('/api/presence/heartbeat', 'POST', {})
        .then((reply) => {
          // A promotion since the last /api/me: refresh the account so the prompt can show.
          if ((reply.signaturePrompt && !user.signaturePrompt) || (reply.role && reply.role !== user.role)) restore();
        })
        .catch((error) => {
          // A 401 means the session ended elsewhere (takeover, revocation): re-check.
          if ((error as {status?: number}).status === 401) restore();
        });
    beat();
    const timer = window.setInterval(() => {
      if (!document.hidden) beat();
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [user, restore]);

  useEffect(() => {
    if (!user?.signaturePrompt || asking.current) return;
    if (location.pathname === '/staff/profile') return;
    if (sessionStorage.getItem(PROMPT_KEY) === user.id) return;
    asking.current = true;
    sessionStorage.setItem(PROMPT_KEY, user.id);
    dialog
      .confirm({
        title: 'Az aláírásod',
        message:
          'Manager vagy tulajdonos vagy, így a ház dokumentumain a te aláírásod szerepel. Most még eldöntheted, milyen legyen: megrajzolhatod, feltölthetsz egy képet, vagy választhatsz a nevedből készült változatok közül.',
        detail:
          'Ha most kihagyod, később a Profil oldalon bármikor beállíthatod. Amint viszont az első dokumentum elkészül a neveddel, az aláírás végleges lesz — ha addig nem választottál, az automatikusan generált marad rajta.',
        confirmLabel: 'MEGNÉZEM',
        cancelLabel: 'KÉSŐBB'
      })
      .then((go) => {
        asking.current = false;
        if (go) navigate('/staff/profile#alairas');
      });
  }, [user, location.pathname, navigate]);

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
