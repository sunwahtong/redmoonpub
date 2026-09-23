import React, {useEffect, useState} from 'react';
import {useLocation} from 'react-router-dom';
import {useAudioStore} from '../../stores/useAudioStore';
import {assetUrl} from '../../lib/api';

const SEEN_KEY = 'rm-intro-seen';

/**
 * The Red Moon entrance.
 *
 * Beyond atmosphere this screen does real work: browsers only allow audio to
 * start from a user gesture, and "LÉPJ BE" is that gesture — the same job the
 * legacy `#enterRedMoon` button did in site.js.
 *
 * Legacy replayed the intro on every full page load. As an SPA that would mean
 * re-playing it every time someone navigates home, so it is shown once per
 * browser session instead.
 */
export const IntroLoader: React.FC = () => {
  const {pathname} = useLocation();
  // Legacy only ever ran the entrance on the homepage.
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.location.pathname !== '/') return false;
    return sessionStorage.getItem(SEEN_KEY) !== '1';
  });
  const [leaving, setLeaving] = useState(false);
  const [ready, setReady] = useState(() => typeof document !== 'undefined' && document.readyState === 'complete');

  const togglePlay = useAudioStore((state) => state.togglePlay);
  const isPlaying = useAudioStore((state) => state.isPlaying);

  /* Enable the gate once the page has actually finished loading. */
  useEffect(() => {
    if (!visible || ready) return;
    const onLoad = () => setReady(true);
    window.addEventListener('load', onLoad, {once: true});
    // Never trap someone behind a stalled asset.
    const failsafe = window.setTimeout(() => setReady(true), 6000);
    return () => {
      window.removeEventListener('load', onLoad);
      window.clearTimeout(failsafe);
    };
  }, [visible, ready]);

  /* Lock the page behind the overlay. */
  useEffect(() => {
    if (!visible) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [visible]);

  if (!visible || pathname !== '/') return null;

  const enter = () => {
    sessionStorage.setItem(SEEN_KEY, '1');
    // This click is the gesture that lets the browser start the background music.
    if (!isPlaying) togglePlay();
    setLeaving(true);
    window.setTimeout(() => setVisible(false), 1000);
  };

  return (
    <div className={`rm-loader${leaving ? ' is-gone' : ''}`} role="dialog" aria-label="Red Moon Pub belépő">
      <div className="rm-loader-fog fog-a" aria-hidden="true"/>
      <div className="rm-loader-fog fog-b" aria-hidden="true"/>

      <div className="rm-loader-scene">
        <div className="rm-loader-moon">
          <img src={assetUrl('/assets/red-moon-logo.png')} alt="Red Moon Pub"/>
        </div>

        <div className="rm-loader-kicker">SEE CITY · AFTER DARK</div>
        <div className="rm-loader-title">
          RED MOON <i>PUB</i>
        </div>
        <div className="rm-loader-sub">AHOL AZ ÉJSZAKA KEZDŐDIK</div>

        <button type="button" className="rm-loader-enter" onClick={enter} disabled={!ready}>
          <span>{ready ? 'LÉPJ BE A RED MOON VILÁGÁBA' : 'BETÖLTÉS…'}</span>
          <b>↗</b>
        </button>
      </div>

      <div className="rm-loader-progress" aria-hidden="true">
        <span/>
      </div>

      <div className="rm-loader-corner left" aria-hidden="true">RED MOON / 017</div>
      <div className="rm-loader-corner right" aria-hidden="true">AZ ÉJSZAKA A TIÉD</div>
    </div>
  );
};
