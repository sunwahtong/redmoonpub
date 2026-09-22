import React, {useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronDown, Search} from 'lucide-react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  /** Small mark shown before the label, e.g. a kanji or an initial. */
  glyph?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  value: T | '';
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  /** Shows a filter box once there are more than a handful of options. */
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  /** Compact height for table rows. */
  size?: 'sm' | 'md';
  'aria-label'?: string;
}

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * A listbox in the house style, replacing the native `<select>`.
 *
 * The native control cannot be styled on any platform that matters and its
 * popup ignores the page's colours entirely. This one renders its list into a
 * portal, so it is never clipped by a scrolling panel, and follows the usual
 * keyboard grammar: arrows move, Enter picks, Escape closes, typing filters.
 */
export function Select<T extends string = string>({
  value,
  options,
  onChange,
  placeholder = 'Válassz…',
  searchable,
  disabled,
  className = '',
  size = 'md',
  'aria-label': ariaLabel
}: Props<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{top: number; left: number; width: number; up: boolean} | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const showSearch = searchable ?? options.length > 7;
  const selected = options.find((option) => option.value === value) || null;

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return options;
    return options.filter((option) => normalize(`${option.label} ${option.description || ''}`).includes(needle));
  }, [options, query]);

  const place = useCallback(() => {
    const node = buttonRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    const spaceBelow = window.innerHeight - box.bottom;
    const up = spaceBelow < 260 && box.top > spaceBelow;
    setRect({top: up ? box.top : box.bottom, left: box.left, width: box.width, up});
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const index = Math.max(0, visible.findIndex((option) => option.value === value));
    setActive(index);
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => (showSearch ? searchRef.current : listRef.current)?.focus(), 20);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || listRef.current?.parentElement?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, showSearch]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({block: 'nearest'});
  }, [active, open]);

  const choose = (option: SelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(visible.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = visible[active];
      if (option) choose(option);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
        className={`rm-select${open ? ' is-open' : ''}${size === 'sm' ? ' is-sm' : ''} ${className}`}
      >
        <span className={`rm-select-value${selected ? '' : ' is-placeholder'}`}>
          {selected?.glyph && (
            <span className="rm-select-glyph" aria-hidden="true">
              {selected.glyph}
            </span>
          )}
          <span className="truncate">{selected ? selected.label : placeholder}</span>
        </span>
        <ChevronDown size={13} className="rm-select-chevron" aria-hidden="true"/>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            className={`rm-select-pop${rect.up ? ' is-up' : ''}`}
            style={{top: rect.top, left: rect.left, width: Math.max(rect.width, 220)}}
            onKeyDown={onKeyDown}
          >
            {showSearch && (
              <label className="rm-select-search">
                <Search size={12} aria-hidden="true"/>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  placeholder="Szűrés…"
                  aria-label="Szűrés"
                />
              </label>
            )}
            <div ref={listRef} id={`${id}-list`} role="listbox" tabIndex={-1} className="rm-select-list">
              {visible.length === 0 && <div className="rm-select-empty">Nincs találat.</div>}
              {visible.map((option, index) => (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled}
                  data-index={index}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={`rm-select-option${index === active ? ' is-active' : ''}${option.value === value ? ' is-selected' : ''}${option.disabled ? ' is-disabled' : ''}`}
                >
                  {option.glyph && (
                    <span className="rm-select-glyph" aria-hidden="true">
                      {option.glyph}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.description && <span className="rm-select-desc">{option.description}</span>}
                  </span>
                  {option.value === value && <Check size={12} className="shrink-0 text-[color:var(--rm-red)]"/>}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
