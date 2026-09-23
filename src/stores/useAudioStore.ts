import {create} from 'zustand';
import {assetUrl} from '../lib/api';
import {isSfxMuted, setSfxMuted} from '../lib/sfx';

/**
 * Everything that makes a sound on the site, in one place.
 *
 * Two players: the house music (a loop, off until the visitor turns it on)
 * and the live stream (the DJ's show, played while the booth is live). They
 * never play together — when the show starts the music ducks out and comes
 * back when the show ends, if it was on before.
 */
interface AudioState {
  isPlaying: boolean;
  volume: number;
  sfxMuted: boolean;

  /** The live show. */
  streamUrl: string | null;
  streamPlaying: boolean;
  streamVolume: number;
  streamMuted: boolean;
  streamError: string | null;
  /** True while a show is on, so the music stays out of the way. */
  live: boolean;

  togglePlay: () => void;
  setVolume: (volume: number) => void;
  setSfxMuted: (muted: boolean) => void;

  setLive: (live: boolean, streamUrl: string | null) => void;
  playStream: () => void;
  pauseStream: () => void;
  toggleStream: () => void;
  setStreamVolume: (volume: number) => void;
  toggleStreamMuted: () => void;
}

const MUSIC_URL = assetUrl(String(import.meta.env.VITE_BACKGROUND_MUSIC_URL || '/assets/red-moon.mp3'));
const music = new Audio(MUSIC_URL);
music.loop = true;
music.preload = 'none';

const stream = new Audio();
stream.preload = 'none';
stream.crossOrigin = 'anonymous';

const clamp = (value: number) => Math.max(0, Math.min(100, Number(value) || 0));

const initialVolume = clamp(Number(localStorage.getItem('redmoon-volume') || '45'));
const initialStreamVolume = clamp(Number(localStorage.getItem('redmoon-stream-volume') || '70'));
music.volume = initialVolume / 100;
stream.volume = initialStreamVolume / 100;

/** Whether the visitor had the music on when the show interrupted it. */
let resumeMusicAfterShow = false;

export const useAudioStore = create<AudioState>((set, get) => {
  stream.addEventListener('playing', () => set({streamPlaying: true, streamError: null}));
  stream.addEventListener('pause', () => set({streamPlaying: false}));
  stream.addEventListener('error', () => set({streamPlaying: false, streamError: 'Az adás most nem érhető el.'}));
  stream.addEventListener('stalled', () => set({streamError: 'Az adás akadozik…'}));

  return {
    isPlaying: false,
    volume: initialVolume,
    sfxMuted: isSfxMuted(),

    streamUrl: null,
    streamPlaying: false,
    streamVolume: initialStreamVolume,
    streamMuted: false,
    streamError: null,
    live: false,

    togglePlay: () => {
      const next = !get().isPlaying;
      if (next) {
        if (get().streamPlaying) get().pauseStream();
        music.play().catch(() => {});
        localStorage.setItem('redmoon-sound', 'on');
      } else {
        music.pause();
        localStorage.setItem('redmoon-sound', 'off');
      }
      set({isPlaying: next});
    },

    setVolume: (volume) => {
      const value = clamp(volume);
      music.volume = value / 100;
      localStorage.setItem('redmoon-volume', String(value));
      if (value === 0 && get().isPlaying) {
        music.pause();
        set({isPlaying: false, volume: 0});
        return;
      }
      set({volume: value});
    },

    setSfxMuted: (muted) => {
      setSfxMuted(muted);
      set({sfxMuted: muted});
    },

    setLive: (live, streamUrl) => {
      const state = get();
      const url = streamUrl || null;
      if (live && !state.live) {
        // The show starts: the house music steps aside.
        resumeMusicAfterShow = state.isPlaying;
        if (state.isPlaying) {
          music.pause();
          set({isPlaying: false});
        }
      }
      if (!live && state.live) {
        // The show ends: stop the stream, bring the music back if it was on.
        stream.pause();
        stream.removeAttribute('src');
        stream.load();
        set({streamPlaying: false, streamUrl: null, streamError: null});
        if (resumeMusicAfterShow) {
          music.play().catch(() => {});
          set({isPlaying: true});
        }
        resumeMusicAfterShow = false;
      }
      if (url !== state.streamUrl) {
        const wasPlaying = state.streamPlaying;
        if (url) {
          stream.src = url;
          if (wasPlaying) stream.play().catch(() => {});
        } else {
          stream.pause();
          stream.removeAttribute('src');
          stream.load();
        }
        set({streamUrl: url, streamPlaying: url ? wasPlaying : false});
      }
      set({live});
    },

    playStream: () => {
      const {streamUrl, isPlaying} = get();
      if (!streamUrl) return;
      if (isPlaying) {
        music.pause();
        set({isPlaying: false});
      }
      if (!stream.src) stream.src = streamUrl;
      set({streamError: null});
      stream.play().catch(() => set({streamError: 'Kattints újra a lejátszáshoz.'}));
    },

    pauseStream: () => {
      stream.pause();
      set({streamPlaying: false});
    },

    toggleStream: () => (get().streamPlaying ? get().pauseStream() : get().playStream()),

    setStreamVolume: (volume) => {
      const value = clamp(volume);
      stream.volume = value / 100;
      stream.muted = false;
      localStorage.setItem('redmoon-stream-volume', String(value));
      set({streamVolume: value, streamMuted: false});
    },

    toggleStreamMuted: () => {
      const muted = !get().streamMuted;
      stream.muted = muted;
      set({streamMuted: muted});
    }
  };
});
