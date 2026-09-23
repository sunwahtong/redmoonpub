import React, {useEffect, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {assetUrl} from '../../lib/api';

/** How long the overlay covers the screen before the route actually changes. */
const LEAD_MS = 520;
/** Hold after the new route paints, so the swap is never visible. */
const HOLD_MS = 180;
/** Matches the rmPageArrive keyframe duration. */
const ARRIVE_MS = 900;

/**
 * The Red Moon page transition.
 *
 * The overlay must cover the screen *before* the route changes. Driving it from
 * a location effect is too late: React has already painted the new page, so the
 * overlay flashes over finished content and then disappears again.
 *
 * So link clicks are intercepted on the capture phase (before React Router's own
 * handler), the overlay is raised, and navigation happens once it is opaque.
 */
export const PageTransition: React.FC = () => {
  const {pathname} = useLocation();
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const pendingRef = useRef(false);

  /* Raise the overlay on internal link clicks, then navigate under it. */
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const link = target?.closest?.<HTMLAnchorElement>('a[href]');
      if (!link) return;
      if (link.target === '_blank' || link.hasAttribute('download') || link.dataset.noTransition === 'true') return;

      let url: URL;
      try {
        url = new URL(link.href, window.location.href);
      } catch {
        return;
      }

      if (url.origin !== window.location.origin) return;
      // Same-page anchors and no-op links keep native behaviour.
      if (url.pathname === window.location.pathname) return;

      event.preventDefault();
      pendingRef.current = true;
      setActive(true);

      window.setTimeout(() => navigate(`${url.pathname}${url.search}${url.hash}`), LEAD_MS);
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);

  /* Drop the overlay once the new route has painted. */
  useEffect(() => {
    if (!pendingRef.current) return;
    pendingRef.current = false;

    const hide = window.setTimeout(() => {
      setActive(false);
      document.body.classList.add('rm-page-arriving');
    }, HOLD_MS);

    const clear = window.setTimeout(
      () => document.body.classList.remove('rm-page-arriving'),
      HOLD_MS + ARRIVE_MS
    );

    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(clear);
    };
  }, [pathname]);

  return (
    <div className={`rm-transition${active ? '' : ' is-ready'}`} aria-hidden="true">
      <span className="rm-corner-orbit tl"/>
      <span className="rm-corner-orbit br"/>

      <div className="rm-transition-inner">
        <span className="rm-transition-ring top"/>
        <span className="rm-transition-ring bottom"/>
        <img className="rm-transition-logo" src={assetUrl('/assets/red-moon-logo.png')} alt=""/>
        <b className="rm-transition-title">RED MOON</b>
        <span className="rm-transition-line"/>
        <span className="rm-transition-status">BETÖLTÉS</span>
      </div>
    </div>
  );
};
