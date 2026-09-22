import React from 'react';
import {AlertTriangle, Check, Info, X} from 'lucide-react';
import {useToastStore, type ToastKind} from '../../stores/useToastStore';

const ICON: Record<ToastKind, React.ReactNode> = {
  success: <Check size={13}/>,
  error: <AlertTriangle size={13}/>,
  info: <Info size={13}/>
};

const TINT: Record<ToastKind, string> = {
  success: 'text-emerald-400',
  error: 'text-[color:var(--rm-red)]',
  info: 'text-white/60'
};

/**
 * Renders the toast stack.
 *
 * `role="status"` with `aria-live="polite"` rather than `alert`: these confirm
 * something the visitor just did, so they should be announced after whatever
 * the screen reader is already saying, not cut across it.
 */
export const Toaster: React.FC = () => {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (!toasts.length) return null;

  return (
    <div className="rm-toasts" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className="rm-toast" data-kind={item.kind}>
          <span className={`mt-[1px] shrink-0 ${TINT[item.kind]}`} aria-hidden="true">
            {ICON[item.kind]}
          </span>

          <div className="min-w-0 flex-1">
            <strong className="block text-[10px] font-bold tracking-[0.16em] text-white">{item.title}</strong>
            {item.message && (
              <p className="mt-1.5 text-[10px] leading-[1.7] text-[#9e9795]">{item.message}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => dismiss(item.id)}
            aria-label="Bezárás"
            className="shrink-0 text-[#6f6968] transition-colors hover:text-white"
          >
            <X size={12}/>
          </button>

          <span
            className={`rm-toast-bar ${TINT[item.kind]}`}
            style={{animationDuration: `${item.duration}ms`}}
            aria-hidden="true"
          />
        </div>
      ))}
    </div>
  );
};
