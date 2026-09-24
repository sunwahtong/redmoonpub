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
  /** The media store's id of an uploaded cover, empty for a site path. */
  coverPublicId?: string;
  /** Entry fee in Ft; null or 0 means free. */
  entryFee?: number | null;
  dressCode?: string;
  /** Pinned to the top of the home page. */
  featured?: boolean;
  active?: boolean;
  createdByName?: string;
  /** Guests who said they will be there. */
  going?: number;
}

/** A news post the owner wrote for the public site. */
export interface Post {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
  imagePublicId: string;
  pinned: boolean;
  active: boolean;
  publishedAt: string | null;
  createdByName: string;
  updatedAt: string | null;
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
  /** The owner's featured YouTube clip for the home page, or null. */
  video: {id: string; title: string; caption: string} | null;
  /** House membership, counted. */
  members?: {total: number; byTier: Record<'silver' | 'gold' | 'black' | 'royal', number>};
}

export type GalleryTag = 'ter' | 'este' | 'jel';

export interface GalleryItem {
  id: string;
  title: string;
  caption: string;
  tag: GalleryTag;
  src: string;
  width: number;
  height: number;
  sortOrder: number;
  active: boolean;
  createdAt: string | null;
}
