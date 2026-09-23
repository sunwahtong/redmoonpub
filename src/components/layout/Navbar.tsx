import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Link, NavLink, useLocation} from 'react-router-dom';
import {ChevronDown, Menu, X} from 'lucide-react';
import {VolumePanel} from './VolumePanel';
import {DoorChip} from './StatusPill';
import {NAV_GROUP, NAV_LINKS, RESERVE_LINK, STAFF_LINK} from '../../lib/navigation';
import {useAuthStore} from '../../stores/useAuthStore';

export const Navbar: React.FC = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const user = useAuthStore((state) => state.user);

  // A route change should never leave a menu hanging open.
  useEffect(() => {
    setMobileOpen(false);
    setGroupOpen(false);
  }, [location.pathname]);

  // The mobile sheet covers the page; letting the page behind it scroll is
  // the classic way a full-screen menu feels broken.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  // Close the dropdown on Escape or on a click outside it.
  useEffect(() => {
    if (!groupOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGroupOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!groupRef.current?.contains(event.target as Node)) setGroupOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [groupOpen]);

  const groupActive = NAV_GROUP.links.some((link) => location.pathname === link.to);

  const linkClass = ({isActive}: {isActive: boolean}) =>
    `text-[9px] font-semibold uppercase tracking-[0.18em] transition-colors ${
      isActive ? 'text-white drop-shadow-[0_0_10px_rgba(227,40,78,0.9)]' : 'text-[#aaa] hover:text-white'
    }`;

  const consoleTarget = user ? '/staff' : STAFF_LINK.to;

  return (
    <header className="fixed left-0 top-0 z-50 flex h-[68px] w-full items-center justify-between border-b border-white/[0.06] bg-[#050304]/80 px-6 backdrop-blur-md lg:px-12">
      <Link to="/" className="flex items-center gap-3 font-heading text-base font-bold tracking-widest text-white">
        <img
          src="/assets/red-moon-logo.png"
          alt="Red Moon"
          className="h-9 w-9 object-contain drop-shadow-[0_0_10px_rgba(227,40,78,0.5)]"
        />
        <div className="flex flex-col">
          <span className="leading-none">RED MOON</span>
          <span className="font-sans text-[9px] font-semibold tracking-[0.25em] text-rm-red">PUB</span>
        </div>
      </Link>

      <nav className="hidden items-center gap-5 md:flex xl:gap-7">
        {NAV_LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.to === '/'} className={linkClass}>
            {link.label}
          </NavLink>
        ))}

        {/* Everything that does not fit the row lives here rather than in the
            footer, where the careers page was effectively invisible. */}
        {/* Full header height, so the panel's `top: 100%` lands on the header's
            bottom edge instead of under the button's text box. */}
        <div ref={groupRef} className="relative flex h-[68px] items-center">
          <button
            type="button"
            onClick={() => setGroupOpen((open) => !open)}
            aria-expanded={groupOpen}
            aria-haspopup="true"
            className={`flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] transition-colors ${
              groupActive || groupOpen ? 'text-white drop-shadow-[0_0_10px_rgba(227,40,78,0.9)]' : 'text-[#aaa] hover:text-white'
            }`}
          >
            {NAV_GROUP.label}
            <ChevronDown size={12} className={`transition-transform ${groupOpen ? 'rotate-180' : ''}`}/>
          </button>

          {groupOpen && (
            <div className="rm-menu-panel">
              {NAV_GROUP.links.map((link) => (
                <NavLink key={link.to} to={link.to} className="rm-menu-item">
                  <span className="rm-menu-glyph" aria-hidden="true">
                    {link.glyph}
                  </span>
                  <span className="relative block text-[10px] font-bold tracking-[0.18em] text-white">
                    {link.label}
                  </span>
                  <span className="relative mt-1.5 block text-[10px] leading-[1.6] text-[#8d8584]">
                    {link.description}
                  </span>
                </NavLink>
              ))}
            </div>
          )}
        </div>

        <span className="hidden xl:inline-flex">
          <DoorChip/>
        </span>

        {/* The one action the header pushes. */}
        <Link
          to={RESERVE_LINK.to}
          className="border border-[color:var(--rm-red)] bg-[color:var(--rm-red)] px-3.5 py-2.5 text-[9px] font-bold tracking-[0.18em] text-white transition-all hover:bg-[color:var(--rm-red-neon)] hover:shadow-[0_10px_30px_rgba(213,31,60,0.35)]"
        >
          {RESERVE_LINK.label}
        </Link>

        <Link
          to={consoleTarget}
          className="border border-[rgba(213,31,60,0.55)] px-3.5 py-2.5 text-[9px] font-bold tracking-[0.18em] text-[color:var(--rm-red)] transition-all hover:border-[color:var(--rm-red)] hover:bg-[rgba(213,31,60,0.12)] hover:text-white"
        >
          {user ? (user.nickname || user.name).toUpperCase() : STAFF_LINK.label}
        </Link>
      </nav>

      <div className="flex items-center gap-3">
        <span className="inline-flex xl:hidden">
          <DoorChip/>
        </span>
        <VolumePanel/>

        <button
          onClick={() => setMobileOpen((open) => !open)}
          className="p-1 text-white md:hidden"
          aria-label="Menü"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X size={22}/> : <Menu size={22}/>}
        </button>
      </div>

      {/* Full-height sheet rather than a dropped stack: at eleven destinations
          the old panel ran past the fold with no way to tell there was more.

          Portalled to <body> on purpose. The header carries `backdrop-blur`,
          and `backdrop-filter` makes an element the containing block for its
          fixed-position descendants — inside the header the sheet resolved
          `inset: 68px 0 0 0` against a 68px box and computed to zero height. */}
      {mobileOpen &&
        createPortal(
        <div className="rm-sheet md:hidden">
          <div className="flex flex-col gap-1 px-6 py-7">
            {NAV_LINKS.map((link, index) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                style={{animationDelay: `${index * 45}ms`}}
                className={({isActive}) =>
                  `rm-sheet-row border-b border-white/[0.05] py-4 font-heading text-[19px] tracking-wide transition-colors ${
                    isActive ? 'text-white' : 'text-[#8e7e86]'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}

            <span
              className="rm-sheet-row rm-label mt-7"
              style={{animationDelay: `${NAV_LINKS.length * 45}ms`}}
            >
              {NAV_GROUP.label}
            </span>

            {NAV_GROUP.links.map((link, index) => (
              <NavLink
                key={link.to}
                to={link.to}
                style={{animationDelay: `${(NAV_LINKS.length + index + 1) * 45}ms`}}
                className={({isActive}) =>
                  `rm-sheet-row flex items-baseline justify-between gap-4 border-b border-white/[0.05] py-3.5 transition-colors ${
                    isActive ? 'text-white' : 'text-[#8e7e86]'
                  }`
                }
              >
                <span className="text-[12px] font-semibold tracking-[0.16em]">{link.label}</span>
                <span className="font-heading text-[20px] leading-none text-[rgba(227,40,78,0.45)]" aria-hidden="true">
                  {link.glyph}
                </span>
              </NavLink>
            ))}

            <div
              className="rm-sheet-row mt-8 flex flex-col gap-2.5"
              style={{animationDelay: `${(NAV_LINKS.length + NAV_GROUP.links.length + 2) * 45}ms`}}
            >
              <Link
                to={RESERVE_LINK.to}
                className="border border-[color:var(--rm-red)] bg-[color:var(--rm-red)] px-4 py-3.5 text-center text-[10px] font-bold tracking-[0.2em] text-white"
              >
                {RESERVE_LINK.label}
              </Link>
              <Link
                to={consoleTarget}
                className="border border-[rgba(213,31,60,0.55)] px-4 py-3.5 text-center text-[10px] font-bold tracking-[0.2em] text-[color:var(--rm-red)]"
              >
                {user ? 'KONZOL ↗' : 'STAFF KONZOL ↗'}
              </Link>
            </div>
          </div>
        </div>,
          document.body
        )}
    </header>
  );
};
