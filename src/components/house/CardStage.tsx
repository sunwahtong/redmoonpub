import React, {useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Copy, Download, RefreshCw, Share2, X} from 'lucide-react';
import {Btn} from '../ui/Btn';
import {Embers} from '../effects/Embers';
import {MemberCard, StampMark} from './MemberCard';
import {CARD_H, CARD_W, RANK, cardFileName, tierMeta, type CardMember, type Tier} from '../../lib/houseCard';
import {canShareFiles, cardToPng, downloadBlob, shareBlob} from '../../lib/cardImage';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';

export type CardPlay = 'issue' | 'upgrade' | 'downgrade' | 'suspend' | 'restore' | 'remove';

/** What the stage should act out; `key` lets the same play run twice in a row. */
export interface CardCue {
  play: CardPlay;
  fromTier?: Tier;
  key?: number;
}

export interface CardSceneHandle {
  flip(): void;
  isFlipped(): boolean;
  /** The SVG of the face showing now, for the PNG. */
  svg(): SVGSVGElement | null;
}

type SparkMode = 'rise' | 'burst' | 'fall' | null;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  r: number;
  life: number;
  max: number;
  hot: boolean;
}

/**
 * How long each play holds the stage, by the tier it ends on: a Gold card
 * gets a burst, a Black one an eclipse, a Royal one a coronation.
 */
const RISE_MS: Record<number, number> = {1: 3000, 2: 3000, 3: 3900, 4: 5200};
const ISSUE_MS: Record<number, number> = {1: 2800, 2: 2900, 3: 3400, 4: 4300};
const RISE_LABEL: Record<number, string> = {2: 'SZINTLÉPÉS', 3: 'A BELSŐ KÖR', 4: 'KORONÁZÁS'};

const spawn = (mode: Exclude<SparkMode, null>, w: number, h: number): Spark => {
  const hot = Math.random() < 0.25;
  if (mode === 'burst') {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    const max = 50 + Math.random() * 60;
    return {x: w / 2, y: h / 2, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1, g: 0.07, r: 1 + Math.random() * 2.2, life: max, max, hot};
  }
  if (mode === 'fall') {
    const max = 80 + Math.random() * 80;
    return {x: Math.random() * w, y: h * (0.05 + Math.random() * 0.3), vx: (Math.random() - 0.5) * 0.6, vy: 0.3 + Math.random(), g: 0.03, r: 0.8 + Math.random() * 1.6, life: max, max, hot};
  }
  const max = 90 + Math.random() * 90;
  return {x: Math.random() * w, y: h * (0.55 + Math.random() * 0.45), vx: (Math.random() - 0.5) * 0.5, vy: -(0.4 + Math.random() * 1.1), g: -0.004, r: 0.8 + Math.random() * 1.5, life: max, max, hot};
};

/** One canvas of particles for a moment: embers rising, a burst, or dust falling. */
const Sparks: React.FC<{mode: SparkMode; color: string; count: number}> = ({mode, color, count}) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!mode || !canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    context.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;
    const parts = Array.from({length: mode === 'burst' ? count : Math.round(count * 0.5)}, () => spawn(mode, w, h));
    const started = performance.now();
    const span = 2400;
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - started;
      context.clearRect(0, 0, w, h);
      for (const part of parts) {
        if (part.life <= 0) {
          if (mode === 'burst' || elapsed > span - 900) continue;
          Object.assign(part, spawn(mode, w, h));
        }
        part.x += part.vx;
        part.y += part.vy;
        part.vy += part.g;
        part.vx *= 0.99;
        part.life -= 1;
        const fade = Math.max(0, Math.min(1, part.life / 30, (part.max - part.life) / 12 + 0.2));
        context.globalAlpha = fade * (elapsed > span - 500 ? (span - elapsed) / 500 : 1);
        context.fillStyle = part.hot ? '#ffffff' : color;
        context.beginPath();
        context.arc(part.x, part.y, part.r, 0, Math.PI * 2);
        context.fill();
      }
      if (elapsed < span) frame = requestAnimationFrame(tick);
      else context.clearRect(0, 0, w, h);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      context.clearRect(0, 0, w, h);
    };
  }, [mode, color, count]);

  return <canvas ref={ref} className="rm-mcs-sparks" aria-hidden="true"/>;
};

interface SceneProps {
  member: CardMember;
  cue?: CardCue | null;
  onDone?: (play: CardPlay) => void;
  handle?: React.Ref<CardSceneHandle>;
  className?: string;
}

/**
 * The card in three dimensions: it turns toward the pointer, flips on a tap,
 * and acts out what just happened to it — issued, raised or lowered a tier,
 * suspended, restored, torn up. A rise grows with the tier reached: Gold
 * spreads with a burst, Black is an eclipse passing over the card, Royal a
 * coronation. While a play runs the faces show the member as they were, and
 * switch to what they are now at the right beat.
 */
