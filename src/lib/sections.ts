import type {DrinkSection} from '../types';

/**
 * Display names for the drink sections produced by `inferProductSection` in
 * server.cjs. Kept in one place so the menu filters, card badges and any future
 * staff UI stay in sync.
 */
export const SECTION_LABELS: Record<DrinkSection, string> = {
  beer: 'SÖR',
  wine: 'BOR & PEZSGŐ',
  spirits: 'RÖVIDITAL',
  nonalcoholic: 'ALKOHOLMENTES',
  accessories: 'KIEGÉSZÍTŐ',
  other: 'EGYÉB'
};

/** Menu filter order — the way the bar reads its own list, cheapest first. */
export const SECTION_ORDER: DrinkSection[] = ['beer', 'wine', 'spirits', 'nonalcoholic', 'accessories', 'other'];

export const sectionLabel = (section: string | undefined): string =>
  SECTION_LABELS[(section || 'other') as DrinkSection] || SECTION_LABELS.other;
