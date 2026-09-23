import {create} from 'zustand';
import {assetUrl} from '../lib/api';
import {isSfxMuted, setSfxMuted} from '../lib/sfx';

/**
 * Everything that makes a sound on the site, in one place.
 *
 * Two players: the house music (a loop, off until the visitor turns it on)
 * and the live show (the station's stream, an ordinary MP3 mount). They
 * never play together. When the show starts the music steps aside — and if
 * it was on, the show takes its place at once, since the visitor had
 * already asked for sound. When the show ends the music comes back if it
 * was on before.
 */
interface AudioState {
  isPlaying: boolean;
  volume: number;
  sfxMuted: boolean;

  /** The live show. */
  streamUrl: string | null;
  streamPlaying: boolean;
  /** Between play() and the first audio: the stream connects. */
  streamLoading: boolean;
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

const clamp = (value: number) => Math.max(0, Math.min(100, Number(value) || 0));

const initialVolume = clamp(Number(localStorage.getItem('redmoon-volume') || '45'));
const initialStreamVolume = clamp(Number(localStorage.getItem('redmoon-stream-volume') || '70'));
music.volume = initialVolume / 100;
stream.volume = initialStreamVolume / 100;

/** Whether the visitor had the music on when the show interrupted it. */
let resumeMusicAfterShow = false;

/** A live stream resumes at the live edge, never from a stale buffer: drop the source on pause. */
function unload(): void {
  stream.pause();
  stream.removeAttribute('src');
  stream.load();
}

export const useAudioStore = create<AudioState>((set, get) => {
  stream.addEventListener('playing', () => set({streamPlaying: true, streamLoading: false, streamError: null}));
  stream.addEventListener('waiting', () => set({streamLoading: true}));
  stream.addEventListener('pause', () => set({streamPlaying: false, streamLoading: false}));
  stream.addEventListener('error', () => {
    if (!stream.getAttribute('src')) return;
    set({streamPlaying: false, streamLoading: false, streamError: 'Az adás most nem érhető el.'});
  });
  stream.addEventListener('stalled', () => {
    if (get().streamPlaying) set({streamError: 'Az adás akadozik…'});
  });

  return {
    isPlaying: false,
    volume: initialVolume,
    sfxMuted: isSfxMuted(),

    streamUrl: null,
    streamPlaying: false,
    streamLoading: false,
    streamVolume: initialStreamVolume,
    streamMuted: false,
    streamError: null,
    live: false,

    togglePlay: () => {
      const next = !get().isPlaying;
      if (next) {
        if (get().streamPlaying || get().streamLoading) get().pauseStream();
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
      let takeOver = false;
      if (live && !state.live) {
        // The show starts: the house music steps aside, and if it was on the
        // visitor wanted sound — the show takes its place.
        resumeMusicAfterShow = state.isPlaying;
        takeOver = state.isPlaying;
        if (state.isPlaying) {
          music.pause();
          set({isPlaying: false});
        }
      }
      if (!live && state.live) {
        // The show ends: stop the stream, bring the music back if it was on.
        unload();
        set({streamPlaying: false, streamLoading: false, streamUrl: null, streamError: null});
        if (resumeMusicAfterShow) {
          music.play().catch(() => {});
          set({isPlaying: true});
        }
        resumeMusicAfterShow = false;
      }
      if (url !== state.streamUrl) {
        const wasPlaying = state.streamPlaying || state.streamLoading;
        unload();
        set({streamUrl: url, streamPlaying: false, streamLoading: false});
        if (url && wasPlaying) {
          set({live});
          get().playStream();
          return;
        }
      }
      set({live});
      if (takeOver && url) get().playStream();
    },

    playStream: () => {
      const {streamUrl, isPlaying} = get();
      if (!streamUrl) return;
      if (isPlaying) {
        music.pause();
        set({isPlaying: false});
      }
      stream.src = streamUrl;
      set({streamError: null, streamLoading: true});
      stream.play().catch((error: unknown) => {
        // The browser wants a tap first; anything else means the stream itself is not there.
        const blocked = (error as {name?: string})?.name === 'NotAllowedError';
        set({streamLoading: false, streamError: blocked ? 'Kattints a lejátszásra a hallgatáshoz.' : 'Az adás most nem érhető el — a rádió csendes.'});
      });
    },

    pauseStream: () => {
      unload();
      set({streamPlaying: false, streamLoading: false});
    },

    toggleStream: () => (get().streamPlaying || get().streamLoading ? get().pauseStream() : get().playStream()),

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
