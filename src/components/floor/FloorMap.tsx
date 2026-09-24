import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Minus, Plus, RotateCcw} from 'lucide-react';
import {featureSize, seatPositions, smoothPath, tableClashes, tableState, type FloorFeature, type FloorPlan, type FloorTable, type TableSide, type TableState} from '../../../shared/floorPlan.ts';
import type {HeldTable} from '../../hooks/useFloorPlan';

export const STATE_LABEL: Record<TableState, string> = {
  free: 'Szabad',
  taken: 'Foglalt',
  unfit: 'Nem ekkora társaságra',
  locked: 'House tagoknak',
  inactive: 'Nem foglalható'
};

interface Props {
  plan: FloorPlan;
  /** Tables held by confirmed bookings around the time shown. */
  taken: HeldTable[];
  /** The moment the room is coloured for. */
  at: Date;
  slotMinutes: number;
  /** The party: tables it does not fit are dimmed. */
  guests?: number;
  /** The guest's House tier; undefined skips the tier check (the server still enforces it). */
  tier?: string;
  selectedId?: string | null;
  /** Called with the table tapped, whatever its state; the parent decides what to do. */
  onSelect?: (table: FloorTable, state: TableState) => void;
  /** A booking's own table, marked apart from the rest (staff). */
  ownId?: string | null;
  className?: string;
}

