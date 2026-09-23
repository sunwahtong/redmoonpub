import React from 'react';
import {Link} from 'react-router-dom';
import {CalendarDays, GlassWater, MapPin} from 'lucide-react';
import {useHouseStatus} from '../../hooks/useHouseStatus';
import {useLiveData} from '../../hooks/useLiveData';
import {useCountdown} from '../../hooks/useCountdown';
import {assetUrl, formatTime, formatWeekday} from '../../lib/api';
import type {SignatureDrink} from '../../types';

/**
 * The evening around the show: the door, the next event with its countdown,
 * the signature drinks, and the way to a table. So the club page is a way
 * into the house, not just a chat window.
 */
export const TonightCard: React.FC = () => {
  const {data: house} = useHouseStatus();
  const {data: drinks} = useLiveData<{drinks: SignatureDrink[]}>('/api/public-signature-drinks', {intervalMs: 0, topics: ['content']});
  const event = house?.nextEvent || null;
  const countdown = useCountdown(event?.startsAt || null);
  const list = (drinks?.drinks || []).slice(0, 3);

  return (
    <div className="rm-tonight">
      <div className="rm-tonight-main">
        <span className="rm-label flex items-center gap-2">
          <CalendarDays size={11}/> MA ESTE A HÁZBAN
        </span>
        {event ? (
          <>
            <h3 className="mt-3 font-heading text-[22px] leading-tight text-white">{event.title}</h3>
            <p className="mt-2 text-[11px] leading-[1.8] text-[#a09998]">
              {formatWeekday(event.startsAt)} {formatTime(event.startsAt)}
              {event.place ? ` · ${event.place}` : ''}
              {event.tag ? ` · ${event.tag}` : ''}
            </p>
            <div className="mt-4 flex items-end gap-4">
              {countdown.elapsed ? (
                <span className="font-heading text-[26px] leading-none text-[color:var(--rm-red-bright)]">MOST</span>
              ) : (
                <>
                  {countdown.d !== '00' && (
                    <span>
                      <b className="block font-heading text-[26px] leading-none text-white">{Number(countdown.d)}</b>
                      <i className="text-[7px] not-italic tracking-[0.25em] text-[#777]">NAP</i>
                    </span>
                  )}
                  {(['h', 'm', 's'] as const).map((unit) => (
                    <span key={unit}>
                      <b className="block font-heading text-[26px] leading-none text-white">{countdown[unit]}</b>
                      <i className="text-[7px] not-italic tracking-[0.25em] text-[#777]">{unit === 'h' ? 'ÓRA' : unit === 'm' ? 'PERC' : 'MP'}</i>
                    </span>
                  ))}
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <h3 className="mt-3 font-heading text-[22px] leading-tight text-white">{house?.open ? 'Nyitva vagyunk.' : 'A következő este készül.'}</h3>
            <p className="mt-2 text-[11px] leading-[1.8] text-[#a09998]">{house?.open ? 'Gyere be, a pult mögött vagyunk.' : 'Amint kiírjuk a következő eseményt, itt számol vissza.'}</p>
          </>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <Link to="/reservations" className="rm-btn is-red !px-4 !py-2.5 !text-[8px]">
            ASZTALFOGLALÁS
          </Link>
          <Link to="/events" className="rm-btn !px-4 !py-2.5 !text-[8px]">
            RENDEZVÉNYEK
          </Link>
          <Link to="/location" className="rm-btn is-ghost !px-4 !py-2.5 !text-[8px]">
            <MapPin size={10}/> ÚTVONAL
          </Link>
        </div>
      </div>

      <div className="rm-tonight-side">
        <span className="rm-label flex items-center gap-2">
          <GlassWater size={11}/> A HÁZ ITALAI
        </span>
        <div className="mt-3 flex flex-col gap-2">
          {!list.length && <p className="text-[10px] text-[#8d8584]">Az itallap a pultban.</p>}
          {list.map((drink) => (
            <Link key={drink.id} to="/menu" className="rm-drink-mini">
              {drink.image ? <img src={assetUrl(drink.image)} alt="" loading="lazy"/> : <span className="rm-drink-mini-blank" aria-hidden="true"/>}
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[11px] text-white">{drink.name}</b>
                <i className="block truncate text-[9px] not-italic text-[#8d8584]">{drink.description}</i>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};
