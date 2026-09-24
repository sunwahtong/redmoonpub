import {useEffect, useState} from 'react';
import {liveBus, type Topic} from './live';

/**
 * Supabase Realtime, browser side.
 *
 * The server posts one small broadcast whenever something changes (a door
 * opens, a chat line lands, a booking moves). This module keeps one socket
 * open, subscribes to the topics the current page cares about, and forwards
 * every message to the in-page bus. The client library is loaded on first
 * use, so pages that never subscribe never download it.
 *
 * The address and the publishable key come from the build (VITE_SUPABASE_URL
 * / VITE_SUPABASE_PUBLISHABLE_KEY) or, when the build has none, from the
 * status feed the server answers on every page (`configureRealtime`). A page
 * that subscribed before the key arrived connects the moment it does. With
 * neither, the module reports itself unavailable and the hooks keep polling.
 */
let URL = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
let KEY = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '');

export let realtimeAvailable = !!(URL && KEY);

type Channel = {
  on: (type: 'broadcast', filter: {event: string}, handler: (message: {event: string; payload: Record<string, unknown>}) => void) => Channel;
  subscribe: (callback?: (status: string) => void) => Channel;
  unsubscribe: () => Promise<unknown>;
};

interface Client {
  channel: (topic: string, options?: unknown) => Channel;
}

interface Entry {
  channel: Channel | null;
  refs: number;
  connecting: boolean;
}

let clientPromise: Promise<Client> | null = null;
const channels = new Map<Topic, Entry>();
let connected = false;
const statusListeners = new Set<(connected: boolean) => void>();

function setConnected(value: boolean): void {
  if (connected === value) return;
  connected = value;
  for (const listener of statusListeners) listener(value);
}

async function client(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = import('@supabase/realtime-js').then(({RealtimeClient}) => {
      const instance = new RealtimeClient(`${URL.replace(/^http/, 'ws')}/realtime/v1`, {
        params: {apikey: KEY},
        heartbeatIntervalMs: 25000
      });
      return instance as unknown as Client;
    });
  }
  return clientPromise;
}

function connect(topic: Topic, entry: Entry): void {
  if (entry.connecting || entry.channel || !realtimeAvailable) return;
  entry.connecting = true;
  client().then((instance) => {
    entry.connecting = false;
    if (entry.refs <= 0 || channels.get(topic) !== entry) return;
    const channel = instance.channel(`rm:${topic}`, {config: {broadcast: {self: false}}});
    entry.channel = channel;
    channel
      .on('broadcast', {event: '*'}, (message) => {
        liveBus.emit({topic, event: message.event, payload: message.payload || {}});
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnected(true);
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnected(false);
      });
  });
}

/**
 * The server told us where Realtime lives. First call wins; pages that were
 * already waiting on a topic connect now.
 */
export function configureRealtime(url: string, key: string): void {
  if (realtimeAvailable || !url || !key) return;
  URL = url.replace(/\/+$/, '');
  KEY = key;
  realtimeAvailable = true;
  for (const [topic, entry] of channels) connect(topic, entry);
}

/**
 * Subscribes to a topic for as long as the returned function is not called.
 * Several subscribers share one channel.
 */
export function subscribe(topic: Topic): () => void {
  let released = false;
  const existing = channels.get(topic);
  if (existing) {
    existing.refs += 1;
  } else {
    const entry: Entry = {channel: null, refs: 1, connecting: false};
    channels.set(topic, entry);
    connect(topic, entry);
  }
  return () => {
    if (released) return;
    released = true;
    const entry = channels.get(topic);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs <= 0) {
      channels.delete(topic);
      entry.channel?.unsubscribe().catch(() => {});
      if (!channels.size) setConnected(false);
    }
  };
}

export const isRealtimeConnected = (): boolean => connected;

/** True while the socket delivers pushes; false means the page is on its polling fallback. */
export function useRealtimeConnected(): boolean {
  const [value, setValue] = useState(connected);
  useEffect(() => onRealtimeStatus(setValue), []);
  return value;
}

export function onRealtimeStatus(listener: (connected: boolean) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}
