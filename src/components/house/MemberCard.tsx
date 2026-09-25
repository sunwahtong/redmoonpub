import React, {useId} from 'react';
import {CARD_H, CARD_W, currentSince, ladderOf, monthYear, seeded, shortDay, tierMeta, type CardMember, type TierMeta} from '../../lib/houseCard';

const CINZEL = 'Cinzel, serif';
const NOTO = "'Noto Sans', sans-serif";
const RADIUS = 28;

interface Props {
  member: CardMember;
  face?: 'front' | 'back';
  /** 'lite' skips the engraving and the second glow: for thumbnails and the shards of a removal. */
  detail?: 'full' | 'lite';
  /** Draws the suspended stamp into the SVG itself; off while the stage animates its own copy. */
  stamp?: boolean;
  className?: string;
}

interface FaceProps {
  member: CardMember;
  meta: TierMeta;
  url: (name: string) => string;
}

/** The engraving under the name: a rosette only this code draws. */
const Engraving: React.FC<{code: string; ink: string}> = ({code, ink}) => {
  const random = seeded(code);
  const count = 14;
  const rings = Array.from({length: count}, (_, i) => ({rx: 140 + random() * 70, ry: 30 + random() * 46, angle: (i * 180) / count + random() * 10}));
  return (
    <g transform="translate(790 470)" fill="none" stroke={ink} strokeOpacity="0.085" strokeWidth="1">
      {rings.map((ring, i) => (
        <ellipse key={i} rx={ring.rx.toFixed(1)} ry={ring.ry.toFixed(1)} transform={`rotate(${ring.angle.toFixed(1)})`}/>
      ))}
    </g>
  );
};

/** The red mark across a suspended card. The stage animates this same mark. */
export const StampMark: React.FC = () => (
  <g transform="translate(500 330) rotate(-12)" opacity="0.94">
    <rect x="-250" y="-54" width="500" height="108" rx="8" fill="#20040a" fillOpacity="0.55" stroke="#ff2b4f" strokeWidth="5"/>
    <rect x="-238" y="-42" width="476" height="84" rx="5" fill="none" stroke="#ff2b4f" strokeWidth="1.5" strokeOpacity="0.7"/>
    <text y="13" textAnchor="middle" fontFamily={CINZEL} fontSize="34" fontWeight="800" letterSpacing="0.3em" fill="#ff2b4f">
      FELFÜGGESZTVE
    </text>
  </g>
);

const Front: React.FC<FaceProps> = ({member, meta, url}) => {
  const name = member.name.trim().toUpperCase();
  const nameSize = name.length > 34 ? 24 : name.length > 26 ? 30 : name.length > 18 ? 40 : 52;
  const visits = Number(member.visits) || 0;
  return (
    <g>
      <text x="60" y="92" fontFamily={CINZEL} fontSize="34" fontWeight="800" letterSpacing="0.3em" fill="#ffffff">
        RED MOON
      </text>
      <text x="60" y="122" fontFamily={CINZEL} fontSize="12" fontWeight="600" letterSpacing="0.42em" fill={meta.ink} fillOpacity="0.85">
        THE HOUSE · MEMBERSHIP
      </text>
      <text x="940" y="92" textAnchor="end" fontFamily={CINZEL} fontSize="30" fontWeight="700" letterSpacing="0.4em" fill={url('foil')}>
        {meta.name}
      </text>
      <text x="940" y="122" textAnchor="end" fontFamily={CINZEL} fontSize="12" fontWeight="600" letterSpacing="0.34em" fill={meta.ink} fillOpacity="0.7">
        SZINT {meta.no} / 04 · {monthYear(currentSince(member))} ÓTA
      </text>

      <g transform="translate(108 290)">
        <circle r="46" fill={meta.base[1]} fillOpacity="0.85" stroke={url('foil')} strokeWidth="2"/>
        <circle r="56" fill="none" stroke={meta.ink} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 5"/>
        <text y="15" textAnchor="middle" fontFamily={CINZEL} fontSize="42" fontWeight="700" fill={url('foil')}>
          月
        </text>
      </g>
      <text x="190" y="278" fontFamily={CINZEL} fontSize="11" fontWeight="600" letterSpacing="0.34em" fill={meta.ink} fillOpacity="0.75">
        SEECITY · A HÁZ BELSŐ KÖRE
      </text>
      <text x="190" y="306" fontFamily={NOTO} fontSize="15" fontWeight="500" fill="#d3cbc9">
        {meta.tagline}
      </text>

      <text x="60" y="452" fontFamily={CINZEL} fontSize={nameSize} fontWeight="700" letterSpacing="0.06em" fill="#ffffff">
        {name}
      </text>
      <text x="60" y="504" fontFamily={CINZEL} fontSize="28" fontWeight="700" letterSpacing="0.36em" fill={url('foil')} className="rm-mc-code">
        {member.code.split('').map((char, i) => (
          <tspan key={i} className="rm-mc-ch" style={{'--i': i} as React.CSSProperties}>
            {char}
          </tspan>
        ))}
      </text>
      <rect x="60" y="532" width="560" height="1.5" fill={url('foilX')}/>
      <text x="60" y="572" fontFamily={CINZEL} fontSize="11" fontWeight="600" letterSpacing="0.3em" fill="#b3aba9">
        TAG {monthYear(member.grantedAt)} ÓTA · {visits} LÁTOGATÁS
      </text>
      <text x="940" y="572" textAnchor="end" fontFamily={CINZEL} fontSize="11" fontWeight="600" letterSpacing="0.3em" fill={meta.ink} fillOpacity="0.6">
        RED MOON PUB · SEECITY
      </text>
    </g>
  );
};

