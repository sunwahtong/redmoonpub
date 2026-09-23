/** Shared recruitment vocabulary. Mirrors the enums in server/routes/public.ts. */

/** Every position that ever existed, so old applications still have a label. */
export type CareerPosition = 'bartender' | 'pultos' | 'felszolgalo' | 'dj' | 'biztonsag' | 'hostess' | 'uzletvezeto';

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
 * The roles the house recruits for right now. Copy lives here rather than in
 * the page so the careers page, the staff console and any future listing all
 * read the same words.
 */
export const POSITIONS: PositionInfo[] = [
  {
    id: 'bartender',
    name: 'BARTENDER',
    glyph: '酒',
    tagline: 'A pult mögött te vagy az este.',
    duties: ['Signature koktélok keverése', 'Vendégek kiszolgálása a pultnál', 'A pult rendje és készlete', 'Eladások rögzítése a konzolon'],
    looking: 'Nyugodt kéz, jó memória, és az a fajta ember, akivel szívesen beszélgetnek éjfél után.'
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
  }
];

/** Labels for every position, including the ones no longer advertised. */
export const POSITION_LABEL: Record<CareerPosition, string> = {
  bartender: 'BARTENDER',
  pultos: 'KASSZÁS',
  felszolgalo: 'FELSZOLGÁLÓ',
  dj: 'DJ',
  biztonsag: 'BIZTONSÁG',
  hostess: 'HOSTESS',
  uzletvezeto: 'MANAGER'
};

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
