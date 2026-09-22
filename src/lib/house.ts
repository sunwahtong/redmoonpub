/**
 * The house's own particulars, as they appear on anything it issues.
 *
 * These are the values printed on every generated document: the letterhead,
 * the issuer block and the signature line. They live in one file so a document
 * can never disagree with another about who the business is.
 *
 * ── PLACEHOLDER DATA ───────────────────────────────────────────────────────
 * Everything below is stand-in data for the document proof of concept. Replace
 * it with the real particulars before anything is issued to a third party; the
 * shapes will not change, only the values.
 */

export interface Person {
  name: string;
  /** Identity card number, as printed on a document. */
  idNumber: string;
  phone: string;
  title: string;
}

export interface Business {
  name: string;
  /** The parent organisation the business belongs to. */
  parent: string;
  address: string;
  phone: string;
  /** Registration number shown in the letterhead. */
  registration: string;
  owner: Person;
}

export const HOUSE: Business = {
  name: 'Red Moon Pub',
  parent: 'Sun Wah Tong',
  address: 'Test Street 12.A, See City',
  phone: '+36 76 123 1234',
  registration: 'SC-RM-0001',
  owner: {
    name: 'Zhen Yu Xiao',
    idNumber: '123ownertest123',
    phone: '+36 76 123 1234',
    title: 'Tulajdonos'
  }
};

/**
 * Stand-in issuer used when the signed-in account has no identity data yet.
 *
 * The document engine prefers the real signed-in person; this only fills the
 * fields the account cannot supply — an identity number and a filed phone
 * number are not things the login carries.
 */
export const PLACEHOLDER_ISSUER: Person = {
  name: 'Liu Mei',
  idNumber: '123managertest123',
  phone: '+36 76 222 2222',
  title: 'Üzletvezető'
};

/** Rank titles as they should be printed, keyed by permission role. */
export const ROLE_TITLE: Record<string, string> = {
  owner: 'Tulajdonos',
  manager: 'Üzletvezető',
  staff: 'Alkalmazott',
  dj: 'Rezidens DJ'
};
