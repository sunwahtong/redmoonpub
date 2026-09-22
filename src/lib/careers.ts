/** Shared recruitment vocabulary. Mirrors the enums in server.cjs. */

export type CareerPosition =
  | 'bartender'
  | 'pultos'
  | 'felszolgalo'
  | 'dj'
  | 'biztonsag'
  | 'hostess'
  | 'uzletvezeto';

export type CareerStatus = 'pending' | 'interview' | 'accepted' | 'rejected' | 'withdrawn';

export interface Application {
  id: string;
  code: string;
  at: string;
  name: string;
  phone: string;
  age: number;
  position: CareerPosition;
  status: CareerStatus;
  staffNote: string;
  handledAt: string | null;
  /* Manager view only — the candidate never gets these back. */
  /** Radio frequency the applicant can be reached on. */
  radio?: string;
  availability?: string;
  experience?: string;
  why?: string;
  handledByName?: string | null;
}

export interface PositionInfo {
  id: CareerPosition;
  name: string;
  glyph: string;
  tagline: string;
  duties: string[];
  /** Shown as the honest expectation, not a promise. */
  looking: string;
}

/**
 * The roles the house recruits for.
 *
 * Copy lives here rather than in the page so the careers page, the staff
 * console and any future listing all read the same words.
 */
export const POSITIONS: PositionInfo[] = [
  {
    id: 'bartender',
    name: 'BARTENDER',
    glyph: '酒',
    tagline: 'A pult mögött te vagy az este.',
    duties: ['Signature koktélok keverése', 'Vendégek kiszolgálása a pultnál', 'A pult rendje és készlete'],
    looking: 'Nyugodt kéz, jó memória, és az a fajta ember, akivel szívesen beszélgetnek éjfél után.'
  },
  {
    id: 'pultos',
    name: 'KASSZÁS',
    glyph: '銭',
    tagline: 'A kassza pontossága a ház bizalma.',
    duties: ['Eladások rögzítése a konzolon', 'Nyugták és számlák kezelése', 'Műszakzárás egyeztetése'],
    looking: 'Pontosság. Egy elrontott műszakzárás mindenki estéjét elviszi.'
  },
  {
    id: 'felszolgalo',
    name: 'FELSZOLGÁLÓ',
    glyph: '侍',
    tagline: 'Az asztaloknál dől el, milyen volt az este.',
    duties: ['Asztalok kiszolgálása', 'Foglalások fogadása a bejáratnál', 'Kapcsolattartás a pulttal'],
    looking: 'Gyors láb, figyelem a részletekre, és türelem a hosszú estékhez.'
  },
  {
    id: 'dj',
    name: 'DJ',
    glyph: '音',
    tagline: 'A Red Moon hangja.',
    duties: ['Élő szettek a DJ pultból', 'Vendégkérések kezelése', 'A ház hangulatának tartása'],
    looking: 'Saját ízlés, ami mégis olvassa a termet. Nem playlistet keresünk, hanem DJ-t.'
  },
  {
    id: 'biztonsag',
    name: 'BIZTONSÁG',
    glyph: '守',
    tagline: 'Hogy az este végig este maradjon.',
    duties: ['Bejárat és vendéglista', 'Konfliktusok kezelése', 'A ház szabályainak érvényesítése'],
    looking: 'Hideg fej. Aki nem eszkalál, hanem lezár.'
  },
  {
    id: 'hostess',
    name: 'HOSTESS',
    glyph: '迎',
    tagline: 'Az első benyomás.',
    duties: ['Vendégek fogadása', 'Asztalhoz kísérés', 'Foglalások egyeztetése'],
    looking: 'Megjelenés és modor. Te vagy az első, akit a Red Moonból látnak.'
  },
  {
    id: 'uzletvezeto',
    name: 'ÜZLETVEZETŐ',
    glyph: '長',
    tagline: 'A műszak a te felelősséged.',
    duties: ['Műszakok szervezése és zárása', 'Raktár és beszerzés', 'A csapat irányítása'],
    looking: 'Vezetői tapasztalat a házon belülről. Ezt a szintet jellemzően belülről töltjük be.'
  }
];

export const POSITION_LABEL: Record<CareerPosition, string> = POSITIONS.reduce(
  (map, position) => ({...map, [position.id]: position.name}),
  {} as Record<CareerPosition, string>
);

export const STATUS_LABEL: Record<CareerStatus, string> = {
  pending: 'Elbírálás alatt',
  interview: 'Interjúra hívva',
  accepted: 'Felvéve',
  rejected: 'Elutasítva',
  withdrawn: 'Visszavonva'
};

export const STATUS_CLASS: Record<CareerStatus, string> = {
  pending: 'border-amber-500/40 text-amber-300',
  interview: 'border-sky-500/40 text-sky-300',
  accepted: 'border-emerald-500/40 text-emerald-300',
  rejected: 'border-[color:var(--rm-line-red)] text-[color:var(--rm-red)]',
  withdrawn: 'border-white/15 text-[#8f8887]'
};

/** An application the candidate can still withdraw. */
export const isOpen = (status: CareerStatus): boolean => status === 'pending' || status === 'interview';
