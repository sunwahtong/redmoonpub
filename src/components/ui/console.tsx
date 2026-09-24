import React from 'react';
import {Search} from 'lucide-react';
import {NeonHeading} from './NeonHeading';
import {assetUrl} from '../../lib/api';

/**
 * The console's building blocks.
 *
 * Every staff page used to hand-roll the same header, stat tile, filter row
 * and input classes with small drifts between them. These are the shared
 * versions, so a page is assembled rather than styled.
 */

/** Text input / textarea in the house style. */
export const inputClass = 'rm-input';

export const PageHeader: React.FC<{
  kicker: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({kicker, title, lead, actions, className = ''}) => (
  <div className={`mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between ${className}`} data-tour="page">
    <div className="min-w-0">
      <div className="rm-label">{kicker}</div>
      <NeonHeading as="h1" size={2} className="mt-3.5">
        {title}
      </NeonHeading>
      {lead && <p className="rm-lead mt-3 max-w-xl text-[12px]">{lead}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
  </div>
);

export const SectionTitle: React.FC<{label: string; title: string; action?: React.ReactNode; className?: string}> = ({
  label,
  title,
  action,
  className = ''
}) => (
  <div className={`mb-5 mt-14 flex flex-wrap items-end justify-between gap-4 ${className}`}>
    <div>
      <span className="rm-label">{label}</span>
      <h2 className="mt-2 font-heading text-[24px] leading-none text-white">{title}</h2>
    </div>
    {action}
  </div>
);

export const Panel: React.FC<{
  label?: string;
  title?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /** Adds the standard inner padding. Off for lists that draw their own rows. */
  padded?: boolean;
  tone?: 'default' | 'red';
  /** A `data-tour` name, so the guided tour can light the panel up. */
  tour?: string;
}> = ({label, title, action, children, className = '', padded = true, tone = 'default', tour}) => (
  <section className={`rm-card ${tone === 'red' ? 'border-[color:var(--rm-line-red)]' : ''} ${padded ? 'p-6 md:p-7' : 'p-0'} ${className}`} data-tour={tour}>
    {(label || title || action) && (
      <div className={`flex flex-wrap items-start justify-between gap-3 ${padded ? 'mb-5' : 'border-b border-[color:var(--rm-line)] px-6 py-4'}`}>
        <div className="min-w-0">
          {label && <span className="rm-label">{label}</span>}
          {title && <h3 className={`font-heading text-[20px] leading-tight text-white ${label ? 'mt-2' : ''}`}>{title}</h3>}
        </div>
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Stat: React.FC<{
  icon?: React.ElementType;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  glyph?: string;
  tone?: 'default' | 'warn' | 'good';
  className?: string;
}> = ({icon: Icon, label, value, hint, glyph, tone = 'default', className = ''}) => (
  <div className={`rm-stat p-6 ${className}`}>
    {glyph && (
      <span className="rm-stat-glyph" aria-hidden="true">
        {glyph}
      </span>
    )}
    {Icon && (
      <Icon
        size={15}
        className={`relative mb-4 ${tone === 'warn' ? 'text-amber-400' : tone === 'good' ? 'text-emerald-400' : 'text-[color:var(--rm-red)]'}`}
      />
    )}
    <span className="relative block text-[8px] tracking-[0.25em] text-[#777]">{label}</span>
    <strong className="relative mt-2 block font-heading text-[26px] leading-none text-white">{value}</strong>
    {hint && <span className="relative mt-2 block text-[10px] text-[#8d8584]">{hint}</span>}
  </div>
);

export interface ChipOption<T extends string> {
  id: T;
  label: string;
  count?: number;
}

/** Segmented filter buttons. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  className = ''
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`} role="tablist">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rm-chip${value === option.id ? ' is-active' : ''}`}
        >
          {option.label}
          {option.count !== undefined && <span className="rm-chip-count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const SearchField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}> = ({value, onChange, placeholder = 'KERESÉS…', className = ''}) => (
  <label className={`relative flex w-full items-center ${className}`}>
    <Search size={14} className="pointer-events-none absolute left-4 text-[#6d5d64]"/>
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="rm-input rm-search text-[10px] tracking-[0.15em]"
    />
  </label>
);

export const Field: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}> = ({label, hint, children, className = ''}) => (
  <label className={`flex flex-col gap-2 ${className}`}>
    <span className="text-[8px] tracking-[0.25em] text-[#777]">{label}</span>
    {children}
    {hint && <span className="text-[9px] leading-[1.6] text-[#6f6968]">{hint}</span>}
  </label>
);

export const Badge: React.FC<{tone?: 'red' | 'muted' | 'good' | 'warn' | 'sky'; children: React.ReactNode; className?: string}> = ({
  tone = 'muted',
  children,
  className = ''
}) => {
  const tones = {
    red: 'border-[color:var(--rm-line-red)] text-[color:var(--rm-red)]',
    muted: 'border-white/15 text-[#8f8887]',
    good: 'border-emerald-500/40 text-emerald-300',
    warn: 'border-amber-500/40 text-amber-300',
    sky: 'border-sky-500/40 text-sky-300'
  };
  return <span className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-[8px] tracking-[0.18em] ${tones[tone]} ${className}`}>{children}</span>;
};

export const EmptyRow: React.FC<{children: React.ReactNode}> = ({children}) => (
  <p className="px-6 py-6 text-[11px] text-[#8d8584]">{children}</p>
);

/** Circular avatar: the uploaded picture, or a monogram over the ruby bloom. */
export const Avatar: React.FC<{name: string; nickname?: string; src?: string; size?: number; className?: string}> = ({
  name,
  nickname,
  src,
  size = 40,
  className = ''
}) => {
  const monogram = (nickname || name || '?').slice(0, 2).toUpperCase();
  return src ? (
    <img
      src={assetUrl(src)}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-full border border-[rgba(213,31,60,0.4)] object-cover ${className}`}
      style={{width: size, height: size}}
    />
  ) : (
    <span
      className={`grid shrink-0 place-items-center rounded-full border border-[rgba(213,31,60,0.4)] bg-[radial-gradient(circle,#250811,#09090b_70%)] font-heading text-white ${className}`}
      style={{width: size, height: size, fontSize: Math.max(10, size * 0.32)}}
      aria-hidden="true"
    >
      {monogram}
    </span>
  );
};
