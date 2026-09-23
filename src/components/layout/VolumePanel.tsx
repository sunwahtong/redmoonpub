import React, {useEffect, useRef, useState} from 'react';
import {Radio, SlidersHorizontal, Volume2, VolumeX} from 'lucide-react';
import {useAudioStore} from '../../stores/useAudioStore';

/**
 * The header's sound control: a toggle for the house music, and a mixer that
 * unfolds on hover, on keyboard focus, or with the sliders button (for touch).
 *
 * The mixer carries the music volume, the interface sounds switch and — while
 * the booth is live — the volume of the show, so one flyout answers every
 * "where is the sound coming from" question.
 */
export const VolumePanel: React.FC = () => {
  const {isPlaying, volume, togglePlay, setVolume, sfxMuted, setSfxMuted, live, streamUrl, streamPlaying, streamVolume, setStreamVolume, toggleStream} =
    useAudioStore();
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setPinned(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPinned(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  return (
    <div ref={wrapRef} className="rm-sound-wrap">
      <button
        type="button"
        onClick={togglePlay}
        aria-pressed={isPlaying}
        title={isPlaying ? 'Háttérzene kikapcsolása' : 'Háttérzene bekapcsolása'}
        className={`rm-sound-toggle${isPlaying ? ' is-on' : ''}`}
      >
        {isPlaying ? <Volume2 size={14} className="text-[color:var(--rm-red)]"/> : <VolumeX size={14}/>}
        <span className="hidden sm:inline">HÁTTÉRZENE</span>
        {isPlaying && <span className="rm-sound-bars" aria-hidden="true"><i/><i/><i/></span>}
      </button>

      <button
        type="button"
        onClick={() => setPinned((value) => !value)}
        aria-label="Hangbeállítások"
        title="Hangbeállítások"
        aria-expanded={pinned}
        className={`rm-sound-mixer${pinned ? ' is-on' : ''}`}
      >
        <SlidersHorizontal size={13}/>
      </button>

      <div className={`rm-volume-flyout${pinned ? ' is-open' : ''}`}>
        <div className="rm-mixer">
          <div className="rm-mixer-row">
            <span className="rm-mixer-label">HÁTTÉRZENE</span>
            <strong className="rm-mixer-value">{volume}</strong>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              aria-label="Háttérzene hangereje"
              className="rm-volume-slider"
              style={{'--vol': `${volume}%`} as React.CSSProperties}
            />
          </div>

          {live && (
            <div className="rm-mixer-row is-live">
              <span className="rm-mixer-label">
                <Radio size={9}/> ÉLŐ ADÁS
              </span>
              <strong className="rm-mixer-value">{streamVolume}</strong>
              <input
                type="range"
                min="0"
                max="100"
                value={streamVolume}
                onChange={(event) => setStreamVolume(Number(event.target.value))}
                aria-label="Élő adás hangereje"
                className="rm-volume-slider"
                style={{'--vol': `${streamVolume}%`} as React.CSSProperties}
              />
              {streamUrl && (
                <button type="button" onClick={toggleStream} className="rm-mixer-link">
                  {streamPlaying ? 'SZÜNET' : 'HALLGATOM'}
                </button>
              )}
            </div>
          )}

          <label className="rm-mixer-switch">
            <span>FELÜLET HANGJAI</span>
            <button type="button" role="switch" aria-checked={!sfxMuted} onClick={() => setSfxMuted(!sfxMuted)} className="rm-switch rm-switch-sm"/>
          </label>
        </div>
      </div>
    </div>
  );
};
