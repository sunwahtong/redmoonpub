import {create} from 'zustand';

interface AudioState {
  isPlaying: boolean;
  volume: number;
  togglePlay: () => void;
  setVolume: (volume: number) => void;
}

const audio = new Audio('/assets/red-moon.mp3');
audio.loop = true;

const initialVolume = Number(localStorage.getItem('redmoon-volume') || '45');
audio.volume = Math.max(0, Math.min(100, initialVolume)) / 100;

export const useAudioStore = create<AudioState>((set, get) => ({
  isPlaying: false,
  volume: initialVolume,
  togglePlay: () => {
    const nextState = !get().isPlaying;
    if (nextState) {
      audio.play().catch(() => {
      });
      localStorage.setItem('redmoon-sound', 'on');
    } else {
      audio.pause();
      localStorage.setItem('redmoon-sound', 'off');
    }
    set({isPlaying: nextState});
  },
  setVolume: (volume: number) => {
    audio.volume = Math.max(0, Math.min(100, volume)) / 100;
    localStorage.setItem('redmoon-volume', String(volume));
    if (volume === 0 && get().isPlaying) {
      audio.pause();
      set({isPlaying: false, volume: 0});
      return;
    }
    set({volume});
  }
}));