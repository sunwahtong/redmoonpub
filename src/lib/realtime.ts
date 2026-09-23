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
 * With no VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (local development)
 * the module reports itself unavailable and the hooks keep their polling.
 */
const URL = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '');

export const realtimeAvailable = !!(URL && KEY);

type Channel = {
  on: (type: 'broadcast', filter: {event: string}, handler: (message: {event: string; payload: Record<string, unknown>}) => void) => Channel;
  subscribe: (callback?: (status: string) => void) => Channel;
  unsubscribe: () => Promise<unknown>;
};

interface Client {
  channel: (topic: string, options?: unknown) => Channel;
}

let clientPromise: Promise<Client> | null = null;
const channels = new Map<Topic, {channel: Channel; refs: number}>();
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

/**
 * Subscribes to a topic for as long as the returned function is not called.
 * Several subscribers share one channel.
 */
export function subscribe(topic: Topic): () => void {
  if (!realtimeAvailable) return () => {};
  let released = false;
  const existing = channels.get(topic);
  if (existing) {
    existing.refs += 1;
  } else {
    const entry = {channel: null as unknown as Channel, refs: 1};
    channels.set(topic, entry);
    client().then((instance) => {
      if (released && entry.refs <= 0) return;
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
