import {useCallback, useEffect, useState} from 'react';
import {useLiveData, useLiveEvent} from './useLiveData';
import {apiGet, apiSend} from '../lib/api';

export interface ClubChatMessage {
  id: string;
  at: string;
  name: string;
  text: string;
  kind: 'chat' | 'dj' | 'request' | 'request-accepted' | 'request-declined' | 'system' | 'now-playing' | 'notice' | 'poll' | string;
  color: string;
  requestId?: string | null;
}

export interface ClubPerson {
  name: string;
  color: string;
}

export interface ClubNameRequest {
  id: string;
  name: string;
  at: string;
  status?: string;
  ip?: string;
}

export interface RegisteredListener {
  name: string;
  color: string;
  ip: string | null;
  browserHash: string | null;
  approvedAt: string | null;
  expiresAt: number | null;
  banned: boolean;
  banUntil: number | null;
}

export interface ClubTrack {
  id: string;
  name: string;
  url: string;
  size?: number;
  addedBy?: string;
}

export interface ClubQueueItem extends ClubTrack {
  trackId: string;
  requestId?: string | null;
}

export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'played';

export interface MusicRequest {
  id: string;
  name: string;
  color: string;
  at: string;
  status: RequestStatus | string;
  votes: number;
  item: {id: string; name: string; url?: string; requestOnly?: boolean} | null;
  /** Moderators only. */
  ip?: string | null;
  browserHash?: string | null;
  handledBy?: string | null;
}

export interface SetlistEntry {
  id: string;
  at: string;
  title: string;
  artist: string;
  source: 'announce' | 'library' | 'request' | 'station' | string;
  byName: string;
  requestId?: string | null;
}

export interface PollOption {
  id: string;
  label: string;
  votes: number;
}

export interface ClubPoll {
  id: string;
  question: string;
  options: PollOption[];
  total: number;
  byName: string;
  createdAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  open: boolean;
}

export interface StationInfo {
  slug: string;
  live: boolean;
  listeners: number;
  nowPlaying: {title: string; artist: string} | null;
  checkedAt: string | null;
}

export interface ClubState {
  serverNow: number;
  live: boolean;
  /** Something to hear right now: the station streams, or the DJ's own stream is set. */
  onAir: boolean;
  /** The show started by itself when the station came on air; the booth is unclaimed. */
  autoLive: boolean;
  dj: string | null;
  djAvatar: string;
  title: string;
  provider: string;
  providerUrl: string;
  /** What the site plays: the DJ's own address, or the station's mount. */
  streamUrl: string;
  embedUrl: string;
  startedAt: string | null;
  listenerCount: number;
  peakListeners: number;
  station: StationInfo;
  notice: string;
  slowMode: number;
  requestsOpen: boolean;
  /** Reactions in the last minute. */
  vibe: number;
  people: ClubPerson[];
  current: (ClubTrack & {playbackPlaying?: boolean; playbackPosition?: number; addedBy?: string}) | null;
  setlist: SetlistEntry[];
  poll: ClubPoll | null;
  requests: MusicRequest[];
  queue: ClubQueueItem[];
  library: ClubTrack[];
  chat: ClubChatMessage[];
  nameRequests: ClubNameRequest[];
  registeredListeners: RegisteredListener[];
  /** Moderators only: the address typed in the booth ('' = the station's own). */
  customStreamUrl?: string;
}

const CHAT_KEEP = 120;

/** Push events that carry what changed, so no refetch is needed. */
const OWN_PAYLOAD = ['chat', 'chat_deleted', 'chat_cleared', 'reaction', 'poll'];

/**
 * The club's state: fetched, then kept current by realtime pushes.
 *
 * Chat lines, reactions and poll counts arrive as increments and are applied
 * at once, so the room feels instant; everything else (names, requests,
 * setlist, playback) triggers a refetch of the full state. Polling continues
 * underneath as a safety net.
 */
export function useClub(url = '/api/club/state', enabled = true) {
  const {data, refresh, mutate, error} = useLiveData<{state: ClubState}>(url, {intervalMs: 6000, enabled, topics: ['club'], skipEvents: OWN_PAYLOAD});

  useLiveEvent('club', (event, payload) => {
    if (event === 'chat' && payload.message) {
      const message = payload.message as ClubChatMessage;
      mutate((current) => {
        if (!current) return current;
        if (current.state.chat.some((entry) => entry.id === message.id)) return current;
        return {state: {...current.state, chat: [message, ...current.state.chat].slice(0, CHAT_KEEP)}};
      });
      return;
    }
    if (event === 'chat_deleted' && payload.id) {
      mutate((current) => (current ? {state: {...current.state, chat: current.state.chat.filter((entry) => entry.id !== payload.id)}} : current));
      return;
    }
    if (event === 'chat_cleared') {
      mutate((current) => (current ? {state: {...current.state, chat: []}} : current));
      return;
    }
    if (event === 'reaction' && typeof payload.vibe === 'number') {
      const vibe = payload.vibe;
      mutate((current) => (current ? {state: {...current.state, vibe}} : current));
      return;
    }
    if (event === 'poll') {
      const poll = (payload.poll as ClubPoll | null) ?? null;
      mutate((current) => (current ? {state: {...current.state, poll}} : current));
    }
  });

  /** Appends a line this browser just sent, without waiting for the push. */
  const appendLocal = useCallback(
    (message: ClubChatMessage) =>
      mutate((current) => {
        if (!current || current.state.chat.some((entry) => entry.id === message.id)) return current;
        return {state: {...current.state, chat: [message, ...current.state.chat].slice(0, CHAT_KEEP)}};
      }),
    [mutate]
  );

  return {state: data?.state || null, refresh, mutate, appendLocal, error};
}