const Back: React.FC<FaceProps> = ({member, meta, url}) => {
  const ladder = ladderOf(member);
  return (
    <g>
      <text x="60" y="80" fontFamily={CINZEL} fontSize="22" fontWeight="800" letterSpacing="0.3em" fill="#ffffff">
        RED MOON
      </text>
      <text x="60" y="104" fontFamily={CINZEL} fontSize="11" fontWeight="600" letterSpacing="0.42em" fill={meta.ink} fillOpacity="0.85">
        THE HOUSE · {meta.name}
      </text>
      <text x="940" y="80" textAnchor="end" fontFamily={CINZEL} fontSize="22" fontWeight="700" letterSpacing="0.34em" fill={url('foil')}>
        {member.code}
      </text>

      <rect x="0" y="130" width={CARD_W} height="58" fill="#000000" fillOpacity="0.55"/>
      <rect x="0" y="130" width={CARD_W} height="1" fill={url('foilX')}/>
      <rect x="0" y="187" width={CARD_W} height="1" fill={url('foilX')}/>
      <text x="60" y="164" fontFamily={CINZEL} fontSize="13" fontWeight="600" letterSpacing="0.4em" fill={meta.ink}>
        AMIT A {meta.name} SZINT AD
      </text>
      <text x="940" y="164" textAnchor="end" fontFamily={CINZEL} fontSize="10" fontWeight="600" letterSpacing="0.3em" fill="#8d8584">
        {meta.tagline.toUpperCase()}
      </text>

      {meta.perks.map((perk, i) => (
        <g key={perk} transform={`translate(60 ${232 + i * 40})`}>
          <path d="M0 -6 L6 0 L0 6 L-6 0 Z" fill={url('foil')}/>
          <text x="22" y="5" fontFamily={NOTO} fontSize="16" fontWeight="500" fill="#ded7d5">
            {perk}
          </text>
        </g>
      ))}

      <g transform="translate(640 214)">
        <text y="0" fontFamily={CINZEL} fontSize="11" fontWeight="600" letterSpacing="0.36em" fill={meta.ink} fillOpacity="0.8">
          A LÉPCSŐ
        </text>
        {ladder.map((step, i) => {
          const stepMeta = tierMeta(step.tier);
          return (
            <g key={step.tier} transform={`translate(0 ${38 + i * 46})`} opacity={step.at ? 1 : 0.38}>
              {step.current && <rect x="-14" y="-25" width="314" height="40" rx="6" fill={meta.ink} fillOpacity="0.08" stroke={url('foil')} strokeOpacity="0.7"/>}
              <text x="0" y="0" fontFamily={CINZEL} fontSize="20" fontWeight="700" fill={step.at ? url('foil') : '#777170'}>
                {stepMeta.glyph}
              </text>
              <text x="36" y="-1" fontFamily={CINZEL} fontSize="13" fontWeight="700" letterSpacing="0.3em" fill={step.at ? '#ffffff' : '#8d8584'}>
                {stepMeta.name}
              </text>
              <text x="286" y="-1" textAnchor="end" fontFamily={NOTO} fontSize="12" fontWeight="500" fill={step.at ? meta.ink : '#6f6968'}>
                {step.at ? shortDay(step.at) : '—'}
              </text>
            </g>
          );
        })}
      </g>

      <rect x="60" y="486" width="880" height="1" fill={url('foilX')}/>
      <text x="60" y="518" fontFamily={NOTO} fontSize="12" fill="#9a9290">
        A kártya a Red Moon Pub tulajdona. A kód és a hozzá tartozó telefonszám együtt azonosít:
      </text>
      <text x="60" y="538" fontFamily={NOTO} fontSize="12" fill="#9a9290">
        foglaláskor a kóddal a szinted érkezik, a bejáratnál a ház a látogatást feljegyzi.
      </text>
      {member.grantedByName && (
        <text x="60" y="578" fontFamily={CINZEL} fontSize="10" fontWeight="600" letterSpacing="0.3em" fill="#777170">
          KIADTA · {member.grantedByName.toUpperCase()}
        </text>
      )}
      <text x="940" y="578" textAnchor="end" fontFamily={CINZEL} fontSize="10" fontWeight="600" letterSpacing="0.3em" fill={meta.ink} fillOpacity="0.7">
        SEECITY · RED MOON PUB
      </text>
    </g>
  );
};

