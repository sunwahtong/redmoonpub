import {create} from 'zustand';
import type {TourModule} from '../lib/tour';

/**
 * Where the guided tour is. The host component (`TourHost`) reads this and
 * does the walking; pages only ever call `startTour`.
 */
interface TourState {
  active: boolean;
  modules: TourModule[];
  moduleIndex: number;
  stepIndex: number;
  /** A replay from the profile: nothing is recorded as skipped. */
  replay: boolean;
  start: (modules: TourModule[], replay: boolean) => void;
  go: (moduleIndex: number, stepIndex: number) => void;
  stop: () => void;
}

export const useTourStore = create<TourState>((set) => ({
  active: false,
  modules: [],
  moduleIndex: 0,
  stepIndex: 0,
  replay: false,
  start: (modules, replay) => {
    if (!modules.length) return;
    set({active: true, modules, moduleIndex: 0, stepIndex: 0, replay});
  },
  go: (moduleIndex, stepIndex) => set({moduleIndex, stepIndex}),
  stop: () => set({active: false, modules: [], moduleIndex: 0, stepIndex: 0, replay: false})
}));

export const startTour = (modules: TourModule[], replay = true): void => useTourStore.getState().start(modules, replay);
