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
  /** Something to hear: the station streams, or the DJ plays their own stream. Only then does the music step aside. */
  onAir: boolean;
  /** The show started by itself because the station came on air; nobody has claimed the booth yet. */
  autoLive: boolean;
  /** The DJ's nickname while the booth is live. */
  dj: string | null;
  title: string;
  /** A direct audio stream the site can play while live, if the DJ set one. */
  streamUrl: string;
  /** The station page (gocast.fm) for listening outside the site. */
  providerUrl: string;
  /** GoCast's own player, for an iframe fallback. */
  embedUrl: string;
  liveSince: string | null;
  /** Open club pages on this site. */
  listenerCount: number;
  /** Whether the station itself is on air, and who listens to it directly. */
  stationLive: boolean;
  stationListeners: number;
  /** The track named by the stream's metadata, if any. */
  nowPlaying: {title: string; artist: string} | null;
  /** The DJ's pinned line. */
  notice: string;
  nextEvent: RedMoonEvent | null;
  serverNow: string;
}

/**
 * One feed for everything the public chrome needs: the door, the booth and
 * the next evening. Shared by the navbar chip, the status pill, the live
 * popup, the tonight bar and the home hero so they never disagree.
 *
 * Refreshes on a realtime push the moment the door or the booth changes, and
 * polls as a fallback.
 */
export function useHouseStatus(intervalMs = 12000) {
  return useLiveData<HouseStatus>('/api/public/status', {intervalMs, topics: ['house']});
}
