import type {Capabilities, Role} from '../stores/useAuthStore';

export interface NavLink {
  to: string;
  label: string;
}

/** A link inside the header's dropdown panel, which has room to explain itself. */
export interface RichNavLink extends NavLink {
  /** One line of context, shown under the label. */
  description: string;
  /** Kanji watermark, matching the card treatment used across the site. */
  glyph: string;
}

export interface NavGroup {
  label: string;
  links: RichNavLink[];
}

/**
 * The header's top row.
 *
 * Deliberately short. The row previously carried every public page, which by
 * eight items plus two buttons had run out of width at 1280px — and the fix at
 * the time was to drop `/careers` into the footer, where nobody looked for it.
 * Anything that does not earn a permanent slot lives in the group below, which
 * is always one hover away rather than hidden.
 */
export const NAV_LINKS: NavLink[] = [
  {to: '/', label: 'FŐOLDAL'},
  {to: '/menu', label: 'ITALLAP'},
  {to: '/events', label: 'RENDEZVÉNYEK'},
  {to: '/club', label: 'RED MOON CLUB'}
];

/** The header dropdown. Every public page not in the top row is in here. */
export const NAV_GROUP: NavGroup = {
  label: 'A HÁZ',
  links: [
    {
      to: '/vip',
      label: 'THE HOUSE',
      glyph: '王',
      description: 'A négy tagsági szint, és ahogy meghívunk.'
    },
    {
      to: '/house',
      label: 'BELSŐ SZOBA',
      glyph: '門',
      description: 'Tagoknak: meghívások, titkos itallap, a ház vonala.'
    },
    {
      to: '/about',
      label: 'RÓLUNK',
      glyph: '家',
      description: 'A tulajdonosok, a managerek és a csapat.'
    },
    {
      to: '/gallery',
      label: 'GALÉRIA',
      glyph: '影',
      description: 'Esték a Red Moonból, ahogy megtörténtek.'
    },
    {
      to: '/location',
      label: 'LOKÁCIÓ',
      glyph: '図',
      description: 'A pontos helyünk SeeCity térképén.'
    },
    {
      to: '/hirek',
      label: 'HÍREK',
      glyph: '報',
      description: 'Ami történt a házban, és ami készül.'
    },
    {
      to: '/careers',
      label: 'CSATLAKOZZ',
      glyph: '募',
      description: 'Nyitott pozíciók és jelentkezés a csapatba.'
    }
  ]
};

/** The staff console and the booth — not the login page, which is public chrome with a public pill. */
export const isConsolePath = (pathname: string): boolean => pathname === '/staff' || pathname.startsWith('/staff/') || pathname === '/dj';

/** Everything public, flattened. The footer lists the lot. */
export const ALL_PUBLIC_LINKS: NavLink[] = [...NAV_LINKS, ...NAV_GROUP.links];

/**
 * The one action the header pushes. Kept out of NAV_LINKS so it can be styled
 * as a call to action rather than as another item in the row.
 */
export const RESERVE_LINK: NavLink = {to: '/reservations', label: 'ASZTALFOGLALÁS'};

export const STAFF_LINK: NavLink = {to: '/staff-login', label: 'STAFF'};

/* ------------------------------------------------------------------ */
/* Staff console                                                       */
/* ------------------------------------------------------------------ */

export interface StaffNavLink extends NavLink {
  /** Lowest role that may open it. Mirrors the RequireRole guard in App.tsx. */
  need: Role;
  /** A capability that opens it regardless of role (the DJ booth for the DJ job). */
  capability?: keyof Capabilities;
  /** Grouping in the console sub-header. */
  group: 'MŰSZAK' | 'VENDÉG' | 'KÉSZLET' | 'HÁZ';
}

/**
 * Persistent navigation for the staff console.
 *
 * The console used to be reachable only through a row of buttons on the
 * dashboard, so every move between two tools meant going back to `/staff`
 * first. `need` is duplicated from the route guards on purpose: the guard is
 * what enforces access, this is only what stops the UI offering a link that
 * would bounce the user.
 */
export const STAFF_NAV: StaffNavLink[] = [
  {to: '/staff', label: 'ÁTTEKINTÉS', need: 'staff', group: 'MŰSZAK'},
  {to: '/staff/shift', label: 'MŰSZAK', need: 'staff', group: 'MŰSZAK'},
  {to: '/staff/register', label: 'KASSZA', need: 'staff', group: 'MŰSZAK'},
  {to: '/staff/sales', label: 'ELADÁSOK', need: 'staff', group: 'MŰSZAK'},

  {to: '/staff/reservations', label: 'FOGLALÁSOK', need: 'staff', group: 'VENDÉG'},
  {to: '/staff/applications', label: 'JELENTKEZÉSEK', need: 'manager', group: 'VENDÉG'},
  {to: '/staff/members', label: 'A HOUSE', need: 'manager', group: 'VENDÉG'},

  {to: '/staff/orders', label: 'BESZERZÉS', need: 'staff', group: 'KÉSZLET'},
  {to: '/staff/inventory', label: 'RAKTÁR', need: 'manager', group: 'KÉSZLET'},
  {to: '/staff/products', label: 'TERMÉKEK', need: 'manager', group: 'KÉSZLET'},
  {to: '/staff/documents', label: 'BIZONYLATOK', need: 'manager', group: 'KÉSZLET'},

  {to: '/dj', label: 'DJ PULT', need: 'owner', capability: 'dj', group: 'HÁZ'},
  {to: '/staff/events', label: 'RENDEZVÉNYEK', need: 'owner', group: 'HÁZ'},
  {to: '/staff/showcase', label: 'KIRAKAT', need: 'owner', group: 'HÁZ'},
  {to: '/staff/gallery', label: 'GALÉRIA', need: 'owner', group: 'HÁZ'},
  {to: '/staff/posts', label: 'HÍREK', need: 'owner', group: 'HÁZ'},
  {to: '/staff/reports', label: 'JELENTÉSEK', need: 'owner', group: 'HÁZ'},
  {to: '/staff/users', label: 'FIÓKOK', need: 'owner', group: 'HÁZ'},
  {to: '/staff/audit', label: 'NAPLÓ', need: 'owner', group: 'HÁZ'},
  {to: '/staff/profile', label: 'PROFIL', need: 'staff', group: 'HÁZ'}
];
