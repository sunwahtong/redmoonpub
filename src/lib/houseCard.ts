/**
 * The House card: what each tier looks like in metal and ink, and what a
 * member's climb reads as on the back of the card.
 *
 * The card is drawn from the member alone (code, name, tier, dates), so it
 * is never stored anywhere: the console, the member's own page and the PNG
 * all render the same drawing from the same row.
 */
import {MEMBERSHIP} from './content';

export type Tier = 'silver' | 'gold' | 'black' | 'royal';
export const TIERS: Tier[] = ['silver', 'gold', 'black', 'royal'];
export const RANK: Record<Tier, number> = {silver: 1, gold: 2, black: 3, royal: 4};

/** The drawing's own units: a bank card's proportions, 1000 wide. */
export const CARD_W = 1000;
export const CARD_H = 630;

/** One step of a climb: the tier, when it was reached, who gave it. */
export interface TierStep {
  tier: Tier;
  at: string;
  by?: string;
}

/** What the card needs to know; the console's member and the guest's own view both fit. */
export interface CardMember {
  code: string;
  name: string;
  tier: Tier;
  visits: number;
  lastVisitAt?: string | null;
  grantedAt: string;
  active?: boolean;
  tierHistory?: TierStep[];
  grantedByName?: string;
}

export interface TierMeta {
  name: string;
  no: string;
  glyph: string;
  tagline: string;
  perks: string[];
  /** The metal: highlight, body, shadow. */
  foil: [string, string, string];
  /** The card's body, top-left to bottom-right. */
  base: [string, string];
  ink: string;
  glow: string;
}

const METAL: Record<Tier, Pick<TierMeta, 'foil' | 'base' | 'ink' | 'glow'>> = {
  silver: {foil: ['#ffffff', '#cfd5db', '#6f7880'], base: ['#21252b', '#08090b'], ink: '#dde2e7', glow: 'rgba(205, 215, 225, 0.42)'},
  gold: {foil: ['#fff4cc', '#e3c07a', '#7d5a1c'], base: ['#261a09', '#080503'], ink: '#ecd08d', glow: 'rgba(227, 192, 122, 0.46)'},
  black: {foil: ['#eef0f3', '#9aa0a6', '#2c3035'], base: ['#131417', '#000000'], ink: '#c3c9cf', glow: 'rgba(170, 178, 186, 0.3)'},
  royal: {foil: ['#ffd6de', '#ff4668', '#7a0a20'], base: ['#2e0711', '#070203'], ink: '#ff6b85', glow: 'rgba(255, 70, 104, 0.52)'}
};

export function tierMeta(tier: Tier): TierMeta {
  const copy = MEMBERSHIP.find((entry) => entry.id === tier) || MEMBERSHIP[0];
  return {name: copy.name, no: copy.no, glyph: copy.glyph, tagline: copy.tagline, perks: copy.perks, ...METAL[tier]};
}

export interface LadderStep {
  tier: Tier;
  /** When the tier was first reached, or null if never. */
  at: string | null;
  current: boolean;
}

/** The four tiers, each with the date it was first reached. */
export function ladderOf(member: CardMember): LadderStep[] {
  const history = member.tierHistory?.length ? member.tierHistory : [{tier: member.tier, at: member.grantedAt}];
  return TIERS.map((tier) => {
    const first = history.find((step) => step.tier === tier);
    return {tier, at: first?.at || null, current: tier === member.tier};
  });
}

/** When the member reached the tier they hold now (the last time, if they left and came back). */
export function currentSince(member: CardMember): string {
  const steps = (member.tierHistory || []).filter((step) => step.tier === member.tier);
  return steps.length ? steps[steps.length - 1].at : member.grantedAt;
}

const monthYearFormat = new Intl.DateTimeFormat('hu-HU', {year: 'numeric', month: 'long'});
const dayFormat = new Intl.DateTimeFormat('hu-HU', {year: 'numeric', month: '2-digit', day: '2-digit'});

/** "2026. MÁRCIUS" */
export const monthYear = (value: string | Date): string => monthYearFormat.format(new Date(value)).toUpperCase();
/** "2026. 03. 14." */
export const shortDay = (value: string | Date): string => dayFormat.format(new Date(value));

export const cardFileName = (member: CardMember, face: 'front' | 'back'): string => `red-moon-house-${member.code}${face === 'back' ? '-hatlap' : ''}.png`;

/** xorshift32 from a string, so the engraving behind a code is that code's own. */
export function seeded(text: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  if (!seed) seed = 0x9e3779b9;
  return () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 0xffffffff;
  };
}
