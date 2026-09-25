import React, {useCallback, useEffect, useRef, useState} from 'react';
import {KeyRound, LogOut} from 'lucide-react';
import {useSearchParams} from 'react-router-dom';
import {Btn, BtnLink} from '../ui/Btn';
import {CardActions, CardScene, type CardCue, type CardSceneHandle} from './CardStage';
import {apiSend} from '../../lib/api';
import {tierMeta, type Tier, type TierStep} from '../../lib/houseCard';
import {playSfx} from '../../lib/sfx';

const STORAGE_KEY = 'rm-house-card';
const PHONE_PREFIX = '+38-76-';

export interface HouseCard {
  code: string;
  name: string;
  tier: Tier;
  visits: number;
  lastVisitAt: string | null;
  grantedAt: string;
  tierHistory?: TierStep[];
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

/**
 * "Are you a member?" — a code and the phone on file open the card itself:
 * the drawing the house issued, front and back, to keep as a picture. A
 * booking link carries the code on.
 */
export const HouseLookup: React.FC = () => {
  const [params] = useSearchParams();
  const urlCode = (params.get('code') || '').trim().toUpperCase();
  const stored = useRef(storedHouseCard());
  const [code, setCode] = useState(urlCode || stored.current?.code || '');
  const [phone, setPhone] = useState(PHONE_PREFIX + (stored.current?.phone || ''));
  const [card, setCard] = useState<HouseCard | null>(null);
  const [cue, setCue] = useState<CardCue | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const handle = useRef<CardSceneHandle>(null);

  const digits = phone.startsWith(PHONE_PREFIX) ? phone.slice(PHONE_PREFIX.length).replace(/\D/g, '').slice(0, 7) : '';

  const lookup = useCallback(async (codeValue: string, phoneDigits: string, quiet: boolean) => {
    const clean = codeValue.trim().toUpperCase();
    if (!clean) return;
    setBusy(true);
    setError('');
    try {
      const reply = await apiSend<{member: HouseCard}>('/api/public/member-lookup', 'POST', {code: clean, phone: phoneDigits});
      setCard(reply.member);
      setCue({play: 'issue', key: Date.now()});
      localStorage.setItem(STORAGE_KEY, JSON.stringify({code: clean, phone: phoneDigits}));
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

  /* A card opened before opens again by itself — unless the link names another code. */
  useEffect(() => {
    const remembered = stored.current;
    if (remembered?.code && (!urlCode || urlCode === remembered.code)) lookup(remembered.code, remembered.phone, true);
  }, [lookup, urlCode]);

  const forget = () => {
    localStorage.removeItem(STORAGE_KEY);
    setCard(null);
    setCue(null);
    setCode('');
    setPhone(PHONE_PREFIX);
    playSfx('ui_click');
  };

  if (card) {
    const meta = tierMeta(card.tier);
    return (
      <div className="rm-mcpublic" style={{'--mc-ink': meta.ink, '--mc-glow': meta.glow} as React.CSSProperties}>
        <CardScene member={card} cue={cue} handle={handle}/>
        <p className="rm-mcpublic-hint">KOPPINTS A KÁRTYÁRA A HÁTLAPÉRT · A KÉPET LETÖLTHETED ÉS ELMENTHETED</p>
        <CardActions member={card} handle={handle}/>
        <div className="rm-mcpublic-foot">
          <BtnLink to={`/reservations?member=${encodeURIComponent(card.code)}`} variant="red">
            FOGLALÁS A KÓDDAL ↗
          </BtnLink>
          <button type="button" onClick={forget} className="inline-flex items-center gap-2 text-[8px] tracking-[0.25em] text-[#777] hover:text-white">
            <LogOut size={11}/> KILÉPÉS
          </button>
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
      <p className="mt-2 text-[11px] leading-[1.8] text-[#8d8584]">A kódot a bejáratnál kaptad. A telefonszám az, amit a háznak megadtál — a kettő együtt nyitja a kártyát, amit képként el is menthetsz.</p>
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
