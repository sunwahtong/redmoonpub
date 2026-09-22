import React from 'react';
import {Link} from 'react-router-dom';
import {NAV_GROUP, NAV_LINKS, RESERVE_LINK, STAFF_LINK} from '../../lib/navigation';

/**
 * Footer sitemap.
 *
 * Every public route appears here exactly once, in columns rather than as one
 * wrapping row — the old single row hid `/careers` among nine other items, and
 * a visitor looking for a job had no reason to scan it.
 */
const COLUMNS: {heading: string; links: {to: string; label: string}[]}[] = [
  {heading: 'A BÁR', links: NAV_LINKS.filter((link) => link.to !== '/')},
  {heading: NAV_GROUP.label, links: NAV_GROUP.links.map(({to, label}) => ({to, label}))},
  {heading: 'BELÉPÉS', links: [RESERVE_LINK, STAFF_LINK]}
];

export const Footer: React.FC = () => (
  <footer className="relative border-t border-rm-border">
    {/* Neon filament along the seam, matching the ticker and the menu panel. */}
    <div
      className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,43,79,0.5),transparent)]"
      aria-hidden="true"
    />

    <div className="mx-auto max-w-[1180px] px-6 py-16">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Link to="/" className="inline-flex items-center gap-3">
            <img
              src="/assets/red-moon-logo.png"
              alt=""
              className="h-10 w-10 object-contain drop-shadow-[0_0_12px_rgba(227,40,78,0.45)]"
              aria-hidden="true"
            />
            <span className="font-heading text-lg font-bold text-white">
              RED MOON <span className="text-sm text-rm-red">PUB</span>
            </span>
          </Link>

          <p className="mt-5 max-w-xs text-[11px] leading-[1.9] text-[#827b7a]">
            SeeCity éjszakájának elegáns menedéke. Prémium italok, vörös fények, és esték, amelyekből emlék lesz.
          </p>

          <Link
            to={RESERVE_LINK.to}
            className="mt-7 inline-block border border-[color:var(--rm-red)] px-5 py-3 text-[9px] font-bold tracking-[0.2em] text-[color:var(--rm-red)] transition-all hover:bg-[color:var(--rm-red)] hover:text-white"
          >
            {RESERVE_LINK.label} ↗
          </Link>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.heading} aria-label={column.heading}>
            <span className="rm-label">{column.heading}</span>
            <ul className="mt-4 flex flex-col gap-3">
              {column.links.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-[11px] tracking-[0.1em] text-[#827b7a] transition-colors hover:text-white"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="rm-gilt my-10"/>

      <div className="flex flex-col items-center justify-between gap-3 text-[10px] tracking-[0.15em] text-[#5f5959] md:flex-row">
        <span>SEE CITY · AZ ÉJSZAKA A TIÉD</span>
        <span className="font-heading text-[13px] text-[rgba(227,40,78,0.5)]" aria-hidden="true">
          月
        </span>
      </div>
    </div>
  </footer>
);
