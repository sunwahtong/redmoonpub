/** Shapes returned by the public endpoints of the API. */

export type DrinkSection = 'beer' | 'wine' | 'spirits' | 'nonalcoholic' | 'accessories' | 'other';

export interface PublicProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  subtitle: string;
  description?: string;
  section: DrinkSection;
}

export interface SignatureDrink {
  id: string;
  name: string;
  image: string;
  description: string;
  slot: number;
}

export interface RedMoonEvent {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  place: string;
  startsAt: string;
  endsAt: string | null;
  /** Short badge, e.g. "LIVE DJ" or "TEMATIKUS EST". */
  tag?: string;
  coverImage?: string;
  /** Entry fee in Ft; null or 0 means free. */
  entryFee?: number | null;
  dressCode?: string;
  /** Pinned to the top of the home page. */
  featured?: boolean;
  active?: boolean;
  createdByName?: string;
}

export interface Review {
  id: string;
  name: string;
  rating: number;
  text: string;
  phone: string;
  at: string;
  status: string;
  isOwn: boolean;
}

export interface HousePerson {
  id: string;
  name: string;
  title: string;
  note: string;
  monogram: string;
  tier: 'owner' | 'co-owner' | 'manager' | 'staff';
}

export interface PublicHouse {
  house: {name: string; address: string; phone: string; registration: string};
  people: HousePerson[];
}
