/**
 * A tiny in-page event bus.
 *
 * Two things flow over it: `mutation` after any successful write the browser
 * itself made (so every live list on the page refreshes at once instead of
 * waiting for its next poll), and the realtime topics pushed by the server
 * (see realtime.ts), re-emitted here so components subscribe to one thing.
 */
export type Topic = 'house' | 'club' | 'reservations' | 'events' | 'content' | 'staff';

export interface LiveEvent {
  topic: Topic | 'mutation';
  event: string;
  payload: Record<string, unknown>;
}

type Listener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();

export const liveBus = {
  on(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  emit(event: LiveEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.warn('[live] listener failed', error);
      }
    }
  }
};