const CLIENT_KEY = 'rm-club-client';
const TOKEN_KEY = 'rm-club-token';
const NAME_KEY = 'rm-club-name';
const COLOR_KEY = 'rm-club-color';
const VOTES_KEY = 'rm-club-votes';

/** Stable per-browser id. The server pairs it with the client IP. */
export function clubClientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

interface VoteMemory {
  requests: string[];
  polls: Record<string, string>;
}

const readVotes = (): VoteMemory => {
  try {
    const parsed = JSON.parse(localStorage.getItem(VOTES_KEY) || '{}') as Partial<VoteMemory>;
    return {requests: Array.isArray(parsed.requests) ? parsed.requests : [], polls: parsed.polls && typeof parsed.polls === 'object' ? parsed.polls : {}};
  } catch {
    return {requests: [], polls: {}};
  }
};

/**
 * What this browser already voted for, so the buttons show it before the
 * server confirms. The server is the judge of the count; this is memory.
 */
export function useVoteMemory() {
  const [votes, setVotes] = useState<VoteMemory>(readVotes);
  const save = useCallback((next: VoteMemory) => {
    setVotes(next);
    localStorage.setItem(VOTES_KEY, JSON.stringify({requests: next.requests.slice(-200), polls: Object.fromEntries(Object.entries(next.polls).slice(-40))}));
  }, []);
  const toggleRequest = useCallback(
    (id: string, voted: boolean) => {
      const current = readVotes();
      save({...current, requests: voted ? [...new Set([...current.requests, id])] : current.requests.filter((entry) => entry !== id)});
    },
    [save]
  );
  const rememberPoll = useCallback(
    (pollId: string, optionId: string) => {
      const current = readVotes();
      save({...current, polls: {...current.polls, [pollId]: optionId}});
    },
    [save]
  );
  return {votes, toggleRequest, rememberPoll};
}

export type NameStatus = 'none' | 'pending' | 'accepted' | 'declined' | 'banned' | 'already_named';

export interface Identity {
  status: NameStatus;
  name: string;
  color: string;
  token: string;
  retryAt: number | null;
  reason: string;
}

interface NameStatusResponse {
  status: NameStatus;
  name?: string;
  color?: string;
  token?: string;
  retryAt?: number;
  reason?: string;
  until?: number;
}

/**
 * Who this browser is in the club: the approved name, its colour and the
 * secret that signs chat lines. Re-checked on every club push, so an
 * approval by the DJ lands without a reload.
 */
export function useClubIdentity() {
  const [identity, setIdentity] = useState<Identity>(() => ({
    status: 'none',
    name: localStorage.getItem(NAME_KEY) || '',
    color: localStorage.getItem(COLOR_KEY) || '',
    token: localStorage.getItem(TOKEN_KEY) || '',
    retryAt: null,
    reason: ''
  }));

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<NameStatusResponse>(`/api/club/name-status?clientId=${encodeURIComponent(clubClientId())}`);
      setIdentity((current) => {
        const next: Identity = {
          status: data.status,
          name: data.name ?? current.name,
          color: data.color ?? current.color,
          token: data.token ?? current.token,
          retryAt: data.retryAt ?? null,
          reason: data.reason || ''
        };
        if (data.status !== 'accepted') next.token = '';
        localStorage.setItem(NAME_KEY, next.name);
        localStorage.setItem(COLOR_KEY, next.color);
        if (next.token) localStorage.setItem(TOKEN_KEY, next.token);
        else localStorage.removeItem(TOKEN_KEY);
        return next;
      });
    } catch {
      /* the club simply stays read-only */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useLiveEvent('club', (event) => {
    if (event === 'names') refresh();
  });

  /* A pending name is decided by a DJ; without a push, poll until it resolves. */
  useEffect(() => {
    if (identity.status !== 'pending') return;
    const timer = window.setInterval(refresh, 6000);
    return () => window.clearInterval(timer);
  }, [identity.status, refresh]);

  const setColor = useCallback(
    async (color: string) => {
      await apiSend('/api/club/color', 'POST', {token: identity.token, color});
      localStorage.setItem(COLOR_KEY, color);
      setIdentity((current) => ({...current, color}));
    },
    [identity.token]
  );

  return {identity, refresh, setColor, setIdentity};
}
