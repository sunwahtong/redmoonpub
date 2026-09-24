import {useMemo} from 'react';
import {useLiveData} from './useLiveData';
import type {FloorPlan, TableWindow} from '../../shared/floorPlan.ts';

/** A held table; staff also get the booking behind it. */
export interface HeldTable extends TableWindow {
  id?: string;
  code?: string;
  name?: string;
  guests?: number;
  status?: string;
}

export interface FloorFeed {
  plan: FloorPlan;
  slotMinutes: number;
  at: string;
  taken: HeldTable[];
}

/**
 * The room and the tables held around a day. Keyed by the day, not the
 * minute: the server answers a day either way of noon, so moving the hour
 * within an evening colours the room without another request. Pushes on
 * `reservations` (a confirmation) and `content` (a new plan) refetch.
 */
export function useFloorPlan(at: Date | null, enabled = true) {
  const stamp = at ? at.getTime() : 0;
  const dayKey = useMemo(() => {
    const date = new Date(stamp || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    date.setHours(12, 0, 0, 0);
    return date.toISOString();
  }, [stamp]);
  return useLiveData<FloorFeed>(`/api/public/floor-plan?at=${encodeURIComponent(dayKey)}`, {
    intervalMs: 0,
    topics: ['reservations', 'content'],
    enabled: enabled && !!dayKey
  });
}
