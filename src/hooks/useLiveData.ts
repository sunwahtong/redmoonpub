import {useCallback, useEffect, useRef, useState} from 'react';
import {apiGet} from '../lib/api';
import {liveBus, type Topic} from '../lib/live';
import {isRealtimeConnected, onRealtimeStatus, realtimeAvailable, subscribe} from '../lib/realtime';

interface Options {
  /** Background refresh interval in ms. Set to 0 to fetch only once. */
  intervalMs?: number;
  /** When false, nothing is requested. Use for endpoints the viewer may not call. */
  enabled?: boolean;
  /** Realtime topics that mean this data changed. Pushes trigger an immediate refetch. */
  topics?: Topic[];
  /** Refetch after any successful write made from this browser. On by default. */
  refetchOnMutation?: boolean;
  /** Push events on those topics that carry their own payload and must not trigger a refetch. */
  skipEvents?: string[];
}

export interface LiveData<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  /** Rewrites the local copy at once, for optimistic updates. The next fetch replaces it. */
  mutate: (updater: (current: T | null) => T | null) => void;
}

/** While a realtime socket is delivering pushes, polling is only a safety net. */
const RELAXED_FACTOR = 4;

/**
 * Fetches an endpoint and keeps it fresh.
 *
 * Three things refresh it: a slow poll (paused on a hidden tab, resumed with
 * an immediate load on focus), a realtime push on one of its topics, and any
 * successful mutation this browser made. State is only replaced when the
 * payload actually changed, so React never re-renders for nothing.
 */
export function useLiveData<T>(url: string, {intervalMs = 60000, enabled = true, topics, refetchOnMutation = true, skipEvents}: Options = {}): LiveData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const signatureRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const topicKey = (topics || []).join(',');
  const skipKey = (skipEvents || []).join(',');

  const load = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payload = await apiGet<T>(url, controller.signal);
      if (controller.signal.aborted) return;
      const signature = JSON.stringify(payload);
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setData(payload);
      }
      setError(null);
    } catch (err) {
      if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [url, enabled]);

  const mutate = useCallback((updater: (current: T | null) => T | null) => {
    setData((current) => {
      const next = updater(current);
      signatureRef.current = JSON.stringify(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    signatureRef.current = '';
    load();

    let timer: number | undefined;
    let debounce: number | undefined;
    const soon = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(load, 120);
    };

    const start = () => {
      window.clearInterval(timer);
      if (!intervalMs) return;
      const relaxed = realtimeAvailable && topicKey && isRealtimeConnected();
      timer = window.setInterval(load, relaxed ? intervalMs * RELAXED_FACTOR : intervalMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        window.clearInterval(timer);
      } else {
        load();
        start();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', load);

    const wanted = new Set(topicKey ? (topicKey.split(',') as Topic[]) : []);
    const skipped = new Set(skipKey ? skipKey.split(',') : []);
    const unsubscribeTopics = [...wanted].map((topic) => subscribe(topic));
    const offStatus = wanted.size ? onRealtimeStatus(() => start()) : () => {};
    const offBus = liveBus.on((event) => {
      if (event.topic === 'mutation') {
        if (refetchOnMutation && (intervalMs > 0 || wanted.size)) soon();
        return;
      }
      if (wanted.has(event.topic) && !skipped.has(event.event)) soon();
    });

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', load);
      for (const off of unsubscribeTopics) off();
      offStatus();
      offBus();
      abortRef.current?.abort();
    };
  }, [load, intervalMs, enabled, topicKey, skipKey, refetchOnMutation]);

  return {data, error, loading, refresh: load, mutate};
}

/** Runs `handler` for every push on `topic` while mounted. */
export function useLiveEvent(topic: Topic, handler: (event: string, payload: Record<string, unknown>) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const off = subscribe(topic);
    const offBus = liveBus.on((event) => {
      if (event.topic === topic) handlerRef.current(event.event, event.payload);
    });
    return () => {
      off();
      offBus();
    };
  }, [topic]);
}
