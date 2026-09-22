import {create} from 'zustand';
import {ApiError, apiGet, apiSend} from '../lib/api';

export type Role = 'staff' | 'manager' | 'owner' | 'dj';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  nickname: string;
  role: Role;
  portal: 'staff' | 'dj';
  /**
   * The post the person holds, as opposed to what they may do.
   *
   * `role` is the permission ladder; `job` is the job. A bartender and a
   * doorman are both `staff`, but only the doorman runs supply orders.
   */
  job: string;
  avatar: string;
  phone: string;
}

interface AuthState {
  user: AuthUser | null;
  /** True until the first /api/me call settles, so guards do not flash. */
  loading: boolean;
  error: string | null;
  restore: () => Promise<void>;
  setUser: (user: AuthUser) => void;
  savePhone: (phone: string) => Promise<void>;
  login: (username: string, password: string, options?: {force?: boolean; portal?: 'staff' | 'dj'}) => Promise<void>;
  /** Set when the account is already signed in elsewhere. */
  sessionConflict: boolean;
  logout: () => Promise<void>;
}

const RANK: Record<string, number> = {staff: 1, manager: 2, owner: 3};

/** Mirrors `roleAtLeast` in server.cjs so the UI hides what the API would reject. */
export const roleAtLeast = (role: Role | undefined, need: Role): boolean =>
  (RANK[role || ''] || 0) >= (RANK[need] || 99);

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,
  sessionConflict: false,

  setUser: (user) => set({user}),

  savePhone: async (phone) => {
    const data = await apiSend<{user: AuthUser}>('/api/profile/phone', 'POST', {phone});
    set({user: data.user});
  },

  restore: async () => {
    try {
      const data = await apiGet<{user: AuthUser}>('/api/me');
      set({user: data.user, loading: false, error: null});
    } catch {
      // 401 is the normal "not logged in" answer, not a failure worth showing.
      set({user: null, loading: false});
    }
  },

  login: async (username, password, {force = false, portal = 'staff'} = {}) => {
    set({error: null, sessionConflict: false});
    try {
      const data = await apiSend<{user: AuthUser}>('/api/login', 'POST', {
        username,
        password,
        portal,
        force
      });
      set({user: data.user, error: null, sessionConflict: false});
    } catch (err) {
      const conflict = err instanceof ApiError && err.status === 409;
      set({error: (err as Error).message, sessionConflict: conflict});
      throw err;
    }
  },

  logout: async () => {
    try {
      await apiSend('/api/logout', 'POST');
    } catch {
      /* the cookie is gone either way */
    }
    set({user: null});
  }
}));
