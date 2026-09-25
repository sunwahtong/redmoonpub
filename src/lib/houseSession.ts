/**
 * The card this browser carries: the session the House handed out when the
 * member last showed their code and phone. It opens the inner rooms and
 * marks the member in the club without asking for the phone again.
 */
import type {Tier} from './houseCard';

const KEY = 'rm-house-token';

export interface HouseSession {
  token: string;
  code: string;
  name: string;
  tier: Tier;
}

export function storedHouseSession(): HouseSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HouseSession>;
    return parsed.token && parsed.code && parsed.tier ? {token: parsed.token, code: parsed.code, name: parsed.name || '', tier: parsed.tier} : null;
  } catch {
    return null;
  }
}

export function storeHouseSession(session: HouseSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearHouseSession(): void {
  localStorage.removeItem(KEY);
}

export const houseToken = (): string => storedHouseSession()?.token || '';
