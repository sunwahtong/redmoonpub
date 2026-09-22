import {useCallback, useEffect, useRef, useState} from 'react';
import {apiGet} from '../lib/api';

interface Options {
  /** Background refresh interval in ms. Set to 0 to fetch only once. */
  intervalMs?: number;
  /** When false, nothing is requested. Use for endpoints the viewer may not call. */
  enabled?: boolean;
}

interface LiveData<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Fetches a public endpoint and keeps it fresh.
 *
 * The legacy scripts hammered the API on a fixed `setInterval` (menu.js polled
 * every 2 seconds, forever, even on a hidden tab) and re-rendered the DOM on
 * every tick. Here polling is slow by default, pauses while the tab is hidden,
 * resumes with an immediate refresh on focus, and state is only replaced when
 * the payload actually changed — so React never re-renders for nothing.
 */
export function useLiveData<T>(url: string, {intervalMs = 60000, enabled = true}: Options = {}): LiveData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const signatureRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);

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

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    signatureRef.current = '';
    load();

    if (!intervalMs) return () => abortRef.current?.abort();

    let timer: number | undefined;
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(load, intervalMs);
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

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', load);
      abortRef.current?.abort();
    };
  }, [load, intervalMs, enabled]);

  return {data, error, loading, refresh: load};
}
