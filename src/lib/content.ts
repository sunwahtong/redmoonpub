/**
 * Static house content shared by several pages. The legacy site kept these
 * blocks hand-copied into index.html and about.html, which is how the two
 * pages drifted apart over time.
 */

/**
 * The membership ladder. One definition, used by the home page teaser, the
 * about page and the dedicated /vip page.
 *
 * It replaced a shorter `VIP_TIERS` list that the home and about pages each
 * rendered separately — the same split that let the legacy index.html and
 * about.html drift apart in the first place.
 */
export interface MembershipTier {
  id: 'silver' | 'gold' | 'black' | 'royal';
  no: string;
  name: string;
  glyph: string;
  tagline: string;
  /** Hungarian, one line each. Shown as a checked list. */
  perks: string[];
  /** Roughly what it takes to be offered this tier. */
  path: string;
  featured?: boolean;
}

export const MEMBERSHIP: MembershipTier[] = [
  {
    id: 'silver',
    no: '01',
    name: 'SILVER',
    glyph: '銀',
    tagline: 'Az első lépés a House világába.',
    perks: [
      'Elsőbbség az asztalfoglalásnál',
      'Meghívó a havi Red Moon estére',
      'A signature itallap ajánlásai',
      'Saját üdvözlés érkezéskor'
    ],
    path: 'Három látogatás után a ház ajánlja fel.'
  },
  {
    id: 'gold',
    no: '02',
    name: 'GOLD',
    glyph: '金',
    tagline: 'Exkluzív italok és meghívásos programok.',
    perks: [
      'Minden Silver előny',
      'Exkluzív signature italok, itallapon kívül',
      'Meghívásos tematikus estek',
      'Fenntartott asztal telt estéken is',
      'A DJ pult kérései elsőbbséget kapnak'
    ],
    path: 'A Silver kör aktív tagjainak, üzletvezetői ajánlással.',
    featured: true
  },
  {
    id: 'black',
    no: '03',
    name: 'BLACK',
    glyph: '黑',
    tagline: 'Privát hangulat, Red Moon priority.',
    perks: [
      'Minden Gold előny',
      'Privát sarok, saját kiszolgálással',
      'Zárás utáni meghívások',
      'Saját kapcsolattartó a házból',
      'Rendezvény szervezése kedvezménnyel'
    ],
    path: 'Kizárólag meghívásos, a tulajdonosok döntése alapján.'
  },
  {
    id: 'royal',
    no: '04',
    name: 'ROYAL',
    glyph: '王',
    tagline: 'A House legbelső köre.',
    perks: [
      'Minden Black előny',
      'A Red Moon egy estére a tiéd',
      'Saját signature ital a lapon, a te neveddel',
      'Korlátlan vendéglista',
      'Közvetlen vonal a tulajdonoshoz'
    ],
    path: 'Nem lehet kérni. Felajánljuk, vagy nem.'
  }
];

export interface HouseStat {
  value: number;
  decimals?: number;
  suffix?: string;
  label: string;
}

/** Headline numbers for the membership page. */
export const HOUSE_STATS: HouseStat[] = [
  {value: 4, label: 'TAGSÁGI SZINT'},
  {value: 24, suffix: '/7', label: 'NYITVA AZ ÉJSZAKÁNAK'},
  {value: 100, suffix: '%', label: 'SAJÁT RECEPTÚRA'},
  {value: 1, label: 'RED MOON SEE CITYBEN'}
];
