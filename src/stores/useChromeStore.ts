import {create} from 'zustand';

/**
 * Small pieces of page chrome that several components share: whether the
 * corner door pill is unfolded (the header chip toggles it) and whether the
 * live popup is folded to a chip.
 */
interface ChromeState {
  doorExpanded: boolean;
  setDoorExpanded: (value: boolean) => void;
  toggleDoor: () => void;
  liveMinimized: boolean;
  setLiveMinimized: (value: boolean) => void;
}

export const useChromeStore = create<ChromeState>((set, get) => ({
  doorExpanded: false,
  setDoorExpanded: (value) => set({doorExpanded: value}),
  toggleDoor: () => set({doorExpanded: !get().doorExpanded}),
  liveMinimized: sessionStorage.getItem('rm-live-min') === '1',
  setLiveMinimized: (value) => {
    sessionStorage.setItem('rm-live-min', value ? '1' : '0');
    set({liveMinimized: value});
  }
}));
