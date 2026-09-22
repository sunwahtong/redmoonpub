import {useEffect, useRef, useState} from 'react';
import {getRuntimeInfo} from '../lib/runtime';

export interface ClubChatMessage {
  id: string;
  at: string;
  name: string;
  text: string;
  kind: 'chat' | 'request' | string;
}

export interface ClubNameRequest {
  id: string;
  name: string;
  at: string;
  status?: string;
}

export interface RegisteredListener {
  name: string;
  ip: string | null;
  browserHash: string | null;
  approvedAt: string | null;
  expiresAt: number | null;
  banned: boolean;
  banUntil: number | null;
}

export interface ClubState {
  serverNow: number;
  live: boolean;
  dj: string | null;
  title: string;
  provider: string;
  providerUrl: string;
  chat: ClubChatMessage[];
  nameRequests: ClubNameRequest[];
  registeredListeners: RegisteredListener[];
  listenerCount: number;
  startedAt: string | null;
}

/**
 * Live club state over Server-Sent Events.
 *
 * The server pushes a full `state` on connect and on every change, plus
 * incremental `chat_message` / `chat_deleted` events. Applying the increments
 * keeps the chat instant instead of waiting for the next full snapshot.
 *
 * EventSource reconnects on its own, but only while the tab is visible — a
 * hidden tab holding an open stream is a socket the bar does not need.
 *
 * On a serverless deployment there is no stream to hold: the backend reports
 * `realtime: "poll"` and this hook asks /api/club/state on a short interval
 * instead. The rest of the club page cannot tell the difference, apart from
 * chat arriving on the next tick rather than instantly.
 */
const POLL_INTERVAL_MS = 4000;

export function useClubStream(): {state: ClubState | null; connected: boolean} {
  const [state, setState] = useState<ClubState | null>(null);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let closed = false;
    let pollTimer: number | undefined;

    const pollOnce = async () => {
      try {
        const response = await fetch('/api/club/state', {cache: 'no-store'});
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json();
        if (closed) return;
        if (payload?.state) setState(payload.state);
        setConnected(true);
      } catch {
        if (!closed) setConnected(false);
      }
    };

    const startPolling = () => {
      if (closed || pollTimer !== undefined) return;
      pollOnce();
      pollTimer = window.setInterval(pollOnce, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
      setConnected(false);
    };

    const open = () => {
      if (sourceRef.current || closed) return;

      const source = new EventSource('/api/club/events');
      sourceRef.current = source;

      source.onopen = () => setConnected(true);
      source.onerror = () => setConnected(false);

      source.onmessage = (event) => {
        let payload: any;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        if (payload.state) {
          setState(payload.state);
          return;
        }

        if (payload.type === 'chat_message' && payload.message) {
          setState((current) =>
            current ? {...current, chat: [payload.message, ...current.chat].slice(0, 60)} : current
          );
          return;
        }

        if (payload.type === 'chat_deleted' && payload.id) {
          setState((current) =>
            current ? {...current, chat: current.chat.filter((message) => message.id !== payload.id)} : current
          );
        }
      };
    };

    const close = () => {
      sourceRef.current?.close();
      sourceRef.current = null;
      setConnected(false);
    };

    // Start and stop are resolved once the backend has said which it supports.
    let start = open;
    let stop = close;

    const onVisibility = () => (document.hidden ? stop() : start());

    getRuntimeInfo().then((info) => {
      if (closed) return;
      if (info.realtime === 'poll') {
        start = startPolling;
        stop = stopPolling;
      }
      if (!document.hidden) start();
    });

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      close();
      stopPolling();
    };
  }, []);

  return {state, connected};
}