interface View {
  k: number;
  tx: number;
  ty: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const HOME: View = {k: 1, tx: 0, ty: 0};

const hhmm = (value: string | Date): string => new Date(value).toLocaleTimeString('hu-HU', {hour: '2-digit', minute: '2-digit'});
const centred = {textAnchor: 'middle', dominantBaseline: 'middle'} as const;
const pointsAttr = (points: [number, number][]): string => points.map((point) => point.join(',')).join(' ');
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** Keeps the room filling the frame at every zoom. */
const clampView = (view: View, plan: FloorPlan): View => {
  const k = clamp(view.k, MIN_ZOOM, MAX_ZOOM);
  return {k, tx: clamp(view.tx, plan.width * (1 - k), 0), ty: clamp(view.ty, plan.height * (1 - k), 0)};
};

/** Stools along a curved counter: evenly by length, one side of the path, clear of it. */
function pathStools(points: [number, number][], thickness: number, count: number, side: 'left' | 'right'): {x: number; y: number}[] {
  const segments = points.slice(1).map((point, i) => {
    const a = points[i];
    const len = Math.hypot(point[0] - a[0], point[1] - a[1]) || 1;
    return {a, b: point, len};
  });
  const total = segments.reduce((sum, segment) => sum + segment.len, 0);
  const gap = thickness / 2 + 13;
  const sign = side === 'left' ? 1 : -1;
  return Array.from({length: count}, (_, i) => {
    const target = (total * (i + 0.5)) / count;
    let acc = 0;
    for (const segment of segments) {
      if (acc + segment.len >= target || segment === segments[segments.length - 1]) {
        const t = clamp((target - acc) / segment.len, 0, 1);
        const dx = (segment.b[0] - segment.a[0]) / segment.len;
        const dy = (segment.b[1] - segment.a[1]) / segment.len;
        // Left of the direction of travel, on screen, is (dy, -dx).
        return {x: segment.a[0] + (segment.b[0] - segment.a[0]) * t + dy * gap * sign, y: segment.a[1] + (segment.b[1] - segment.a[1]) * t - dx * gap * sign};
      }
      acc += segment.len;
    }
    return {x: points[0][0], y: points[0][1]};
  });
}

/** The table's outline, used for the body, the hatch and the rings. */
const Body: React.FC<{table: FloorTable; className?: string; fill?: string; inflate?: number; style?: React.CSSProperties}> = ({table, className, fill, inflate = 0, style}) =>
  table.shape === 'round' ? (
    <circle r={table.w / 2 + inflate} className={className} fill={fill} style={style}/>
  ) : (
    <rect x={-table.w / 2 - inflate} y={-table.h / 2 - inflate} width={table.w + inflate * 2} height={table.h + inflate * 2} rx={(table.shape === 'booth' ? 16 : 8) + inflate / 2} className={className} fill={fill} style={style}/>
  );

/** A booth's bench: a thick line around the seated sides. */
const Bench: React.FC<{table: FloorTable}> = ({table}) => {
  const sides: TableSide[] = table.seatCounts
    ? (Object.keys(table.seatCounts) as TableSide[]).filter((side) => (table.seatCounts?.[side] || 0) > 0)
    : table.seatSides?.length
      ? table.seatSides
      : ['left', 'top', 'right'];
  const d = 22;
  const x0 = -table.w / 2 - d;
  const x1 = table.w / 2 + d;
  const y0 = -table.h / 2 - d;
  const y1 = table.h / 2 + d;
  const segments: string[] = [];
  if (sides.includes('left')) segments.push(`M ${x0} ${y1 - d} L ${x0} ${y0 + d}`);
  if (sides.includes('top')) segments.push(`M ${x0 + d} ${y0} L ${x1 - d} ${y0}`);
  if (sides.includes('right')) segments.push(`M ${x1} ${y0 + d} L ${x1} ${y1 - d}`);
  if (sides.includes('bottom')) segments.push(`M ${x0 + d} ${y1} L ${x1 - d} ${y1}`);
  return <path d={segments.join(' ')} className="rm-floor-bench"/>;
};

/** Where a rectangular bar's stools go. */
function barStools(w: number, h: number, side: TableSide | 'none' | undefined, count: number | undefined): {x: number; y: number}[] {
  const vertical = h > w;
  const where = side || (vertical ? 'right' : 'bottom');
  if (where === 'none') return [];
  const along = where === 'top' || where === 'bottom' ? w : h;
  const n = count ?? Math.max(2, Math.floor(along / 42));
  return Array.from({length: n}, (_, i) => {
    const t = (i + 0.5) / n;
    if (where === 'top') return {x: -w / 2 + w * t, y: -h / 2 - 16};
    if (where === 'bottom') return {x: -w / 2 + w * t, y: h / 2 + 16};
    if (where === 'left') return {x: -w / 2 - 16, y: -h / 2 + h * t};
    return {x: w / 2 + 16, y: -h / 2 + h * t};
  });
}

const Stool: React.FC<{x: number; y: number}> = ({x, y}) => (
  <g className="rm-floor-stool" transform={`translate(${x} ${y})`}>
    <circle r="7"/>
    <circle r="3" className="rm-floor-stool-top"/>
  </g>
);

const Feature: React.FC<{feature: FloorFeature; index: number}> = ({feature, index}) => {
  const [dw, dh] = featureSize(feature.kind);
  const {kind, x = 0, y = 0, w = dw, h = dh, rotation = 0, label} = feature;
  const transform = `translate(${x} ${y})${rotation ? ` rotate(${rotation})` : ''}`;
  const upright = rotation ? `rotate(${-rotation})` : undefined;
  const stagger = {'--i': index} as React.CSSProperties;

  switch (kind) {
    case 'wall':
      return <polyline points={pointsAttr(feature.points || [])} className="rm-floor-wall"/>;
    case 'sofa': {
      const d = smoothPath(feature.points || []);
      const thick = feature.w || 34;
      return (
        <g className="rm-floor-sofa" style={stagger}>
          <path d={d} className="rm-floor-sofa-shadow" style={{strokeWidth: thick + 12}}/>
          <path d={d} className="rm-floor-sofa-body" style={{strokeWidth: thick}}/>
          <path d={d} className="rm-floor-sofa-cushion" style={{strokeWidth: thick * 0.56}}/>
          <path d={d} className="rm-floor-sofa-tuft"/>
          <path d={d} className="rm-floor-sofa-sheen" style={{strokeWidth: thick * 0.22}}/>
        </g>
      );
    }
    case 'bar': {
      if (feature.points) {
        const d = smoothPath(feature.points);
        const thick = feature.w || 60;
        const side = feature.stoolSide === 'right' ? 'right' : 'left';
        const stools = feature.stoolSide === 'none' ? [] : pathStools(feature.points, thick, feature.stools ?? 6, side);
        return (
          <g className="rm-floor-bar" style={stagger}>
            <path d={d} className="rm-floor-bar-shadow" style={{strokeWidth: thick + 10}}/>
            <path d={d} className="rm-floor-bar-body" style={{strokeWidth: thick}}/>
            <path d={d} className="rm-floor-bar-top" style={{strokeWidth: thick * 0.62}}/>
            <path d={d} className="rm-floor-bar-edge"/>
            {stools.map((stool, i) => (
              <Stool key={i} x={stool.x} y={stool.y}/>
            ))}
            {feature.x !== undefined && feature.y !== undefined && (
              <text transform={`translate(${feature.x} ${feature.y})${rotation ? ` rotate(${rotation})` : ''}`} className="rm-floor-feature-label rm-floor-bar-label" {...centred}>
                {label || 'PULT'}
              </text>
            )}
          </g>
        );
      }
      const vertical = h > w;
      return (
        <g transform={transform} className="rm-floor-bar" style={stagger}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="10" className="rm-floor-bar-rect"/>
          <rect x={-w / 2 + 7} y={-h / 2 + 7} width={w - 14} height={h - 14} rx="6" className="rm-floor-bar-rect-top"/>
          {barStools(w, h, feature.stoolSide, feature.stools).map((stool, i) => (
            <Stool key={i} x={stool.x} y={stool.y}/>
          ))}
          <text className="rm-floor-feature-label rm-floor-bar-label" transform={vertical ? 'rotate(-90)' : undefined} {...centred}>
            {label || 'PULT'}
          </text>
        </g>
      );
    }
    case 'stage':
      return (
        <g transform={transform} className="rm-floor-stage" style={stagger}>
          <ellipse cx="0" cy={h / 2} rx={w * 0.85} ry={h * 1.5} fill="url(#rm-floor-stage-glow)" className="rm-floor-stage-halo"/>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="8"/>
          <rect x={-w / 2 + 6} y={-h / 2 + 6} width={w - 12} height={h - 12} rx="5" className="rm-floor-stage-deck"/>
          {[0, 1, 2].map((i) => (
            <React.Fragment key={i}>
              <path d={`M ${-w / 2 - 12 - i * 11} ${-9 - i * 6} q ${-9 - i * 4} ${9 + i * 6} 0 ${18 + i * 12}`} className="rm-floor-wave" style={{animationDelay: `${i * 0.3}s`}}/>
              <path d={`M ${w / 2 + 12 + i * 11} ${-9 - i * 6} q ${9 + i * 4} ${9 + i * 6} 0 ${18 + i * 12}`} className="rm-floor-wave" style={{animationDelay: `${i * 0.3}s`}}/>
            </React.Fragment>
          ))}
          <text transform={upright} {...centred}>
            {label || 'DJ'}
          </text>
        </g>
      );
    case 'speaker':
      return (
        <g transform={transform} className="rm-floor-speaker" style={stagger}>
          <circle r={w / 2 + 6} className="rm-floor-speaker-ring"/>
          <circle r={w / 2 + 6} className="rm-floor-speaker-ring" style={{animationDelay: '1.1s'}}/>
          <circle r={w / 2}/>
          <circle r={w / 5} className="rm-floor-speaker-cone"/>
          {label && (
            <text y={w / 2 + 15} className="rm-floor-feature-caption" {...centred}>
              {label}
            </text>
          )}
        </g>
      );
    case 'dance':
      return (
        <g transform={transform} className="rm-floor-dance" style={stagger}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="12" className="rm-floor-dance-floor"/>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="12" fill="url(#rm-floor-checker)"/>
          <clipPath id={`rm-floor-dance-clip-${feature.id}`}>
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="12"/>
          </clipPath>
          <g clipPath={`url(#rm-floor-dance-clip-${feature.id})`}>
            <ellipse cx="0" cy="0" rx={w * 0.4} ry={h * 0.45} fill="url(#rm-floor-shine)" className="rm-floor-dance-shine"/>
          </g>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="12" className="rm-floor-dance-frame"/>
          <text className="rm-floor-feature-label" transform={upright} {...centred}>
            {label || 'TÁNCPARKETT'}
          </text>
        </g>
      );
    case 'door':
      return (
        <g transform={transform} className="rm-floor-door" style={stagger}>
          <path d={`M ${-w / 2} ${-h / 2} A ${w} ${w} 0 0 1 ${w / 2} ${-h / 2 - w * 0.55}`}/>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="2"/>
          {label && (
            <g transform={`translate(0 ${-h / 2 - w * 0.55 - 10})`}>
              <text transform={upright} className="rm-floor-feature-caption" {...centred}>
                {label}
              </text>
            </g>
          )}
        </g>
      );
    case 'stairs':
      return (
        <g transform={transform} className="rm-floor-stairs" style={stagger}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="6" className="rm-floor-stairs-glow"/>
          {[0, 1, 2, 3].map((i) => {
            const half = (w * (0.5 + 0.16 * i)) / 2;
            const ly = -h / 2 + (h * (i + 0.5)) / 4;
            return <line key={i} x1={-half} y1={ly} x2={half} y2={ly}/>;
          })}
          {label && (
            <text y={-h / 2 - 9} className="rm-floor-feature-caption" {...centred}>
              {label}
            </text>
          )}
        </g>
      );
    case 'pillar':
      return (
        <g transform={transform} className="rm-floor-pillar" style={stagger}>
          {w === h ? (
            <>
              <circle r={w / 2}/>
              <circle r={Math.max(2, w / 2 - 5)} className="rm-floor-pillar-inner"/>
            </>
          ) : (
            <>
              <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="12"/>
              <rect x={-w / 2 + 5} y={-h / 2 + 5} width={w - 10} height={h - 10} rx="8" className="rm-floor-pillar-inner"/>
            </>
          )}
          {label && (
            <text className="rm-floor-feature-caption" {...centred}>
              {label}
            </text>
          )}
        </g>
      );
    case 'plant':
      return (
        <g transform={transform} className="rm-floor-plant" style={stagger}>
          <circle cx={-w * 0.18} cy={-w * 0.14} r={w * 0.3}/>
          <circle cx={w * 0.2} cy={-w * 0.06} r={w * 0.28}/>
          <circle cx="0" cy={w * 0.2} r={w * 0.3}/>
          <circle r={w * 0.13} className="rm-floor-plant-pot"/>
        </g>
      );
    case 'seat':
      return (
        <g transform={`translate(${x} ${y})`} className="rm-floor-loose-seat" style={stagger}>
          <rect x={-w / 2} y={-w / 2} width={w} height={w} rx={w * 0.3}/>
        </g>
      );
    case 'stool':
      return <Stool x={x} y={y}/>;
    case 'restroom':
    case 'area':
      return (
        <g transform={transform} className={kind === 'restroom' ? 'rm-floor-room' : 'rm-floor-area'} style={stagger}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="6"/>
          <text className="rm-floor-feature-label" transform={upright} {...centred}>
            {label || (kind === 'restroom' ? 'WC' : '')}
          </text>
        </g>
      );
    case 'text':
      return (
        <text transform={transform} className="rm-floor-text" {...centred}>
          {label}
        </text>
      );
    default:
      return null;
  }
};

const Table: React.FC<{
  table: FloorTable;
  index: number;
  state: TableState;
  selected: boolean;
  own: boolean;
  filled: number;
  title: string;
  onSelect?: (table: FloorTable, state: TableState) => void;
}> = ({table, index, state, selected, own, filled, title, onSelect}) => {
  const seats = useMemo(() => (table.drawSeats === false ? [] : seatPositions(table)), [table]);
  const rotation = table.rotation || 0;
  const interactive = !!onSelect && state !== 'inactive';
  const upright = rotation ? `rotate(${-rotation})` : undefined;
  const activate = () => onSelect?.(table, state);
  const armchair = table.seatStyle === 'armchair';
  const lounge = table.shape === 'booth';
  return (
    <g
      transform={`translate(${table.x} ${table.y})${rotation ? ` rotate(${rotation})` : ''}`}
      className={`rm-floor-table is-${state}${selected ? ' is-selected' : ''}${own ? ' is-own' : ''}${lounge ? ' is-lounge' : ''}`}
      style={{'--i': index} as React.CSSProperties}
      onClick={interactive ? activate : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activate();
              }
            }
          : undefined
      }
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
    >
      <title>{title}</title>
      {selected && <Body table={table} className="rm-floor-pulse" inflate={12}/>}
      {selected && <Body table={table} className="rm-floor-pulse" inflate={12} style={{animationDelay: '0.9s'}}/>}
      <g className="rm-floor-table-body">
        {lounge && table.bench !== false && <Bench table={table}/>}
        {seats.map((seat, index) =>
          armchair ? (
            <rect key={index} x={seat.x - 8} y={seat.y - 8} width="16" height="16" rx="5" transform={`rotate(${seat.angle} ${seat.x} ${seat.y})`} className={`rm-floor-seat is-armchair${index < filled ? ' is-filled' : ''}`} style={{'--n': index} as React.CSSProperties}/>
          ) : (
            <circle key={index} cx={seat.x} cy={seat.y} r="7" className={`rm-floor-seat${index < filled ? ' is-filled' : ''}`} style={{'--n': index} as React.CSSProperties}/>
          )
        )}
        <Body table={table} className="rm-floor-body" fill={lounge ? 'url(#rm-floor-lounge-fill)' : 'url(#rm-floor-table-fill)'}/>
        <Body table={table} className="rm-floor-rim" inflate={-4}/>
        {state === 'taken' && <Body table={table} className="rm-floor-hatch" fill="url(#rm-floor-hatch)"/>}
        {state === 'taken' && <Body table={table} className="rm-floor-taken-ring" inflate={5}/>}
        <g transform={upright}>
          <text y={table.h < 40 ? 0 : -3} className="rm-floor-table-label" {...centred}>
            {table.label}
          </text>
          {table.h >= 40 && (
            <text y={12} className="rm-floor-table-seats" {...centred}>
              {lounge ? `MAX ${table.seats} FŐ` : `${table.seats} FŐ`}
            </text>
          )}
          {table.minTier && (
            <text x={table.w / 2 - 9} y={-table.h / 2 + 10} className="rm-floor-table-crown" {...centred}>
              王
            </text>
          )}
        </g>
      </g>
    </g>
  );
};

