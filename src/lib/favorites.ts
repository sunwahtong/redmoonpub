import {create} from 'zustand';

const KEY = 'rm-favs';

const read = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
};

interface FavoritesState {
  ids: string[];
  toggle: (id: string) => void;
}

/**
 * The drinks a visitor marked on the menu. Lives in this browser only: no
 * account, nothing sent anywhere — a shortlist for the next visit.
 */
export const useFavorites = create<FavoritesState>((set, get) => ({
  ids: read(),
  toggle: (id) => {
    const next = get().ids.includes(id) ? get().ids.filter((entry) => entry !== id) : [...get().ids, id];
    localStorage.setItem(KEY, JSON.stringify(next.slice(-200)));
    set({ids: next});
  }
}));
