import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Check, Eraser, Lock, PenLine, Sparkles, Upload} from 'lucide-react';
import {Btn} from '../ui/Btn';
import {apiSend, assetUrl} from '../../lib/api';
import {generateSignatureSvg, SIGNATURE_VIEWBOX} from '../../lib/signature';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {useAuthStore, type AuthUser} from '../../stores/useAuthStore';

type Tab = 'draw' | 'upload' | 'generated';

const INK = '#12121a';
const {width: VIEW_W, height: VIEW_H} = SIGNATURE_VIEWBOX;

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

type Point = {x: number; y: number};

/** Ramer–Douglas–Peucker: fewer points, same line. */
function simplify(points: Point[], tolerance = 0.6): Point[] {
  if (points.length < 3) return points;
  const sq = tolerance * tolerance;
  const distanceSq = (p: Point, a: Point, b: Point) => {
    let x = a.x;
    let y = a.y;
    let dx = b.x - x;
    let dy = b.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = b.x;
        y = b.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p.x - x;
    dy = p.y - y;
    return dx * dx + dy * dy;
  };
  const step = (first: number, last: number, out: Point[]) => {
    let max = sq;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = distanceSq(points[i], points[first], points[last]);
      if (d > max) {
        index = i;
        max = d;
      }
    }
    if (index > -1) {
      if (index - first > 1) step(first, index, out);
      out.push(points[index]);
      if (last - index > 1) step(index, last, out);
    }
  };
  const out = [points[0]];
  step(0, points.length - 1, out);
  out.push(points[points.length - 1]);
  return out;
}