/**
 * The room, drawn from the plan, coloured for one moment: which tables are
 * free, which are already promised, which are the wrong size for the
 * party, which need a House tier. Tap a table to select it; scroll, pinch
 * or use the buttons to zoom, drag to move around.
 */
export const FloorMap: React.FC<Props> = ({plan, taken, at, slotMinutes, guests, tier, selectedId = null, onSelect, ownId = null, className = ''}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(HOME);
  const [active, setActiveState] = useState(false);
  const [dragging, setDragging] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  /* The wheel listener is native and long-lived; it reads the ref, never a stale render. */
  const activeRef = useRef(false);
  const setActive = useCallback((value: boolean) => {
    activeRef.current = value;
    setActiveState(value);
  }, []);
  const pointers = useRef(new Map<number, {x: number; y: number}>());
  const moved = useRef(0);
  const suppressClick = useRef(false);

  useEffect(() => setView(HOME), [plan.width, plan.height]);

  const tables = useMemo(
    () =>
      plan.tables.map((table) => {
        const state = tableState(table, at, slotMinutes, taken, guests, tier);
        const clashes = tableClashes(table, at, slotMinutes, taken) as HeldTable[];
        const zone = plan.zones.find((entry) => entry.id === table.zone)?.name;
        const held = clashes.map((clash) => `${hhmm(clash.from)}–${hhmm(clash.to)}${clash.code ? ` · ${clash.code} · ${clash.name}` : ''}`).join(', ');
        const title = `${table.label} · ${table.shape === 'booth' ? `legfeljebb ${table.seats}` : table.seats} fő${zone ? ` · ${zone}` : ''} · ${STATE_LABEL[state]}${held ? ` (${held})` : ''}`;
        return {table, state, title};
      }),
    [plan, at, slotMinutes, taken, guests, tier]
  );

  /** Pointer position in the plan's own units (before zooming). */
  const toPlan = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return {x: 0, y: 0};
    const matrix = svg.getScreenCTM();
    if (!matrix) return {x: 0, y: 0};
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    return {x: local.x, y: local.y};
  }, []);

  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      const current = viewRef.current;
      const k = clamp(current.k * factor, MIN_ZOOM, MAX_ZOOM);
      const ratio = k / current.k;
      setView(clampView({k, tx: px - (px - current.tx) * ratio, ty: py - (py - current.ty) * ratio}, plan));
    },
    [plan]
  );

  const zoomCentre = (factor: number) => zoomAt(plan.width / 2, plan.height / 2, factor);

  /* Wheel zoom only once the map has been tapped, so the page keeps scrolling over it. */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      if (!activeRef.current) return;
      event.preventDefault();
      const point = toPlan(event.clientX, event.clientY);
      zoomAt(point.x, point.y, Math.exp(-event.deltaY * 0.0016));
    };
    svg.addEventListener('wheel', onWheel, {passive: false});
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toPlan, zoomAt]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    setActive(true);
    suppressClick.current = false;
    moved.current = 0;
    pointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = {x: event.clientX, y: event.clientY};
    const others = [...pointers.current.entries()].filter(([id]) => id !== event.pointerId);
    pointers.current.set(event.pointerId, next);
    moved.current += Math.hypot(next.x - previous.x, next.y - previous.y);
    if (moved.current > 5) {
      // A drag, not a tap: keep the pointer even when it leaves the map, and let no click through.
      // Capturing earlier would retarget the tap's pointerup and swallow the table's click.
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      suppressClick.current = true;
      setDragging(true);
    }
    const current = viewRef.current;
    if (others.length === 0) {
      // One finger or the mouse: drag the room, once zoomed in.
      if (current.k <= 1) return;
      const a = toPlan(previous.x, previous.y);
      const b = toPlan(next.x, next.y);
      setView(clampView({k: current.k, tx: current.tx + (b.x - a.x), ty: current.ty + (b.y - a.y)}, plan));
      return;
    }
    // Two fingers: pinch around their middle, and follow it.
    const other = others[0][1];
    const before = Math.hypot(previous.x - other.x, previous.y - other.y) || 1;
    const after = Math.hypot(next.x - other.x, next.y - other.y) || 1;
    const midBefore = toPlan((previous.x + other.x) / 2, (previous.y + other.y) / 2);
    const midAfter = toPlan((next.x + other.x) / 2, (next.y + other.y) / 2);
    const k = clamp(current.k * (after / before), MIN_ZOOM, MAX_ZOOM);
    const ratio = k / current.k;
    setView(clampView({k, tx: midAfter.x - (midBefore.x - current.tx) * ratio, ty: midAfter.y - (midBefore.y - current.ty) * ratio}, plan));
  };

  const onPointerEnd = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) setDragging(false);
  };

  const handleSelect = onSelect
    ? (table: FloorTable, state: TableState) => {
        if (suppressClick.current) return;
        onSelect(table, state);
      }
    : undefined;

  const zoomed = view.k > 1.001;

  return (
    <div className={`rm-floor${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}${zoomed ? ' is-zoomed' : ''} ${className}`} onMouseLeave={() => setActive(false)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${plan.width} ${plan.height}`}
        className="rm-floor-svg"
        role="img"
        aria-label={`${plan.name} alaprajza`}
        style={{touchAction: zoomed ? 'none' : 'pan-y'}}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={(event) => {
          const point = toPlan(event.clientX, event.clientY);
          zoomAt(point.x, point.y, zoomed && view.k >= MAX_ZOOM - 0.01 ? 1 / view.k : 1.8);
        }}
      >
        <defs>
          <pattern id="rm-floor-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" className="rm-floor-grid-dot"/>
          </pattern>
          <pattern id="rm-floor-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="rm-floor-hatch-line"/>
          </pattern>
          <pattern id="rm-floor-checker" width="30" height="30" patternUnits="userSpaceOnUse">
            <rect width="15" height="15" className="rm-floor-checker-cell"/>
            <rect x="15" y="15" width="15" height="15" className="rm-floor-checker-cell"/>
          </pattern>
          <radialGradient id="rm-floor-stage-glow">
            <stop offset="0" stopColor="#ff2b4f" stopOpacity="0.32"/>
            <stop offset="1" stopColor="#ff2b4f" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="rm-floor-shine">
            <stop offset="0" stopColor="#ff5a76" stopOpacity="0.28"/>
            <stop offset="1" stopColor="#ff5a76" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="rm-floor-table-fill" cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor="#2a1d23"/>
            <stop offset="1" stopColor="#120b0f"/>
          </radialGradient>
          <radialGradient id="rm-floor-lounge-fill" cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor="#3a1420"/>
            <stop offset="1" stopColor="#150910"/>
          </radialGradient>
          <linearGradient id="rm-floor-leather" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8a1830"/>
            <stop offset="0.55" stopColor="#5c0f22"/>
            <stop offset="1" stopColor="#3a0a17"/>
          </linearGradient>
          <linearGradient id="rm-floor-counter" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4a1522"/>
            <stop offset="1" stopColor="#1c0b10"/>
          </linearGradient>
          <linearGradient id="rm-floor-sweep-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff2b4f" stopOpacity="0"/>
            <stop offset="0.5" stopColor="#ff2b4f" stopOpacity="0.07"/>
            <stop offset="1" stopColor="#ff2b4f" stopOpacity="0"/>
          </linearGradient>
          <filter id="rm-floor-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <filter id="rm-floor-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6"/>
          </filter>
        </defs>

        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`} className="rm-floor-world">
          <rect x="0" y="0" width={plan.width} height={plan.height} className="rm-floor-bg"/>
          <rect x="0" y="0" width={plan.width} height={plan.height} fill="url(#rm-floor-grid)"/>

          {plan.zones.map((zone, index) => (
            <g key={zone.id} className="rm-floor-zone" style={{'--i': index} as React.CSSProperties}>
              <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="14"/>
              <g className="rm-floor-zone-title">
                <text x={zone.labelX ?? zone.x + 16} y={zone.labelY ?? zone.y + 24}>{zone.name.toUpperCase()}</text>
                <line x1={zone.labelX ?? zone.x + 16} y1={(zone.labelY ?? zone.y + 24) + 9} x2={(zone.labelX ?? zone.x + 16) + 46} y2={(zone.labelY ?? zone.y + 24) + 9}/>
              </g>
            </g>
          ))}

          {plan.features.map((feature, index) => (
            <Feature key={feature.id} feature={feature} index={index}/>
          ))}

          {tables.map(({table, state, title}, index) => (
            <Table
              key={table.id}
              table={table}
              index={index}
              state={state}
              selected={table.id === selectedId}
              own={table.id === ownId}
              filled={table.id === selectedId && guests && table.drawSeats !== false ? Math.min(guests, table.seats) : 0}
              title={title}
              onSelect={handleSelect}
            />
          ))}

          <rect x="0" y="-240" width={plan.width} height="240" fill="url(#rm-floor-sweep-fill)" className="rm-floor-sweep" style={{'--sweep': `${plan.height + 480}px`} as React.CSSProperties}/>
        </g>
      </svg>

      <div className="rm-floor-controls" aria-label="Nagyítás">
        <button type="button" onClick={() => zoomCentre(1.5)} disabled={view.k >= MAX_ZOOM - 0.01} aria-label="Nagyítás">
          <Plus size={13}/>
        </button>
        <span className="rm-floor-zoom">{Math.round(view.k * 100)}%</span>
        <button type="button" onClick={() => zoomCentre(1 / 1.5)} disabled={!zoomed} aria-label="Kicsinyítés">
          <Minus size={13}/>
        </button>
        <button type="button" onClick={() => setView(HOME)} disabled={!zoomed} aria-label="Alaphelyzet" title="Alaphelyzet">
          <RotateCcw size={12}/>
        </button>
      </div>
      {!active && !zoomed && <div className="rm-floor-hint">KATTINTS · GÖRGETÉS VAGY CSÍPÉS = NAGYÍTÁS · HÚZÁS = MOZGATÁS</div>}
    </div>
  );
};

/** What the colours mean. */
export const FloorLegend: React.FC<{className?: string; staff?: boolean}> = ({className = '', staff = false}) => (
  <div className={`rm-floor-legend ${className}`} aria-label="Jelmagyarázat">
    <span className="is-free">
      <i/>SZABAD
    </span>
    <span className="is-taken">
      <i/>FOGLALT
    </span>
    {!staff && (
      <span className="is-unfit">
        <i/>MÁS MÉRET
      </span>
    )}
    <span className="is-locked">
      <i/>HOUSE
    </span>
    <span className="is-selected">
      <i/>{staff ? 'KIJELÖLT' : 'A TIÉD'}
    </span>
  </div>
);
