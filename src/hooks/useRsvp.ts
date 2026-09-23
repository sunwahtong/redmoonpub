import {useCallback, useEffect, useState} from 'react';
import {apiSend, getVisitorToken} from '../lib/api';

const KEY = 'rm-rsvp';

const read = (): Set<string> => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(KEY) || '[]'));
  } catch {
    return new Set<string>();
  }
};

/**
 * "Ott leszek" on an event. The server counts one per network + browser;
 * this browser remembers its own answer so the button shows it at once.
 */
export function useRsvp(eventId: string, initialCount: number) {
  const [going, setGoing] = useState(() => read().has(eventId));
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await apiSend<{going: boolean; count: number}>(`/api/public-events/${eventId}/rsvp`, 'POST', {visitorToken: getVisitorToken()});
      setGoing(data.going);
      setCount(data.count);
      const set = read();
      if (data.going) set.add(eventId);
      else set.delete(eventId);
      localStorage.setItem(KEY, JSON.stringify([...set].slice(-100)));
    } finally {
      setBusy(false);
    }
  }, [busy, eventId]);

  return {going, count, busy, toggle};
}
