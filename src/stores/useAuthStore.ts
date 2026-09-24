import {create} from 'zustand';
import {ApiError, apiGet, apiSend} from '../lib/api';

export type Role = 'staff' | 'manager' | 'owner';

/** What the signed-in account may do. Mirrors `capabilitiesOf` on the server. */
export interface Capabilities {
  manager: boolean;
  owner: boolean;
  dj: boolean;
  runOrders: boolean;
  manageBlips: boolean;
  manageEvents: boolean;
  manageProducts: boolean;
  manageUsers: boolean;
  manageHouse: boolean;
  viewAudit: boolean;
  documents: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  nickname: string;
  title: string;
  /** The permission ladder. */
  role: Role;
  /**
   * The posts the person holds, as opposed to what they may do. A bartender
   * and a doorman are both `staff`, but only the doorman runs supply orders,
   * and only somebody with the `dj` job opens the booth — unless they own the
   * place, in which case they do everything.
   */
  jobs: string[];
  /** First job, kept for older call sites. */
  job: string;
  avatar: string;
  phone: string;
  idNumber: string;
  hasSignature: boolean;
  /** Where the stored signature lives (media store URL), or null. */
  signatureUrl: string | null;
  /** generated | drawn | uploaded */
  signatureKind: string;
  /** A document has carried it: it can no longer change. */
  signatureLocked: boolean;
  signatureLockedAt: string | null;
  signatureDecided: boolean;
  /** Own account only: manager+ who has not chosen a signature yet. */
  signaturePrompt?: boolean;
  showPublic: boolean;
  active: boolean;
  lastActiveAt: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
  mustChangePassword?: boolean;
  /** Own account only: guided-tour modules finished or skipped ({module: 'done' | 'skipped'}). */
  tours?: Record<string, string>;
  capabilities: Capabilities;
}

interface AuthState {
  user: AuthUser | null;
  /** True until the first /api/me call settles, so guards do not flash. */
  loading: boolean;
  error: string | null;
  /** Set when the account is already signed in elsewhere. */
  sessionConflict: boolean;
  restore: () => Promise<void>;
  setUser: (user: AuthUser) => void;
  savePhone: (phone: string) => Promise<void>;
  login: (username: string, password: string, options?: {force?: boolean}) => Promise<void>;
  logout: () => Promise<void>;
}

const RANK: Record<string, number> = {staff: 1, manager: 2, owner: 3};

/** Mirrors `roleAtLeast` in the server so the UI hides what the API would reject. */
export const roleAtLeast = (role: Role | string | undefined, need: Role): boolean =>
  (RANK[role || ''] || 0) >= (RANK[need] || 99);

const NO_CAPABILITIES: Capabilities = {
  manager: false,
  owner: false,
  dj: false,
  runOrders: false,
  manageBlips: false,
  manageEvents: false,
  manageProducts: false,
  manageUsers: false,
  manageHouse: false,
  viewAudit: false,
  documents: false
};

export const can = (user: AuthUser | null | undefined, capability: keyof Capabilities): boolean =>
  (user?.capabilities || NO_CAPABILITIES)[capability];

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
      const data = await apiGet<{user: AuthUser | null}>('/api/me');
      set({user: data.user, loading: false, error: null});
    } catch {
      // 401 is the normal "not logged in" answer, not a failure worth showing.
      set({user: null, loading: false});
    }
  },

  login: async (username, password, {force = false} = {}) => {
    set({error: null, sessionConflict: false});
    try {
      const data = await apiSend<{user: AuthUser}>('/api/login', 'POST', {username, password, force});
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
