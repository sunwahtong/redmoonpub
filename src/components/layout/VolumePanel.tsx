import React from 'react';
import {Volume2, VolumeX} from 'lucide-react';
import {useAudioStore} from '../../stores/useAudioStore';

/**
 * The luxury audio control — v65/v66. A square toggle that reveals a panel on
 * hover or keyboard focus, with a Cinzel readout and a ruby-filled track.
 */
export const VolumePanel: React.FC = () => {
  const {isPlaying, volume, togglePlay, setVolume} = useAudioStore();

  return (
    <div className="rm-sound-wrap">
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
  );
};
