/** Shapes returned by the public endpoints of server.cjs. */

export type DrinkSection = 'beer' | 'wine' | 'spirits' | 'nonalcoholic' | 'accessories' | 'other';

export interface PublicProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  subtitle: string;
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
  description: string;
  place: string;
  startsAt: string;
  endsAt: string | null;
  active?: boolean;
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
