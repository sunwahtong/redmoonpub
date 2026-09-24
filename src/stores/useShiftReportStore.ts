import {create} from 'zustand';
import {apiGet, apiSend} from '../lib/api';

/** One person's share of a closed shift, with where to send it. */
export interface ShiftReport {
  id: string;
  shiftId: string;
  userId: string;
  userName: string;
  amount: number;
  salesCount: number;
  items: number;
  closedAt: string;
  closedByName: string;
  seenAt: string | null;
  closingLabel: string;
  transfer: {account: string; owner: string; memo: string};
}

interface State {
  /** Unseen reports, oldest first. The first one is on screen unless snoozed. */
  queue: ShiftReport[];
  /** "Később": hidden for now, the badge stays until it is seen. */
  snoozed: boolean;
  check: () => Promise<void>;
  push: (report: ShiftReport) => void;
  wake: () => void;
  snooze: () => void;
  done: (id: string) => Promise<void>;
  clear: () => void;
}

/**
 * What the closing of a shift leaves for a person. Filled from the server
 * on sign-in, on the push a closing sends, on the presence heartbeat and
 * when the tab comes back; the host component shows the front of the queue.
 */
export const useShiftReportStore = create<State>((set, get) => ({
  queue: [],
  snoozed: false,
  check: async () => {
    try {
      const data = await apiGet<{reports: ShiftReport[]}>('/api/shift-reports/pending');
      const known = new Set(get().queue.map((report) => report.id));
      const fresh = data.reports.some((report) => !known.has(report.id));
      // Something new arrived: it opens even if an older one was put off.
      set({queue: data.reports, snoozed: fresh ? false : get().snoozed});
    } catch {
      /* not signed in, or offline; nothing to show */
    }
  },
  push: (report) => {
    if (get().queue.some((entry) => entry.id === report.id)) return;
    set({queue: [report, ...get().queue], snoozed: false});
  },
  wake: () => set({snoozed: false}),
  snooze: () => set({snoozed: true}),
  done: async (id) => {
    try {
      await apiSend(`/api/shift-reports/${id}/seen`, 'POST', {});
    } catch {
      /* it stays pending on the server and comes back next time */
    }
    set({queue: get().queue.filter((report) => report.id !== id)});
  },
  clear: () => set({queue: [], snoozed: false})
}));