/** Strokes → SVG path data with smooth cubic joins, in view-box units. */
function pathOf(strokes: Point[][]): string {
  const f = (n: number) => Number(n.toFixed(1));
  let d = '';
  for (const raw of strokes) {
    const points = simplify(raw);
    if (!points.length) continue;
    if (points.length < 3) {
      d += `M ${f(points[0].x)} ${f(points[0].y)} L ${f(points[points.length - 1].x)} ${f(points[points.length - 1].y + 0.01)}`;
      continue;
    }
    d += `M ${f(points[0].x)} ${f(points[0].y)}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
      d += ` Q ${f(a.x)} ${f(a.y)} ${f(mid.x)} ${f(mid.y)}`;
    }
    const last = points[points.length - 1];
    d += ` L ${f(last.x)} ${f(last.y)}`;
  }
  return d.trim();
}

const SignaturePad: React.FC<{onChange: (path: string, empty: boolean) => void; resetKey: number}> = ({onChange, resetKey}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);

  const scale = () => {
    const canvas = canvasRef.current!;
    return {sx: VIEW_W / canvas.clientWidth, sy: VIEW_H / canvas.clientHeight};
  };

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    context.setTransform(ratio * (canvas.clientWidth / VIEW_W), 0, 0, ratio * (canvas.clientHeight / VIEW_H), 0, 0);
    context.clearRect(0, 0, VIEW_W, VIEW_H);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = INK;
    context.lineWidth = 2.2;
    for (const stroke of strokes.current) {
      if (!stroke.length) continue;
      context.beginPath();
      context.moveTo(stroke[0].x, stroke[0].y);
      for (const point of stroke.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  };

  useEffect(() => {
    strokes.current = [];
    redraw();
    onChange('', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const pointOf = (event: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const {sx, sy} = scale();
    return {x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy};
  };

  const down = (event: React.PointerEvent) => {
    event.preventDefault();
    drawing.current = true;
    canvasRef.current?.setPointerCapture(event.pointerId);
    strokes.current.push([pointOf(event)]);
  };
  const move = (event: React.PointerEvent) => {
    if (!drawing.current) return;
    strokes.current[strokes.current.length - 1].push(pointOf(event));
    redraw();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const path = pathOf(strokes.current);
    onChange(path, !path);
  };

  return (
    <div className="rm-sigpad">
      <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}/>
      {!strokes.current.length && <span className="rm-sigpad-hint">ÍRJ ALÁ A VONALRA</span>}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Upload: strip the paper, keep the ink                               */
/* ------------------------------------------------------------------ */

async function prepareUpload(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('A kép nem olvasható.'));
      element.src = url;
    });
    const scale = Math.min((VIEW_W * 2) / image.width, (VIEW_H * 2) / image.height, 1);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) throw new Error('A kép nem dolgozható fel.');
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const data = pixels.data;
    // Light pixels become transparent; dark ones become ink with soft edges.
    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const alpha = luminance > 200 ? 0 : luminance < 120 ? 255 : Math.round(((200 - luminance) / 80) * 255);
      data[i] = 18;
      data[i + 1] = 18;
      data[i + 2] = 26;
      data[i + 3] = Math.min(alpha, data[i + 3]);
    }
    context.putImageData(pixels, 0, 0);
    // Trim to the ink, then fit into the signature box.
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] > 30) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) throw new Error('Nem találtunk aláírást a képen. Sötét tinta, világos háttér kell.');
    const out = document.createElement('canvas');
    out.width = VIEW_W * 2;
    out.height = VIEW_H * 2;
    const target = out.getContext('2d')!;
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const fit = Math.min((out.width - 24) / cropW, (out.height - 24) / cropH);
    const drawW = cropW * fit;
    const drawH = cropH * fit;
    target.drawImage(canvas, minX, minY, cropW, cropH, (out.width - drawW) / 2, (out.height - drawH) / 2, drawW, drawH);
    const result = out.toDataURL('image/png');
    if (result.length > 250 * 1024) throw new Error('A kép túl részletes. Próbáld kisebb felbontással.');
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------------ */
/* Studio                                                              */
/* ------------------------------------------------------------------ */

const KIND_LABEL: Record<string, string> = {generated: 'GENERÁLT', drawn: 'SAJÁT KEZŰ', uploaded: 'FELTÖLTÖTT'};

/**
 * Where a manager or owner decides how they sign.
 *
 * Three ways in: draw it on the pad, upload a picture of it (the paper is
 * removed, the ink kept), or pick one of the variants drawn from the name.
 * Once a document has carried the signature, this only shows it.
 */
export const SignatureStudio: React.FC<{user: AuthUser}> = ({user}) => {
  const setUser = useAuthStore((state) => state.setUser);
  const [tab, setTab] = useState<Tab>('draw');
  const [path, setPath] = useState('');
  const [padEmpty, setPadEmpty] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [upload, setUpload] = useState<string | null>(null);
  const [seed, setSeed] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const locked = user.signatureLocked;

  const variants = useMemo(() => Array.from({length: 4}, (_, index) => `${user.id}:${round}:${index}`).map((value) => ({seed: value, svg: generateSignatureSvg(user.name, value)})), [user.id, user.name, round]);

  const save = async (body: Record<string, unknown>, okText: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await apiSend<{user: AuthUser}>('/api/profile/signature', 'PUT', body);
      setUser(data.user);
      toast.success(okText);
      playSfx('success');
      setResetKey((value) => value + 1);
      setUpload(null);
      setSeed(null);
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setUpload(await prepareUpload(file));
      playSfx('open');
    } catch (err) {
      toast.error('Nem használható', (err as Error).message);
      playSfx('error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section id="alairas" className="rm-card scroll-mt-28 p-6 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="rm-label">AZ ALÁÍRÁSOD</span>
          <h2 className="mt-2 font-heading text-[22px] leading-tight text-white">{locked ? 'Végleges.' : 'Ahogy te írod.'}</h2>
          <p className="mt-2 max-w-xl text-[11px] leading-[1.8] text-[#8d8584]">
            {locked
              ? 'Ez az aláírás már kiállított dokumentumon szerepel, ezért nem változtatható. A ház minden további irata is ezt viseli.'
              : 'Minden dokumentumon, amit kiállítasz vagy ellenjegyzel, ez szerepel. Amíg nem készül az első irat a neveddel, bármikor cserélheted — utána végleges lesz.'}
          </p>
        </div>
        <div className="w-full sm:w-64">
          <div className="rm-signature-card">{user.signatureUrl ? <img src={assetUrl(user.signatureUrl)} alt=""/> : <div className="h-14"/>}</div>
          <span className="mt-2 flex items-center justify-between text-[8px] tracking-[0.2em] text-[#6f6968]">
            <span>{KIND_LABEL[user.signatureKind] || 'GENERÁLT'}</span>
            {locked ? (
              <span className="flex items-center gap-1 text-[color:var(--rm-red)]">
                <Lock size={9}/> VÉGLEGES
              </span>
            ) : user.signatureDecided ? (
              <span className="flex items-center gap-1 text-emerald-300">
                <Check size={9}/> KIVÁLASZTVA
              </span>
            ) : (
              <span className="text-amber-300">MÉG NEM VÁLASZTOTTÁL</span>
            )}
          </span>
        </div>
      </div>

      {!locked && (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            {(
              [
                {id: 'draw', label: 'RAJZOLOM', icon: PenLine},
                {id: 'upload', label: 'FELTÖLTÖM', icon: Upload},
                {id: 'generated', label: 'GENERÁLT', icon: Sparkles}
              ] as const
            ).map((option) => (
              <button key={option.id} type="button" onClick={() => setTab(option.id)} className={`rm-sig-tab inline-flex items-center gap-2${tab === option.id ? ' is-on' : ''}`}>
                <option.icon size={11}/> {option.label}
              </button>
            ))}
            {!user.signatureDecided && (
              <button type="button" onClick={() => save({mode: 'keep'}, 'A jelenlegi aláírás marad.')} disabled={busy} className="rm-sig-tab ml-auto inline-flex items-center gap-2">
                <Check size={11}/> MARADJON A MOSTANI
              </button>
            )}
          </div>

          {tab === 'draw' && (
            <div className="mt-5 max-w-xl">
              <SignaturePad
                resetKey={resetKey}
                onChange={(value, empty) => {
                  setPath(value);
                  setPadEmpty(empty);
                }}
              />
              <p className="mt-2 text-[9px] leading-[1.6] text-[#6f6968]">Egérrel, ujjal vagy tollal. Több vonásból is állhat.</p>
              <div className="mt-3 flex gap-2">
                <Btn variant="red" onClick={() => save({mode: 'draw', path}, 'Az aláírásod elmentve.')} disabled={busy || padEmpty}>
                  <Check size={12}/> EZ LEGYEN
                </Btn>
                <Btn onClick={() => setResetKey((value) => value + 1)} disabled={padEmpty}>
                  <Eraser size={12}/> TÖRLÉS
                </Btn>
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="mt-5 max-w-xl">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pickFile} className="hidden"/>
              {upload ? (
                <>
                  <div className="rm-signature-card">
                    <img src={upload} alt="Feltöltött aláírás" className="block h-auto w-full"/>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Btn variant="red" onClick={() => save({mode: 'upload', image: upload}, 'Az aláírásod elmentve.')} disabled={busy}>
                      <Check size={12}/> EZ LEGYEN
                    </Btn>
                    <Btn onClick={() => fileRef.current?.click()}>MÁSIK KÉP</Btn>
                  </div>
                </>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} className="rm-dropzone w-full">
                  <Upload size={20} className="text-[color:var(--rm-red)]"/>
                  <strong className="text-[11px] tracking-[0.15em] text-white">KÉP AZ ALÁÍRÁSODRÓL</strong>
                  <span className="text-[10px] text-[#8d8584]">Sötét tinta, világos papír. A hátteret levesszük, a tinta marad.</span>
                </button>
              )}
            </div>
          )}

          {tab === 'generated' && (
            <div className="mt-5">
              <p className="mb-3 text-[10px] leading-[1.6] text-[#8d8584]">A nevedből rajzolt változatok. Válassz egyet, vagy kérj újakat.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {variants.map((variant) => (
                  <button key={variant.seed} type="button" onClick={() => setSeed(variant.seed)} className={`rm-sig-option${seed === variant.seed ? ' is-on' : ''}`} dangerouslySetInnerHTML={{__html: variant.svg}}/>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Btn variant="red" onClick={() => save({mode: 'generated', seed}, 'Az aláírásod elmentve.')} disabled={busy || !seed}>
                  <Check size={12}/> EZ LEGYEN
                </Btn>
                <Btn onClick={() => setRound((value) => value + 1)}>
                  <Sparkles size={12}/> ÚJ VÁLTOZATOK
                </Btn>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};
