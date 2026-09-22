/**
 * The house's own particulars, as they appear on anything it issues.
 *
 * The real values live in the database and are edited by the owner in the
 * console (Kirakat → A ház adatai). What is here is only the shape, plus a
 * fallback used while the first request is still in flight.
 */

export interface Person {
  name: string;
  /** Identity card number, as printed on a document. */
  idNumber: string;
  phone: string;
  title: string;
  /** Stored signature, ready to embed. */
  signatureSvg?: string | null;
}

export interface Business {
  name: string;
  address: string;
  phone: string;
  registration: string;
  hourlyWage?: number;
}

export const HOUSE_FALLBACK: Business = {
  name: 'Red Moon Pub',
  address: '',
  phone: '',
  registration: ''
};

/** Rank titles as they should be printed, keyed by permission role. */
export const ROLE_TITLE: Record<string, string> = {
  owner: 'Tulajdonos',
  manager: 'Üzletvezető',
  staff: 'Alkalmazott'
};