export const CardScene: React.FC<SceneProps> = ({member, cue, onDone, handle, className = ''}) => {
  const root = useRef<HTMLDivElement>(null);
  const memberRef = useRef(member);
  const doneRef = useRef(onDone);
  memberRef.current = member;
  doneRef.current = onDone;

  const [flipped, setFlipped] = useState(false);
  const [phase, setPhase] = useState<CardPlay | null>(null);
  const [shown, setShown] = useState<CardMember>(member);
  const [morph, setMorph] = useState<CardMember | null>(null);
  const [dim, setDim] = useState(member.active === false);
  const [sparks, setSparks] = useState<SparkMode>(null);

  /* Idle: the card shows the member as they are now. */
  useEffect(() => {
    if (phase) return;
    setShown(member);
    setDim(member.active === false);
  }, [member, phase]);

  const cueId = cue ? `${cue.play}:${cue.fromTier || ''}:${cue.key ?? 0}` : '';
  useEffect(() => {
    if (!cue) return;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const current = memberRef.current;
    const level = RANK[current.tier];
    const end = (ms: number) =>
      at(ms, () => {
        setPhase(null);
        setMorph(null);
        setSparks(null);
        doneRef.current?.(cue.play);
      });
    const commit = () => {
      setShown(current);
      setMorph(null);
    };
    setFlipped(false);
    setPhase(cue.play);
    switch (cue.play) {
      case 'issue':
        setShown(current);
        setDim(false);
        setSparks('rise');
        at(400, () => playSfx('success'));
        if (level >= 2) at(1900, () => setSparks('burst'));
        if (level >= 4) {
          at(2300, () => playSfx('live_start'));
          at(2700, () => setSparks('rise'));
        }
        end(ISSUE_MS[level] || 2800);
        break;
      case 'upgrade':
        setShown({...current, tier: cue.fromTier || current.tier});
        setMorph(current);
        if (level >= 4) {
          at(600, () => playSfx('open'));
          at(1000, () => {
            setSparks('burst');
            playSfx('success');
          });
          at(2000, () => playSfx('live_start'));
          at(2500, () => setSparks('rise'));
          at(2700, commit);
        } else if (level === 3) {
          at(300, () => playSfx('open'));
          at(1900, () => {
            setSparks('burst');
            playSfx('success');
          });
          at(2300, commit);
        } else {
          at(500, () => {
            setSparks('burst');
            playSfx('success');
          });
          at(1900, commit);
        }
        end(RISE_MS[level] || 3000);
        break;
      case 'downgrade':
        setShown({...current, tier: cue.fromTier || current.tier});
        setMorph(current);
        at(500, () => {
          setSparks('fall');
          playSfx('decline');
        });
        at(1900, commit);
        end(3000);
        break;
      case 'suspend':
        setShown({...current, active: true});
        setDim(false);
        at(750, () => {
          setDim(true);
          playSfx('delete');
        });
        end(1900);
        break;
      case 'restore':
        setShown({...current, active: false});
        setDim(true);
        at(200, () => {
          setDim(false);
          setSparks('rise');
          playSfx('success');
        });
        end(1500);
        break;
      case 'remove':
        setShown(current);
        at(250, () => {
          setSparks('fall');
          playSfx('delete');
        });
        end(1900);
        break;
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // The cue's identity starts a play; the member is read through the ref so a roster refresh does not restart it.
  }, [cueId]);

  const busy = phase !== null;
  const flip = useCallback(() => {
    if (busy) return;
    setFlipped((value) => !value);
    playSfx('ui_click');
  }, [busy]);

  useImperativeHandle(
    handle,
    () => ({
      flip,
      isFlipped: () => flipped,
      svg: () => root.current?.querySelector<SVGSVGElement>(flipped ? '.rm-mcs-face.is-back svg' : '.rm-mcs-face.is-front svg') || null
    }),
    [flip, flipped]
  );

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = root.current;
    if (!node || busy || event.pointerType === 'touch') return;
    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    node.style.setProperty('--ry', `${((px - 0.5) * 18).toFixed(2)}deg`);
    node.style.setProperty('--rx', `${((0.5 - py) * 14).toFixed(2)}deg`);
    node.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
    node.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    node.classList.add('is-live');
  };

  const onPointerLeave = () => {
    const node = root.current;
    if (!node) return;
    node.classList.remove('is-live');
    node.style.setProperty('--rx', '0deg');
    node.style.setProperty('--ry', '0deg');
  };

  const meta = tierMeta(shown.tier);
  const target = morph ? tierMeta(morph.tier) : meta;
  const level = RANK[morph ? morph.tier : shown.tier];
  const vars = {'--mc-ink': target.ink, '--mc-glow': target.glow} as React.CSSProperties;
  const svgStamp = phase !== 'suspend' && phase !== 'restore';
  const shards = phase === 'remove' ? Array.from({length: 9}, (_, i) => i) : [];
  const rings = phase === 'upgrade' ? (level >= 4 ? 3 : level === 3 ? 2 : 1) : phase === 'issue' ? (level >= 4 ? 3 : level === 3 ? 2 : level === 2 ? 1 : 0) : 0;
  const crown = level >= 4 && (phase === 'issue' || phase === 'upgrade');
  const eclipse = level === 3 && phase === 'upgrade';
  const classes = ['rm-mcs', `is-l${level}`, flipped ? 'is-flipped' : '', phase ? `is-${phase}` : '', dim ? 'is-dim' : '', className].filter(Boolean).join(' ');

  return (
    <div ref={root} className={classes} style={vars} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <div className="rm-mcs-halo" aria-hidden="true"/>
      <Sparks mode={sparks} color={target.ink} count={level >= 4 ? 230 : level === 3 ? 170 : 130}/>
      {morph && (phase === 'upgrade' || phase === 'downgrade') && (
        <div className="rm-mcs-banner" aria-live="polite">
          {phase === 'upgrade' ? RISE_LABEL[level] || 'SZINTLÉPÉS' : 'VISSZASOROLVA'} · <b>{target.name}</b>
        </div>
      )}
      {Array.from({length: rings}, (_, i) => (
        <div key={i} className="rm-mcs-ring" style={{'--i': i} as React.CSSProperties} aria-hidden="true"/>
      ))}
      {crown && (
        <div className="rm-mcs-crown" aria-hidden="true">
          <span>王</span>
        </div>
      )}
      {eclipse && <div className="rm-mcs-eclipse" aria-hidden="true"/>}

      <div className="rm-mcs-tilt">
        <div
          className="rm-mcs-body"
          role="button"
          tabIndex={0}
          aria-pressed={flipped}
          aria-label={flipped ? 'Előlap' : 'Hátlap'}
          onClick={flip}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              flip();
            }
          }}
        >
          <div className="rm-mcs-face is-front">
            <MemberCard member={shown} face="front" stamp={svgStamp}/>
            {morph && (
              <div className="rm-mcs-next">
                <MemberCard member={morph} face="front" stamp={false}/>
              </div>
            )}
            <div className="rm-mcs-glare" aria-hidden="true"/>
            {phase === 'issue' && <i className="rm-mcs-printline" aria-hidden="true"/>}
            {(phase === 'suspend' || phase === 'restore') && (
              <svg className={`rm-mcs-stamp ${phase === 'suspend' ? 'is-stamping' : 'is-lifting'}`} viewBox={`0 0 ${CARD_W} ${CARD_H}`} aria-hidden="true">
                <StampMark/>
              </svg>
            )}
            <div className="rm-mcs-flash" aria-hidden="true"/>
          </div>
          <div className="rm-mcs-face is-back">
            <MemberCard member={shown} face="back" stamp={svgStamp}/>
            {morph && (
              <div className="rm-mcs-next">
                <MemberCard member={morph} face="back" stamp={false}/>
              </div>
            )}
            <div className="rm-mcs-glare" aria-hidden="true"/>
          </div>
        </div>
      </div>

      {shards.length > 0 && (
        <div className="rm-mcs-shards" aria-hidden="true">
          {shards.map((i) => (
            <div key={i} className="rm-mcs-shard" style={{'--i': i, clipPath: `inset(0 ${(100 - ((i + 1) * 100) / 9).toFixed(3)}% 0 ${((i * 100) / 9).toFixed(3)}%)`} as React.CSSProperties}>
              <MemberCard member={shown} face="front" detail="lite" stamp={svgStamp}/>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** Save, share, turn — and, for the house, copy the code. */
export const CardActions: React.FC<{member: CardMember; handle: React.RefObject<CardSceneHandle | null>; withCopy?: boolean; className?: string; children?: React.ReactNode}> = ({member, handle, withCopy, className = '', children}) => {
  const [busy, setBusy] = useState<'png' | 'share' | null>(null);
  const [shareable] = useState(canShareFiles);

  const picture = async () => {
    const svg = handle.current?.svg();
    if (!svg) throw new Error('A kártya még nem látszik.');
    const face = handle.current?.isFlipped() ? 'back' : 'front';
    return {blob: await cardToPng(svg), name: cardFileName(member, face)};
  };

  const save = async () => {
    if (busy) return;
    setBusy('png');
    try {
      const {blob, name} = await picture();
      downloadBlob(blob, name);
      toast.success('A kártya képe letöltve.');
      playSfx('success');
    } catch (err) {
      toast.error('Nem sikerült a kép', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    if (busy) return;
    setBusy('share');
    try {
      const {blob, name} = await picture();
      const shared = await shareBlob(blob, name, `Red Moon · The House · ${member.code}`);
      if (!shared) downloadBlob(blob, name);
    } catch (err) {
      toast.error('Nem sikerült megosztani', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(member.code);
      toast.success('A kód a vágólapon.');
      playSfx('copy');
    } catch {
      toast.error('Nem sikerült másolni', member.code);
    }
  };

  return (
    <div className={`rm-mca ${className}`}>
      <Btn variant="red" onClick={save} disabled={busy !== null}>
        <Download size={12}/> {busy === 'png' ? 'KÉSZÜL…' : 'KÉP LETÖLTÉSE'}
      </Btn>
      {shareable && (
        <Btn onClick={share} disabled={busy !== null}>
          <Share2 size={12}/> MEGOSZTÁS
        </Btn>
      )}
      <Btn onClick={() => handle.current?.flip()}>
        <RefreshCw size={12}/> MEGFORDÍTOM
      </Btn>
      {withCopy && (
        <Btn onClick={copy} title="Kód másolása">
          <Copy size={12}/> {member.code}
        </Btn>
      )}
      {children}
    </div>
  );
};

/**
 * The console's stage: the card over a darkened room, with a line about
 * what just happened and the buttons to send it on.
 */
export const CardOverlay: React.FC<{member: CardMember; cue?: CardCue | null; onClose: () => void; onDone?: (play: CardPlay) => void}> = ({member, cue, onClose, onDone}) => {
  const handle = useRef<CardSceneHandle>(null);
  const meta = tierMeta(member.tier);
  const level = RANK[member.tier];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const first = member.name.trim().split(/\s+/)[0] || member.name;
  const head = (() => {
    switch (cue?.play) {
      case 'issue':
        return {kicker: `KIADVA · ${member.code}`, title: <>Üdv a House-ban, <em>{first}.</em></>};
      case 'upgrade':
        if (level >= 4) return {kicker: 'KORONÁZÁS', title: <>{first} mostantól <em>Royal.</em> A ház a tiéd.</>};
        if (level === 3) return {kicker: 'A BELSŐ KÖRBE LÉPETT', title: <>{first} a belső körben: <em>Black.</em></>};
        return {kicker: 'SZINTLÉPÉS', title: <>{first} mostantól <em>{meta.name}.</em></>};
      case 'downgrade':
        return {kicker: 'VISSZASOROLÁS', title: <>{first} kártyája <em>{meta.name}</em> lett.</>};
      case 'suspend':
        return {kicker: 'FELFÜGGESZTVE', title: <>{first} kártyája <em>pihen.</em></>};
      case 'restore':
        return {kicker: 'VISSZAÁLLÍTVA', title: <>{first} kártyája <em>újra él.</em></>};
      case 'remove':
        return {kicker: 'TÖRÖLVE', title: <>{first} kártyája <em>megsemmisül.</em></>};
      default:
        return {kicker: `A HOUSE KÁRTYÁJA · ${member.code}`, title: <>{member.name} · <em>{meta.name}</em></>};
    }
  })();

  /* On the body, above the page's own stacking: a console page's footer would otherwise paint over the stage. */
  return createPortal(
    <div className={`rm-mco is-l${level}${cue ? ` is-play-${cue.play}` : ''}`} role="dialog" aria-modal="true" aria-label={`${member.name} kártyája`} style={{'--mc-ink': meta.ink, '--mc-glow': meta.glow} as React.CSSProperties}>
      <div className="rm-mco-backdrop" onClick={onClose} aria-hidden="true"/>
      <div className="rm-mco-aurora" aria-hidden="true"/>
      <Embers density={level >= 4 ? 48 : 24} className="rm-mco-embers"/>
      <button type="button" className="rm-mco-close" onClick={onClose} aria-label="Bezárás">
        <X size={16}/>
      </button>
      <div className="rm-mco-inner">
        <div className="rm-mco-head">
          <span className="rm-label">{head.kicker}</span>
          <h2>{head.title}</h2>
        </div>
        <CardScene
          member={member}
          cue={cue}
          onDone={(play) => {
            onDone?.(play);
            if (play === 'remove') onClose();
          }}
          handle={handle}
          className="rm-mco-scene"
        />
        {cue?.play !== 'remove' && (
          <CardActions member={member} handle={handle} withCopy className="rm-mco-actions">
            <Btn onClick={onClose}>BEZÁRÁS</Btn>
          </CardActions>
        )}
      </div>
    </div>,
    document.body
  );
};
