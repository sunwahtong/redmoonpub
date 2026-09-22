import React, {useCallback, useEffect} from 'react';
import {ChevronLeft, ChevronRight, X} from 'lucide-react';

export interface LightboxItem {
  src: string;
  title: string;
  caption?: string;
}

interface Props {
  items: LightboxItem[];
  index: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export const Lightbox: React.FC<Props> = ({items, index, onClose, onNavigate}) => {
  const open = index !== null && index >= 0 && index < items.length;

  const step = useCallback(
    (delta: number) => {
      if (index === null || items.length === 0) return;
      onNavigate((index + delta + items.length) % items.length);
    },
    [index, items.length, onNavigate]
  );

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') step(1);
      else if (event.key === 'ArrowLeft') step(-1);
    };

    // Freeze the page behind the overlay so scrolling does not leak through.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, step]);

  if (!open) return null;
  const item = items[index as number];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/92 p-6 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Bezárás"
        className="absolute right-6 top-6 border border-white/15 bg-black/50 p-2.5 text-white backdrop-blur-sm transition-colors hover:border-rm-red hover:text-rm-red"
      >
        <X size={18}/>
      </button>

      {items.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Előző kép"
            onClick={(event) => {
              event.stopPropagation();
              step(-1);
            }}
            className="absolute left-4 border border-white/15 bg-black/50 p-3 text-white backdrop-blur-sm transition-colors hover:border-rm-red hover:text-rm-red md:left-10"
          >
            <ChevronLeft size={20}/>
          </button>
          <button
            type="button"
            aria-label="Következő kép"
            onClick={(event) => {
              event.stopPropagation();
              step(1);
            }}
            className="absolute right-4 border border-white/15 bg-black/50 p-3 text-white backdrop-blur-sm transition-colors hover:border-rm-red hover:text-rm-red md:right-10"
          >
            <ChevronRight size={20}/>
          </button>
        </>
      )}

      <img
        src={item.src}
        alt={item.title}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[75vh] max-w-full border border-[color:var(--rm-line)] object-contain shadow-[0_30px_90px_rgba(0,0,0,0.9)]"
      />

      <div className="mt-6 text-center" onClick={(event) => event.stopPropagation()}>
        <h3 className="font-heading text-xl tracking-wide text-white">{item.title}</h3>
        {item.caption && <p className="mt-1 text-xs text-[#8e7e86]">{item.caption}</p>}
        <p className="mt-3 text-[10px] tracking-[0.25em] text-[#6d5d64]">
          {(index as number) + 1} / {items.length}
        </p>
      </div>
    </div>
  );
};
