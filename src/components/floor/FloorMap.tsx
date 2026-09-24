import React, {useMemo} from 'react';
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

const hhmm = (value: string | Date): string => new Date(value).toLocaleTimeString('hu-HU', {hour: '2-digit', minute: '2-digit'});
const centred = {textAnchor: 'middle', dominantBaseline: 'middle'} as const;
const pointsAttr = (points: [number, number][]): string => points.map((point) => point.join(',')).join(' ');

/** The table's outline, used for the body, the hatch and the pulse ring. */
const Body: React.FC<{table: FloorTable; className?: string; fill?: string; inflate?: number}> = ({table, className, fill, inflate = 0}) =>
  table.shape === 'round' ? (
    <circle r={table.w / 2 + inflate} className={className} fill={fill}/>
  ) : (
    <rect x={-table.w / 2 - inflate} y={-table.h / 2 - inflate} width={table.w + inflate * 2} height={table.h + inflate * 2} rx={table.shape === 'booth' ? 14 : 7} className={className} fill={fill}/>
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
function barStools(w: number, h: number, side: TableSide | 'none' | undefined, count: number | undefined): {cx: number; cy: number}[] {
  const vertical = h > w;
  const where = side || (vertical ? 'right' : 'bottom');
  if (where === 'none') return [];
  const along = where === 'top' || where === 'bottom' ? w : h;
  const n = count ?? Math.max(2, Math.floor(along / 42));
  return Array.from({length: n}, (_, i) => {
    const t = (i + 0.5) / n;
    if (where === 'top') return {cx: -w / 2 + w * t, cy: -h / 2 - 15};
    if (where === 'bottom') return {cx: -w / 2 + w * t, cy: h / 2 + 15};
    if (where === 'left') return {cx: -w / 2 - 15, cy: -h / 2 + h * t};
    return {cx: w / 2 + 15, cy: -h / 2 + h * t};
  });
}

const Feature: React.FC<{feature: FloorFeature}> = ({feature}) => {
  const [dw, dh] = featureSize(feature.kind);
  const {kind, x = 0, y = 0, w = dw, h = dh, rotation = 0, label} = feature;
  const transform = `translate(${x} ${y})${rotation ? ` rotate(${rotation})` : ''}`;
  const upright = rotation ? `rotate(${-rotation})` : undefined;

  switch (kind) {
    case 'wall':
      return <polyline points={pointsAttr(feature.points || [])} className="rm-floor-wall"/>;
    case 'sofa': {
      const d = smoothPath(feature.points || []);
      return (
        <g className="rm-floor-sofa">
          <path d={d} className="rm-floor-sofa-outer"/>
          <path d={d} className="rm-floor-sofa-inner"/>
        </g>
      );
    }
    case 'bar': {
      if (feature.points) {
        const centre = feature.points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map((value) => value / feature.points!.length);
        const lx = feature.x ?? centre[0];
        const ly = feature.y ?? centre[1];
        return (
          <g className="rm-floor-bar">
            <polygon points={pointsAttr(feature.points)} className="rm-floor-bar-poly"/>
            <text transform={`translate(${lx} ${ly})${rotation ? ` rotate(${rotation})` : ''}`} className="rm-floor-feature-label" {...centred}>
              {label || 'PULT'}
            </text>
          </g>
        );
      }
      const vertical = h > w;
      return (
        <g transform={transform} className="rm-floor-bar">
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="8" fill="url(#rm-floor-bar)"/>
          <rect x={-w / 2 + 6} y={-h / 2 + 6} width={w - 12} height={h - 12} rx="5" className="rm-floor-bar-top"/>
          {barStools(w, h, feature.stoolSide, feature.stools).map((stool, i) => (
            <circle key={i} cx={stool.cx} cy={stool.cy} r="6" className="rm-floor-stool"/>
          ))}
          <text className="rm-floor-feature-label" transform={vertical ? 'rotate(-90)' : undefined} {...centred}>
            {label || 'PULT'}
          </text>
        </g>
      );
    }
    case 'stage':
      return (
        <g transform={transform} className="rm-floor-stage">
          <ellipse cx="0" cy={h / 2} rx={w * 0.8} ry={h * 1.4} fill="url(#rm-floor-stage-glow)"/>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="6"/>
          <path d={`M ${-w / 2 - 12} -9 q -9 9 0 18`} className="rm-floor-wave"/>
          <path d={`M ${-w / 2 - 22} -15 q -14 15 0 30`} className="rm-floor-wave" style={{animationDelay: '0.4s'}}/>
          <path d={`M ${w / 2 + 12} -9 q 9 9 0 18`} className="rm-floor-wave"/>
          <path d={`M ${w / 2 + 22} -15 q 14 15 0 30`} className="rm-floor-wave" style={{animationDelay: '0.4s'}}/>
          <text transform={upright} {...centred}>
            {label || 'DJ'}
          </text>
        </g>
      );
    case 'speaker':
      return (
        <g transform={transform} className="rm-floor-speaker">
          <circle r={w / 2 + 8} className="rm-floor-speaker-ring"/>
          <circle r={w / 2}/>
          <text {...centred}>S</text>
          {label && (
            <text y={w / 2 + 14} className="rm-floor-feature-label rm-floor-feature-caption" {...centred}>
              {label}
            </text>
          )}
        </g>
      );
    case 'dance':
      return (
        <g transform={transform} className="rm-floor-dance">
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="10" fill="url(#rm-floor-checker)"/>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="10" className="rm-floor-dance-frame"/>
          <text className="rm-floor-feature-label" transform={upright} {...centred}>
            {label || 'TÁNCPARKETT'}
          </text>
        </g>
      );
    case 'door':
      return (
        <g transform={transform} className="rm-floor-door">
          <path d={`M ${-w / 2} ${-h / 2} A ${w} ${w} 0 0 1 ${w / 2} ${-h / 2 - w * 0.55}`}/>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="3"/>
          <g transform={`translate(0 ${-h / 2 - w * 0.55 - 10})`}>
            <text transform={upright} className="rm-floor-feature-label rm-floor-feature-caption" {...centred}>
              {label || 'BEJÁRAT'}
            </text>
          </g>
        </g>
      );
    case 'stairs':
      return (
        <g transform={transform} className="rm-floor-stairs">
          {[0, 1, 2, 3].map((i) => {
            const half = (w * (0.55 + 0.15 * i)) / 2;
            const ly = -h / 2 + (h * (i + 0.5)) / 4;
            return <line key={i} x1={-half} y1={ly} x2={half} y2={ly}/>;
          })}
          {label && (
            <text y={h / 2 + 12} className="rm-floor-feature-label rm-floor-feature-caption" {...centred}>
              {label}
            </text>
          )}
        </g>
      );
    case 'pillar':
      return (
        <g transform={transform} className="rm-floor-pillar">
          {w === h ? (
            <>
              <circle r={w / 2}/>
              <circle r={Math.max(2, w / 2 - 5)} className="rm-floor-pillar-inner"/>
            </>
          ) : (
            <>
              <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="10"/>
              <rect x={-w / 2 + 5} y={-h / 2 + 5} width={w - 10} height={h - 10} rx="7" className="rm-floor-pillar-inner"/>
            </>
          )}
          {label && (
            <text className="rm-floor-feature-label rm-floor-feature-caption" {...centred}>
              {label}
            </text>
          )}
        </g>
      );
    case 'plant':
      return (
        <g transform={transform} className="rm-floor-plant">
          <circle cx={-w * 0.18} cy={-w * 0.14} r={w * 0.3}/>
          <circle cx={w * 0.2} cy={-w * 0.06} r={w * 0.28}/>
          <circle cx="0" cy={w * 0.2} r={w * 0.3}/>
          <circle r={w * 0.13} className="rm-floor-plant-pot"/>
        </g>
      );
    case 'seat':
      return <circle cx={x} cy={y} r={w / 2} className="rm-floor-loose-seat"/>;
    case 'stool':
      return <circle cx={x} cy={y} r={w / 2} className="rm-floor-stool"/>;
    case 'restroom':
    case 'area':
      return (
        <g transform={transform} className={kind === 'restroom' ? 'rm-floor-room' : 'rm-floor-area'}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="4"/>
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
  state: TableState;
  selected: boolean;
  own: boolean;
  filled: number;
  title: string;
  onSelect?: (table: FloorTable, state: TableState) => void;
}> = ({table, state, selected, own, filled, title, onSelect}) => {
  const seats = useMemo(() => seatPositions(table), [table]);
  const rotation = table.rotation || 0;
  const interactive = !!onSelect && state !== 'inactive';
  const upright = rotation ? `rotate(${-rotation})` : undefined;
  const activate = () => onSelect?.(table, state);
  const armchair = table.seatStyle === 'armchair';
  return (
    <g
      transform={`translate(${table.x} ${table.y})${rotation ? ` rotate(${rotation})` : ''}`}
      className={`rm-floor-table is-${state}${selected ? ' is-selected' : ''}${own ? ' is-own' : ''}`}
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
      {selected && <Body table={table} className="rm-floor-pulse" inflate={10}/>}
      <g className="rm-floor-table-body">
        {table.shape === 'booth' && table.bench !== false && <Bench table={table}/>}
        {seats.map((seat, index) =>
          armchair ? (
            <rect key={index} x={seat.x - 8} y={seat.y - 8} width="16" height="16" rx="4" transform={`rotate(${seat.angle} ${seat.x} ${seat.y})`} className={`rm-floor-seat is-armchair${index < filled ? ' is-filled' : ''}`}/>
          ) : (
            <circle key={index} cx={seat.x} cy={seat.y} r="7" className={`rm-floor-seat${index < filled ? ' is-filled' : ''}`}/>
          )
        )}
        <Body table={table} className="rm-floor-body"/>
        {state === 'taken' && <Body table={table} className="rm-floor-hatch" fill="url(#rm-floor-hatch)"/>}
        <g transform={upright}>
          <text y={table.h < 40 ? 0 : -3} className="rm-floor-table-label" {...centred}>
            {table.label}
          </text>
          {table.h >= 40 && (
            <text y={12} className="rm-floor-table-seats" {...centred}>
              {table.seats} FŐ
            </text>
          )}
          {table.minTier && (
            <text x={table.w / 2 - 8} y={-table.h / 2 + 9} className="rm-floor-table-crown" {...centred}>
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
 * party, which need a House tier. Tap a table to select it.
 */
export const FloorMap: React.FC<Props> = ({plan, taken, at, slotMinutes, guests, tier, selectedId = null, onSelect, ownId = null, className = ''}) => {
  const tables = useMemo(
    () =>
      plan.tables.map((table) => {
        const state = tableState(table, at, slotMinutes, taken, guests, tier);
        const clashes = tableClashes(table, at, slotMinutes, taken) as HeldTable[];
        const zone = plan.zones.find((entry) => entry.id === table.zone)?.name;
        const held = clashes.map((clash) => `${hhmm(clash.from)}–${hhmm(clash.to)}${clash.code ? ` · ${clash.code} · ${clash.name}` : ''}`).join(', ');
        const title = `${table.label} · ${table.seats} fő${zone ? ` · ${zone}` : ''} · ${STATE_LABEL[state]}${held ? ` (${held})` : ''}`;
        return {table, state, title};
      }),
    [plan, at, slotMinutes, taken, guests, tier]
  );

  return (
    <div className={`rm-floor ${className}`}>
      <svg viewBox={`0 0 ${plan.width} ${plan.height}`} className="rm-floor-svg" role="img" aria-label={`${plan.name} alaprajza`}>
        <defs>
          <pattern id="rm-floor-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" className="rm-floor-grid-dot"/>
          </pattern>
          <pattern id="rm-floor-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="rm-floor-hatch-line"/>
          </pattern>
          <pattern id="rm-floor-checker" width="24" height="24" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" className="rm-floor-checker-cell"/>
            <rect x="12" y="12" width="12" height="12" className="rm-floor-checker-cell"/>
          </pattern>
          <radialGradient id="rm-floor-stage-glow">
            <stop offset="0" stopColor="#ff2b4f" stopOpacity="0.3"/>
            <stop offset="1" stopColor="#ff2b4f" stopOpacity="0"/>
          </radialGradient>
          <linearGradient id="rm-floor-bar" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3a1118"/>
            <stop offset="1" stopColor="#170a0d"/>
          </linearGradient>
          <filter id="rm-floor-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        <rect x="0" y="0" width={plan.width} height={plan.height} className="rm-floor-bg"/>
        <rect x="0" y="0" width={plan.width} height={plan.height} fill="url(#rm-floor-grid)"/>

        {plan.zones.map((zone) => (
          <g key={zone.id} className="rm-floor-zone">
            <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="10"/>
            <text x={zone.labelX ?? zone.x + 14} y={zone.labelY ?? zone.y + 20}>{zone.name.toUpperCase()}</text>
          </g>
        ))}

        {plan.features.map((feature) => (
          <Feature key={feature.id} feature={feature}/>
        ))}

        {tables.map(({table, state, title}) => (
          <Table
            key={table.id}
            table={table}
            state={state}
            selected={table.id === selectedId}
            own={table.id === ownId}
            filled={table.id === selectedId && guests ? Math.min(guests, table.seats) : 0}
            title={title}
            onSelect={onSelect}
          />
        ))}
      </svg>
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
