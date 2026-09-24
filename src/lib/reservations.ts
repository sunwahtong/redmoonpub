/** Shared reservation vocabulary. Mirrors the enums in server/routes/public.ts. */

export type ReservationOccasion = 'este' | 'szuletesnap' | 'uzleti' | 'randi' | 'csapat' | 'vip' | 'egyeb';
export type ReservationTier = 'none' | 'silver' | 'gold' | 'black' | 'royal';
export type ReservationStatus = 'pending' | 'reviewing' | 'waitlist' | 'confirmed' | 'declined' | 'seated' | 'cancelled' | 'noshow';

export interface ReservationMessage {
  id: string;
  at: string;
  author: 'guest' | 'staff';
  authorName: string;
  text: string;
  readByGuest: boolean;
  readByStaff: boolean;
}

export interface Reservation {
  id: string;
  code: string;
  at: string;
  when: string;
  name: string;
  phone: string;
  guests: number;
  occasion: ReservationOccasion;
  /** From the member's card at booking time, never from the form. */
  tier: ReservationTier;
  memberCode?: string;
  memberName?: string;
  /** The table asked for or assigned; empty means the house picks. */
  tableId?: string;
  tableLabel?: string;
  note: string;
  status: ReservationStatus;
  staffNote: string;
  handledAt: string | null;
  updatedAt?: string | null;
  handledByName?: string | null;
  /* Guest view: the thread and what is new in it. */
  messages?: ReservationMessage[];
  unread?: number;
  /* Staff view: counters for the list. */
  messageCount?: number;
  lastMessage?: {text: string; author: 'guest' | 'staff'} | null;
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
  pending: 'Beérkezett',
  reviewing: 'Nézzük',
  waitlist: 'Várólistán',
  confirmed: 'Visszaigazolva',
  declined: 'Nem tudjuk fogadni',
  seated: 'Leültetve',
  cancelled: 'Lemondva',
  noshow: 'Nem jelent meg'
};

/** One line under the status, for the guest. */
export const STATUS_HINT: Record<ReservationStatus, string> = {
  pending: 'Megkaptuk. Hamarosan ránéz valaki a házból.',
  reviewing: 'Egy manager épp a kérésedet nézi.',
  waitlist: 'Az este tele van. Ha felszabadul asztal, szólunk.',
  confirmed: 'Az asztal a tiéd. A bejáratnál az azonosítót kérjük.',
  declined: 'Erre az estére sajnos nem jutott asztal.',
  seated: 'Jó estét a Red Moonban.',
  cancelled: 'A foglalás megszűnt.',
  noshow: 'Az asztal harminc perc után felszabadult.'
};

/** Tailwind classes per status, so the badge reads the same everywhere. */
export const STATUS_CLASS: Record<ReservationStatus, string> = {
  pending: 'border-amber-500/40 text-amber-300',
  reviewing: 'border-sky-500/40 text-sky-300',
  waitlist: 'border-violet-500/40 text-violet-300',
  confirmed: 'border-emerald-500/40 text-emerald-300',
  declined: 'border-[color:var(--rm-line-red)] text-[color:var(--rm-red)]',
  seated: 'border-emerald-500/40 text-emerald-200',
  cancelled: 'border-white/15 text-[#8f8887]',
  noshow: 'border-white/15 text-[#8f8887]'
};

/** The stages a booking walks through, for the progress rail. */
export const PIPELINE: {id: string; label: string; statuses: ReservationStatus[]}[] = [
  {id: 'in', label: 'BEÉRKEZETT', statuses: ['pending']},
  {id: 'review', label: 'NÉZZÜK', statuses: ['reviewing', 'waitlist']},
  {id: 'decided', label: 'DÖNTÉS', statuses: ['confirmed', 'declined']},
  {id: 'night', label: 'AZ ESTE', statuses: ['seated', 'noshow']}
];

export const pipelineIndex = (status: ReservationStatus): number => {
  if (status === 'cancelled') return -1;
  return PIPELINE.findIndex((stage) => stage.statuses.includes(status));
};

/** A booking the guest can still act on. */
export const isLive = (status: ReservationStatus): boolean =>
  status === 'pending' || status === 'reviewing' || status === 'waitlist' || status === 'confirmed';

/** A booking whose thread is still open. */
export const canMessage = (status: ReservationStatus): boolean => !['cancelled', 'noshow', 'declined'].includes(status);
