import React, {useEffect, useMemo, useState} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {ChevronUp, Radio} from 'lucide-react';
import {useHouseStatus} from '../../hooks/useHouseStatus';
import {useCountdown} from '../../hooks/useCountdown';
import {formatTime, formatWeekday} from '../../lib/api';

/**
 * The door, in the corner of every public page.
 *
 * A moon that is full while the house is open and a thin crescent while it is
 * closed, with the time the door opened. Tapping it unfolds the evening: who
 * opened, whether the booth is live, and the next event with a live countdown.
 * Hidden inside the console, where the same status has its own place.
 */
export const StatusPill: React.FC = () => {
  const {data} = useHouseStatus(20000);
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const countdown = useCountdown(data?.nextEvent?.startsAt || null);

  useEffect(() => {
    setExpanded(false);
  }, [location.pathname]);

  const hidden = location.pathname.startsWith('/staff') || location.pathname === '/dj';

  const since = useMemo(() => {
    if (!data?.open || !data.since) return '';
    return `${formatTime(data.since)} ÓTA`;
  }, [data]);

  if (hidden || !data) return null;

  return (
    <div className={`rm-door-pill ${data.open ? 'is-open' : 'is-closed'}`} role="status">
      <button type="button" className="rm-door-head" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="rm-door-moon" aria-hidden="true"/>
        <span className="min-w-0 flex-1">
          <span className="rm-door-title">{data.open ? 'A RED MOON NYITVA' : 'A RED MOON ZÁRVA'}</span>
          <span className="rm-door-sub truncate">
            {data.open ? since || 'A pult mögött vagyunk.' : 'Naplemente után nyitunk.'}
            {data.live ? ' · LIVE DJ' : ''}
          </span>
        </span>
        <ChevronUp size={13} className={`shrink-0 text-[#6f6968] transition-transform ${expanded ? 'rotate-180' : ''}`}/>
      </button>

      {expanded && (
        <div className="rm-door-body">
          {data.open && data.openedBy && (
            <div className="rm-door-row">
              <span>Kinyitotta</span>
              <b>{data.openedBy}</b>
            </div>
          )}
          {data.note && (
            <div className="rm-door-row">
              <span>Ma este</span>
              <b>{data.note}</b>
            </div>
          )}
          <div className="rm-door-row">
            <span className="flex items-center gap-1.5">
              <Radio size={10} className={data.live ? 'text-[color:var(--rm-red)]' : ''}/> Club
            </span>
            <b>{data.live ? `ÉLŐ · ${data.dj || 'DJ'}` : 'nincs adás'}</b>
          </div>
          {data.nextEvent && (
            <div className="rm-door-row">
              <span>Következő</span>
              <b className="truncate">
                {countdown.elapsed
                  ? `${data.nextEvent.title} · most`
                  : `${countdown.d !== '00' ? `${Number(countdown.d)}n ` : ''}${countdown.h}:${countdown.m}:${countdown.s}`}
              </b>
            </div>
          )}
          {data.nextEvent && (
            <p className="mt-1 truncate text-[9px] text-[#6f6968]">
              {data.nextEvent.title} · {formatWeekday(data.nextEvent.startsAt)} {formatTime(data.nextEvent.startsAt)}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Link to="/reservations" className="rm-btn is-red !px-3 !py-2 !text-[8px]">
              ASZTALFOGLALÁS
            </Link>
            <Link to="/club" className="rm-btn !px-3 !py-2 !text-[8px]">
              CLUB
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

/** Compact chip for the header row. */
export const DoorChip: React.FC<{className?: string}> = ({className = ''}) => {
  const {data} = useHouseStatus(20000);
  if (!data) return null;
  return (
    <Link
      to="/location"
      className={`rm-door-chip ${data.open ? 'is-open' : 'is-closed'}${data.live ? ' is-live' : ''} ${className}`}
      title={data.open ? `Nyitva ${data.since ? formatTime(data.since) : ''} óta` : 'Zárva'}
    >
      <span className="rm-door-dot" aria-hidden="true"/>
      {data.open ? 'NYITVA' : 'ZÁRVA'}
      {data.live && <span className="text-[color:var(--rm-red)]">· LIVE</span>}
    </Link>
  );
};
