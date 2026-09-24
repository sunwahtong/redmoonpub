import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Check, KeyRound, LogOut} from 'lucide-react';
import {Btn, BtnLink} from '../ui/Btn';
import {apiSend, formatDate} from '../../lib/api';
import {MEMBERSHIP} from '../../lib/content';
import {playSfx} from '../../lib/sfx';

const STORAGE_KEY = 'rm-house-card';
const PHONE_PREFIX = '+38-76-';

export interface HouseCard {
  code: string;
  name: string;
  tier: 'silver' | 'gold' | 'black' | 'royal';
  visits: number;
  lastVisitAt: string | null;
  grantedAt: string;
}

/** The code and phone the browser last opened a card with, so it opens by itself next time. */
export function storedHouseCard(): {code: string; phone: string} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {code?: string; phone?: string};
    return parsed.code ? {code: parsed.code, phone: parsed.phone || ''} : null;
  } catch {
    return null;
  }
}

const TIER_GLYPH = {silver: '銀', gold: '金', black: '黑', royal: '王'} as const;

/**
 * "Are you a member?" — a code and the phone on file open the card: tier,
 * visits, what the tier gives, and a booking link that carries the code.
 */
export const HouseLookup: React.FC = () => {
  const stored = useRef(storedHouseCard());
  const [code, setCode] = useState(stored.current?.code || '');
  const [phone, setPhone] = useState(PHONE_PREFIX + (stored.current?.phone || ''));
  const [card, setCard] = useState<HouseCard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const digits = phone.startsWith(PHONE_PREFIX) ? phone.slice(PHONE_PREFIX.length).replace(/\D/g, '').slice(0, 7) : '';

  const lookup = useCallback(async (codeValue: string, phoneDigits: string, quiet: boolean) => {
    const clean = codeValue.trim().toUpperCase();
    if (!clean) return;
    setBusy(true);
    setError('');
    try {
      const reply = await apiSend<{member: HouseCard}>('/api/public/member-lookup', 'POST', {code: clean, phone: phoneDigits});
      setCard(reply.member);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({code: clean, phone: phoneDigits}));
      if (!quiet) playSfx('success');
    } catch (err) {
      const status = (err as {status?: number}).status;
      if (status === 404 || status === 403) localStorage.removeItem(STORAGE_KEY);
      if (!quiet) {
        setError((err as Error).message);
        playSfx('error');
      }
    } finally {
      setBusy(false);
    }
  }, []);

  /* A card opened before opens again by itself. */
  useEffect(() => {
    const remembered = stored.current;
    if (remembered?.code) lookup(remembered.code, remembered.phone, true);
  }, [lookup]);

  const forget = () => {
    localStorage.removeItem(STORAGE_KEY);
    setCard(null);
    setCode('');
    setPhone(PHONE_PREFIX);
    playSfx('ui_click');
  };

  if (card) {
    const tier = MEMBERSHIP.find((entry) => entry.id === card.tier) || MEMBERSHIP[0];
    return (
      <div className="rm-house-card" data-tier={card.tier}>
        <span className="rm-house-card-glyph" aria-hidden="true">
          {TIER_GLYPH[card.tier]}
        </span>
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="rm-label">RED MOON · THE HOUSE</span>
            <span className="rm-tier-crest">{tier.name}</span>
          </div>
          <strong className="mt-6 block font-heading text-[30px] leading-none text-white">{card.name}</strong>
          <span className="rm-house-card-code mt-3 block">{card.code}</span>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1.5 text-[9px] tracking-[0.2em] text-[#8d8584]">
            <span>
              <b className="text-white">{card.visits}</b> LÁTOGATÁS
            </span>
            {card.lastVisitAt && <span>UTOLJÁRA {formatDate(card.lastVisitAt).toUpperCase()}</span>}
            <span>TAG {formatDate(card.grantedAt).toUpperCase()} ÓTA</span>
          </div>
          <div className="rm-gilt my-6"/>
          <ul className="flex flex-col gap-2">
            {tier.perks.map((perk) => (
              <li key={perk} className="flex gap-2.5 text-[10px] leading-[1.7] text-[#c9c2c1]">
                <Check size={12} className="mt-[2px] shrink-0 text-[color:var(--rm-red)]"/>
                {perk}
              </li>
            ))}
          </ul>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <BtnLink to={`/reservations?member=${encodeURIComponent(card.code)}`} variant="red">
              FOGLALÁS A KÓDDAL ↗
            </BtnLink>
            <button type="button" onClick={forget} className="inline-flex items-center gap-2 text-[8px] tracking-[0.25em] text-[#777] hover:text-white">
              <LogOut size={11}/> KILÉPÉS
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        lookup(code, digits, false);
      }}
      className="rm-card p-8"
    >
      <span className="rm-label">A KÁRTYÁD</span>
      <h3 className="mt-3 font-heading text-[24px] text-white">Tag vagy? Mutasd a kódod.</h3>
      <p className="mt-2 text-[11px] leading-[1.8] text-[#8d8584]">A kódot a bejáratnál kaptad. A telefonszám az, amit a háznak megadtál — a kettő együtt nyitja a kártyát.</p>
      <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-[8px] tracking-[0.25em] text-[#777]">TAGSÁGI KÓD</span>
          <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 12))} placeholder="RM-H-XXXX" autoCapitalize="characters" spellCheck={false} className="rm-input font-heading tracking-[0.2em]"/>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[8px] tracking-[0.25em] text-[#777]">TELEFONSZÁM</span>
          <input
            value={phone}
            onChange={(event) => {
              const value = event.target.value;
              const next = value.startsWith(PHONE_PREFIX) ? value.slice(PHONE_PREFIX.length).replace(/\D/g, '').slice(0, 7) : '';
              setPhone(PHONE_PREFIX + next);
            }}
            inputMode="numeric"
            className="rm-input"
          />
        </label>
      </div>
      {error && <p className="mt-4 text-[11px] text-[color:var(--rm-red)]">{error}</p>}
      <div className="mt-6">
        <Btn type="submit" variant="red" disabled={busy || code.trim().length < 4}>
          <KeyRound size={12}/> {busy ? 'NÉZZÜK…' : 'MUTASD A KÁRTYÁM'}
        </Btn>
      </div>
    </form>
  );
};
