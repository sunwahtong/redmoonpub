import {useLiveData} from './useLiveData';
import type {RedMoonEvent} from '../types';

export interface HouseStatus {
  /** The front door: what the public sees as open or closed. */
  open: boolean;
  since: string | null;
  openedBy: string;
  note: string;
  closedAt: string | null;
  /** A shift is running — the precondition for opening the door. */
  shiftOpen: boolean;
  live: boolean;
  dj: string | null;
  title: string;
  listenerCount: number;
  nextEvent: RedMoonEvent | null;
  serverNow: string;
}

/**
 * One poll for everything the public chrome needs: the door, the booth and
 * the next evening. Shared by the navbar chip, the status pill, the tonight
 * bar and the home hero so they never disagree with each other.
 */
export function useHouseStatus(intervalMs = 20000) {
  return useLiveData<HouseStatus>('/api/public/status', {intervalMs});
}
