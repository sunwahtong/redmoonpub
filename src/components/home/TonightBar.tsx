import React from 'react';
import {Link} from 'react-router-dom';
import {CalendarClock, DoorOpen, Radio} from 'lucide-react';
import {useHouseStatus} from '../../hooks/useHouseStatus';
import {formatTime, formatWeekday} from '../../lib/api';

/**
 * "Ma este" — one strip answering the three things a visitor actually wants to
 * know before leaving home: are you open, is there music, and what is next.
 * Every piece degrades to a useful line when the house has nothing to say.
 */
export const TonightBar: React.FC = () => {
  const {data: status} = useHouseStatus(20000);
  const nextEvent = status?.nextEvent || null;
  const live = !!status?.live;

  const cells = [
    {
      icon: DoorOpen,
      label: 'A BÁR',
      value: status?.open ? 'MOST NYITVA' : 'MOST ZÁRVA',
      hint: status?.open
        ? `${status.since ? formatTime(status.since) + ' óta' : 'Gyere be'}${status.note ? ' · ' + status.note : ', szól a zene.'}`
        : 'Naplemente után nyitunk.',
      hot: !!status?.open,
      to: '/location'
    },
    {
      icon: Radio,
      label: 'RED MOON CLUB',
      value: live ? `ÉLŐ · ${status?.dj || 'DJ'}` : 'NINCS ADÁS',
      hint: live ? `${status?.listenerCount ?? 0} hallgató a vonalban.` : 'Nézz vissza később.',
      hot: live,
      to: '/club'
    },
    {
      icon: CalendarClock,
      label: 'KÖVETKEZŐ ESTE',
      value: nextEvent ? nextEvent.title : 'HAMAROSAN',
      hint: nextEvent
        ? `${formatWeekday(nextEvent.startsAt)} · ${formatTime(nextEvent.startsAt)}${nextEvent.tag ? ' · ' + nextEvent.tag : ''}`
        : 'Az új rendezvény itt jelenik meg.',
      hot: false,
      to: '/events'
    }
  ];

  return (
    <section className="border-b border-[color:var(--rm-line)] bg-[#070709]">
      <div className="grid grid-cols-1 md:grid-cols-3">
        {cells.map((cell) => (
          <Link
            key={cell.label}
            to={cell.to}
            className="group flex items-center gap-4 border-b border-[color:var(--rm-line)] px-[var(--rm-gutter)] py-7 transition-colors last:border-b-0 hover:bg-[rgba(213,31,60,0.05)] md:border-b-0 md:border-r md:px-8 md:last:border-r-0"
          >
            <cell.icon
              size={17}
              className={cell.hot ? 'text-[color:var(--rm-red)]' : 'text-[#6d5d64]'}
            />
            <div className="min-w-0">
              <span className="block text-[8px] tracking-[0.25em] text-[#777]">{cell.label}</span>
              <strong
                className={`mt-1 block truncate font-heading text-[17px] leading-none ${
                  cell.hot ? 'text-white' : 'text-[#c9c0c4]'
                }`}
              >
                {cell.value}
              </strong>
              <span className="mt-1.5 block truncate text-[10px] text-[#8d8584]">{cell.hint}</span>
            </div>
            {cell.hot && (
              <span className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[color:var(--rm-red)]"/>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
};
