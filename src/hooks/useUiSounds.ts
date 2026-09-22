import {useEffect} from 'react';
import {playSfx} from '../lib/sfx';

/** Elements that should click. Mirrors the legacy site.js selector list. */
const CLICKABLE = 'a[href], button, [role="button"], .rm-btn';

/**
 * One delegated listener for the whole site, instead of wiring an onClick into
 * every control. Runs on the capture phase so it still fires when a handler
 * stops propagation.
 */
export function useUiSounds(): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest) return;

      const hit = target.closest<HTMLElement>(CLICKABLE);
      if (!hit || hit.hasAttribute('disabled') || hit.dataset.noSound === 'true') return;

      playSfx('ui_click');
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}
