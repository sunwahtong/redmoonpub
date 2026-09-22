import React, {useEffect, useRef, useState} from 'react';
import {SlidersHorizontal, Volume2, VolumeX} from 'lucide-react';
import {useAudioStore} from '../../stores/useAudioStore';

/**
 * The luxury audio control — v65/v66. A square toggle that reveals the volume
 * flyout on hover, keyboard focus, or a tap on the slider button.
 *
 * The flyout hangs from the toggle with no gap, so the pointer can move onto
 * the slider without the panel closing under it. On touch there is no hover,
 * so the small slider button pins it open instead.
 */
export const VolumePanel: React.FC = () => {
  const {isPlaying, volume, togglePlay, setVolume} = useAudioStore();
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pinned]);

  return (
    <div ref={wrapRef} className="rm-sound-wrap">
      <button
        type="button"
        onClick={togglePlay}
        aria-pressed={isPlaying}
        className={`flex items-center gap-2 border px-3 py-2 text-[9px] font-semibold tracking-[0.18em] transition-all ${
          isPlaying
            ? 'border-[color:var(--rm-red)] text-white'
            : 'border-[color:var(--rm-line)] text-[#8f8887] hover:text-white'
        }`}
      >
        {isPlaying ? <Volume2 size={14} className="text-[color:var(--rm-red)]"/> : <VolumeX size={14}/>}
        <span className="hidden sm:inline">HÁTTÉRZENE</span>
      </button>

      <button
        type="button"
        onClick={() => setPinned((value) => !value)}
        aria-label="Hangerő beállítása"
        aria-expanded={pinned}
        className={`border px-2 py-2 transition-colors ${
          pinned ? 'border-[color:var(--rm-red)] text-white' : 'border-[color:var(--rm-line)] text-[#8f8887] hover:text-white'
        }`}
      >
        <SlidersHorizontal size={13}/>
      </button>

      <div className={`rm-volume-flyout${pinned ? ' is-open' : ''}`}>
        <div className="rm-volume-panel">
          <span className="rm-volume-label">HANGERŐ</span>
          <strong className="rm-volume-value">{volume}</strong>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            aria-label="Háttérzene hangereje"
            className="rm-volume-slider"
            // Drives the ruby fill on the WebKit track.
            style={{'--vol': `${volume}%`} as React.CSSProperties}
          />
        </div>
      </div>
    </div>
  );
};