/**
 * A member's House card, as a drawing.
 *
 * Everything here is still: colours and type are attributes on the SVG, so
 * a copy of this markup rasterises into the PNG exactly as it looks on the
 * page. Whatever moves (the sheen, the code appearing letter by letter) is
 * CSS on classes and never leaves the page.
 */
export const MemberCard: React.FC<Props> = ({member, face = 'front', detail = 'full', stamp = true, className = ''}) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (name: string) => `mc${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const meta = tierMeta(member.tier);
  const full = detail === 'full';
  const suspended = stamp && member.active === false;

  return (
    <svg
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      xmlns="http://www.w3.org/2000/svg"
      className={`rm-mc ${className}`}
      data-tier={member.tier}
      data-face={face}
      role="img"
      aria-label={`${member.name} · House ${meta.name} · ${member.code}${face === 'back' ? ' · hátlap' : ''}`}
    >
      <defs>
        <linearGradient id={id('body')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={meta.base[0]}/>
          <stop offset="1" stopColor={meta.base[1]}/>
        </linearGradient>
        <linearGradient id={id('foil')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={meta.foil[0]}/>
          <stop offset="0.48" stopColor={meta.foil[1]}/>
          <stop offset="1" stopColor={meta.foil[2]}/>
        </linearGradient>
        <linearGradient id={id('foilX')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={meta.foil[2]} stopOpacity="0"/>
          <stop offset="0.5" stopColor={meta.foil[0]}/>
          <stop offset="1" stopColor={meta.foil[2]} stopOpacity="0"/>
        </linearGradient>
        <radialGradient id={id('glow')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={meta.glow}/>
          <stop offset="1" stopColor={meta.glow} stopOpacity="0"/>
        </radialGradient>
        <linearGradient id={id('sheen')} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0"/>
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.26"/>
          <stop offset="1" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
        <pattern id={id('brush')} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
          <rect width="6" height="1" fill="#ffffff" fillOpacity="0.035"/>
        </pattern>
        <clipPath id={id('clip')}>
          <rect width={CARD_W} height={CARD_H} rx={RADIUS}/>
        </clipPath>
      </defs>

      <g clipPath={url('clip')}>
        <rect width={CARD_W} height={CARD_H} fill={url('body')}/>
        <rect width={CARD_W} height={CARD_H} fill={url('brush')}/>
        <circle cx="880" cy="60" r="360" fill={url('glow')}/>
        {full && <circle cx="120" cy="640" r="260" fill={url('glow')} opacity="0.45"/>}
        <text x="835" y="520" textAnchor="middle" fontFamily={CINZEL} fontSize="400" fontWeight="700" fill={meta.ink} fillOpacity="0.07">
          {meta.glyph}
        </text>
        {full && <Engraving code={member.code} ink={meta.ink}/>}
        <rect data-export="skip" className="rm-mc-sheen" x="-420" y="-40" width="300" height={CARD_H + 80} fill={url('sheen')} transform="skewX(-16)"/>
        {face === 'front' ? <Front member={member} meta={meta} url={url}/> : <Back member={member} meta={meta} url={url}/>}
        {suspended && <rect width={CARD_W} height={CARD_H} fill="#000000" fillOpacity="0.35"/>}
      </g>

      <rect x="14" y="14" width={CARD_W - 28} height={CARD_H - 28} rx="22" fill="none" stroke={url('foil')} strokeOpacity="0.75" strokeWidth="1.5"/>
      <rect x="26" y="26" width={CARD_W - 52} height={CARD_H - 52} rx="17" fill="none" stroke={meta.ink} strokeOpacity="0.16" strokeWidth="1"/>
      {suspended && <StampMark/>}
    </svg>
  );
};
