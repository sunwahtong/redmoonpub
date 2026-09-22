/** Shared reservation vocabulary. Mirrors the enums in server.cjs. */

export type ReservationOccasion = 'este' | 'szuletesnap' | 'uzleti' | 'randi' | 'csapat' | 'vip' | 'egyeb';
export type ReservationTier = 'none' | 'silver' | 'gold' | 'black' | 'royal';
export type ReservationStatus = 'pending' | 'confirmed' | 'declined' | 'seated' | 'cancelled' | 'noshow';

export interface Reservation {
  id: string;
  code: string;
  at: string;
  when: string;
  name: string;
  phone: string;
  guests: number;
  occasion: ReservationOccasion;
  tier: ReservationTier;
  note: string;
  status: ReservationStatus;
  staffNote: string;
  handledAt: string | null;
  handledByName?: string | null;
}

export const OCCASION_LABEL: Record<ReservationOccasion, string> = {
  este: 'Egy este a Red Moonban',
  szuletesnap: 'Születésnap',
  uzleti: 'Üzleti vacsora',
  randi: 'Randi',
  csapat: 'Csapatest',
  vip: 'VIP alkalom',
  egyeb: 'Egyéb'
};

export const OCCASION_GLYPH: Record<ReservationOccasion, string> = {
  este: '夜',
  szuletesnap: '祝',
  uzleti: '商',
  randi: '恋',
  csapat: '仲',
  vip: '王',
  egyeb: '他'
};

export const TIER_LABEL: Record<ReservationTier, string> = {
  none: 'Nincs tagságom',
  silver: 'Silver',
  gold: 'Gold',
  black: 'Black',
  royal: 'Royal'
};

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: 'Elbírálás alatt',
  confirmed: 'Visszaigazolva',
  declined: 'Elutasítva',
  seated: 'Leültetve',
  cancelled: 'Lemondva',
  noshow: 'Nem jelent meg'
};

/** Tailwind classes per status, so the badge reads the same everywhere. */
export const STATUS_CLASS: Record<ReservationStatus, string> = {
  pending: 'border-amber-500/40 text-amber-300',
  confirmed: 'border-emerald-500/40 text-emerald-300',
  declined: 'border-[color:var(--rm-line-red)] text-[color:var(--rm-red)]',
  seated: 'border-sky-500/40 text-sky-300',
  cancelled: 'border-white/15 text-[#8f8887]',
  noshow: 'border-white/15 text-[#8f8887]'
};

/** A booking the guest can still act on. */
export const isLive = (status: ReservationStatus): boolean =>
  status === 'pending' || status === 'confirmed';
