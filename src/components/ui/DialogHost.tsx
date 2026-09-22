import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertTriangle, X} from 'lucide-react';
import {useDialogStore} from '../../stores/useDialogStore';
import {playSfx} from '../../lib/sfx';

/**
 * Renders the front dialog of the queue.
 *
 * One host, mounted once in App. Focus moves into the dialog on open and back
 * to the element that had it on close; Escape cancels, Enter confirms a
 * prompt, and the page behind is inert to the pointer and the scroll wheel.
 */
export const DialogHost: React.FC = () => {
  const current = useDialogStore((state) => state.queue[0]);
  const settle = useDialogStore((state) => state.settle);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const key = current ? `${current.kind}:${current.options.title}` : '';

  useEffect(() => {
    if (!current) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    setError(null);
    setValue(current.kind === 'prompt' ? current.options.initial || '' : '');
    playSfx('open');
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      if (current.kind === 'prompt') inputRef.current?.focus();
      else confirmRef.current?.focus();
    }, 30);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previous;
      restoreRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current) return null;

  const tone = current.options.tone || 'default';

  const cancel = () => {
    if (current.kind === 'confirm') settle(false);
    else if (current.kind === 'prompt') settle(null);
    else settle(undefined);
  };

  const confirm = () => {
    if (current.kind === 'prompt') {
      const problem = current.options.validate?.(value) || null;
      if (problem) {
        setError(problem);
        playSfx('error');
        return;
      }
      settle(value);
      return;
    }
    if (current.kind === 'confirm') settle(true);
    else settle(undefined);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    confirm();
  };

  const confirmLabel =
    current.options.confirmLabel || (current.kind === 'alert' ? 'RENDBEN' : current.kind === 'prompt' ? 'MENTÉS' : 'IGEN');
  const cancelLabel = current.kind === 'alert' ? null : (current.options as {cancelLabel?: string}).cancelLabel || 'MÉGSE';

  return createPortal(
    <div className="rm-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && cancel()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="rm-dialog-title"
        className={`rm-dialog${tone === 'danger' ? ' is-danger' : ''}`}
        onSubmit={submit}
      >
        <span className="rm-dialog-glyph" aria-hidden="true">
          {tone === 'danger' ? '危' : current.kind === 'prompt' ? '筆' : '月'}
        </span>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="rm-label">{tone === 'danger' ? 'FIGYELEM' : 'RED MOON'}</span>
            <h2 id="rm-dialog-title" className="mt-2 font-heading text-[22px] leading-tight text-white">
              {current.options.title}
            </h2>
          </div>
          <button type="button" onClick={cancel} aria-label="Bezárás" className="rm-dialog-close">
            <X size={15}/>
          </button>
        </div>

        {current.options.message && (
          <p className="mt-3 text-[11.5px] leading-[1.8] text-[#a09998]">{current.options.message}</p>
        )}
        {'detail' in current.options && current.options.detail && (
          <p className="mt-3 border-l border-[color:var(--rm-line-red)] pl-3 text-[11px] leading-[1.7] text-[#c9c2c1]">
            {current.options.detail}
          </p>
        )}

        {current.kind === 'prompt' && (
          <label className="mt-5 flex flex-col gap-2">
            {current.options.label && (
              <span className="text-[8px] tracking-[0.25em] text-[#777]">{current.options.label}</span>
            )}
            {current.options.type === 'textarea' ? (
              <textarea
                ref={(node) => {
                  inputRef.current = node;
                }}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={current.options.placeholder}
                maxLength={current.options.maxLength}
                rows={3}
                className="rm-input"
              />
            ) : (
              <input
                ref={(node) => {
                  inputRef.current = node;
                }}
                type={current.options.type || 'text'}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={current.options.placeholder}
                maxLength={current.options.maxLength}
                autoComplete={current.options.type === 'password' ? 'new-password' : 'off'}
                className="rm-input"
              />
            )}
          </label>
        )}

        {error && (
          <p role="alert" className="mt-3 flex items-center gap-2 text-[10.5px] text-[color:var(--rm-red)]">
            <AlertTriangle size={12}/> {error}
          </p>
        )}

        <div className="mt-7 flex flex-wrap justify-end gap-2.5">
          {cancelLabel && (
            <button type="button" onClick={cancel} className="rm-btn">
              {cancelLabel}
            </button>
          )}
          <button ref={confirmRef} type="submit" className={`rm-btn ${tone === 'danger' ? 'is-danger' : 'is-red'}`}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
};
