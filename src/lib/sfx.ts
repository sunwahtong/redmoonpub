/**
 * UI sound effects.
 *
 * The `public/assets/sounds/*.wav` files shipped with the project but nothing
 * played them in the rewrite. Legacy fired `playUiClick()` from a delegated
 * click handler in site.js; this keeps that behaviour but adds a small pool so
 * rapid clicks overlap instead of cutting each other off.
 */

export type SfxName =
  | 'ui_click'
  | 'open'
  | 'success'
  | 'error'
  | 'accept'
  | 'decline'
  | 'delete'
  | 'chat_message'
  | 'cash_open'
  | 'cash_close'
  | 'copy'
  | 'login'
  | 'logout';

const VOLUME_KEY = 'redmoon-volume';
const MUTED_KEY = 'redmoon-sfx';
const POOL_SIZE = 3;

/** Relative to the background music, which is the loud one. */
const SFX_GAIN = 0.55;

const pools = new Map<SfxName, {clips: HTMLAudioElement[]; next: number}>();

function pool(name: SfxName) {
  let entry = pools.get(name);
  if (!entry) {
    const clips = Array.from({length: POOL_SIZE}, () => {
      const audio = new Audio(`/assets/sounds/${name}.wav`);
      audio.preload = 'auto';
      return audio;
    });
    entry = {clips, next: 0};
    pools.set(name, entry);
  }
  return entry;
}

export const isSfxMuted = (): boolean => localStorage.getItem(MUTED_KEY) === 'off';

export function setSfxMuted(muted: boolean): void {
  localStorage.setItem(MUTED_KEY, muted ? 'off' : 'on');
}

/**
 * Plays a one-shot. Never throws and never blocks: before the first user
 * gesture the browser rejects playback, and that is fine to swallow.
 */
export function playSfx(name: SfxName): void {
  if (typeof window === 'undefined' || isSfxMuted()) return;

  // Track the music slider so sounds stay proportional to it.
  const master = Number(localStorage.getItem(VOLUME_KEY) ?? '45') / 100;
  if (!(master > 0)) return;

  const entry = pool(name);
  const clip = entry.clips[entry.next];
  entry.next = (entry.next + 1) % POOL_SIZE;

  clip.volume = Math.max(0, Math.min(1, master * SFX_GAIN));
  clip.currentTime = 0;
  clip.play().catch(() => {
    /* autoplay policy — nothing to recover from */
  });
}
