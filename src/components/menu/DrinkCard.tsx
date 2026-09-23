import React, {useState} from 'react';
import {Heart} from 'lucide-react';
import {TiltCard} from '../ui/TiltCard';
import {assetUrl, formatHuf} from '../../lib/api';
import {sectionLabel} from '../../lib/sections';
import {useFavorites} from '../../lib/favorites';
import type {PublicProduct} from '../../types';

interface Props {
  product: PublicProduct;
  /** Zero-based position, rendered as the "01 /" card number. */
  index: number;
}

/**
 * Legacy `.drink-card` / `.rm17-drink`: square frame, ruby bloom behind the
 * bottle, 月 watermark, big Cinzel name and a red Cinzel price.
 *
 * The bottle and the price sit on `rm-tilt-layer`, so as the card turns toward
 * the pointer they stand off the surface rather than sliding with it — which is
 * what sells the depth. The price rule draws itself in on hover.
 */
export const DrinkCard: React.FC<Props> = ({product, index}) => {
  const [failed, setFailed] = useState(false);
  const src = assetUrl(product.image);
  const favorite = useFavorites((state) => state.ids.includes(product.id));
  const toggleFavorite = useFavorites((state) => state.toggle);

  return (
    <TiltCard className="h-full" max={6}>
      <article className="rm-card group flex h-full flex-col overflow-hidden">
        <div className="relative flex h-60 items-center justify-center overflow-hidden px-6 pt-6">
          <span className="rm-glyph">月</span>

          <span className="absolute left-6 top-6 z-20 text-[8px] font-bold tracking-[0.2em] text-[#777]">
            {String(index + 1).padStart(2, '0')} / {sectionLabel(product.section)}
          </span>
          <button
            type="button"
            onClick={() => toggleFavorite(product.id)}
            className={`rm-fav${favorite ? ' is-on' : ''}`}
            aria-pressed={favorite}
            aria-label={favorite ? 'Kedvencek közül eltávolítás' : 'Kedvencekhez'}
            title={favorite ? 'Kedvenc' : 'Kedvencekhez'}
          >
            <Heart size={13}/>
          </button>

          <div
            className="pointer-events-none absolute h-32 w-32 rounded-full bg-[rgba(213,31,60,0.24)] blur-3xl transition-transform duration-500 group-hover:scale-125"
            aria-hidden="true"
          />

          {src && !failed ? (
            <img
              src={src}
              alt={product.name}
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
              className="rm-tilt-layer relative z-10 max-h-44 object-contain drop-shadow-[0_12px_20px_rgba(0,0,0,0.6)] transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="rm-tilt-layer relative z-10 flex flex-col items-center gap-2 text-[#8e7e86]">
              <span className="font-heading text-5xl text-[rgba(213,31,60,0.7)]">月</span>
              <small className="text-[9px] tracking-[0.2em]">RED MOON ITAL</small>
            </div>
          )}
        </div>

        <div className="relative z-[1] flex flex-1 flex-col justify-between gap-4 p-7 pt-4 text-left">
          <div>
            <h3 className="font-heading text-[22px] leading-tight text-white transition-colors duration-300 group-hover:text-[color:var(--rm-red-bright)]">
              {product.name}
            </h3>
            <p className="mt-2 text-[10px] text-[#938b8b]">{product.subtitle || 'Red Moon Pub · See City'}</p>
          </div>
          <div>
            <strong className="rm-price font-heading text-[18px] text-[color:var(--rm-red)]">
              {formatHuf(product.price)}
            </strong>
            <small className="mt-2.5 block text-[8px] tracking-wider text-[#6d5d64]">
              Áraink az ÁFÁ-t tartalmazzák.
            </small>
          </div>
        </div>
      </article>
    </TiltCard>
  );
};
