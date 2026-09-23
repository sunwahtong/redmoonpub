import React, {useEffect} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {ChevronDown, ChevronUp, ExternalLink, Loader2, Pause, Play, Radio, Volume2, VolumeX} from 'lucide-react';
import {useHouseStatus} from '../../hooks/useHouseStatus';
import {useAudioStore} from '../../stores/useAudioStore';
import {useChromeStore} from '../../stores/useChromeStore';

/**
 * The show, everywhere.
 *
 * Appears in the corner of every page while the station is on air. The house
 * music has already stepped aside (the audio store does that the moment
 * `live` flips, and if the music was on the show is already playing); this
 * is the visitor's handle on it: play or pause it here, set its volume, mute
 * it, or go to the club. Folds to a chip on request.
 */
export const LivePopup: React.FC = () => {
  const {data} = useHouseStatus();
  const location = useLocation();
  const {live, streamUrl, streamPlaying, streamLoading, streamVolume, streamMuted, streamError, setLive, toggleStream, setStreamVolume, toggleStreamMuted} = useAudioStore();
  const minimized = useChromeStore((state) => state.liveMinimized);
  const setMinimized = useChromeStore((state) => state.setLiveMinimized);

  // The store follows the status feed; every page shares the same audio element.
  useEffect(() => {
    if (!data) return;
    // Only something audible interrupts the music: a booth that is "live" over a silent station is not a show yet.
    setLive(!!data.onAir, data.onAir ? data.streamUrl || null : null);
  }, [data, setLive]);

  if (!data || !live) return null;

  // The booth has its own monitor, and the club page has the stage: no popup there.
  if (location.pathname === '/dj' || location.pathname === '/club') return null;

  const listeners = Math.max(data.listenerCount, data.stationListeners);
  const playing = data.nowPlaying ? `${data.nowPlaying.artist ? `${data.nowPlaying.artist} – ` : ''}${data.nowPlaying.title}` : '';

  if (minimized) {
    return (
      <button type="button" className="rm-live-chip" onClick={() => setMinimized(false)} aria-label="Élő adás megnyitása">
        <span className="rm-live-dot" aria-hidden="true"/>
        ÉLŐ · {data.dj || 'RED MOON'}
        {streamPlaying && <span className="rm-sound-bars" aria-hidden="true"><i/><i/><i/></span>}
        <ChevronUp size={12}/>
      </button>
    );
  }

  return (
    <aside className="rm-live-pop" aria-live="polite">
      <div className="rm-live-head">
        <span className="rm-live-badge">
          <span className="rm-live-dot" aria-hidden="true"/> ÉLŐ ADÁS
        </span>
        <span className="text-[9px] tracking-[0.18em] text-[#8d8584]">{listeners} HALLGATÓ</span>
        <button type="button" onClick={() => setMinimized(true)} aria-label="Összecsukás" className="rm-live-fold">
          <ChevronDown size={14}/>
        </button>
      </div>

      <div className="rm-live-body">
        <span className="rm-live-glyph" aria-hidden="true">音</span>
        <strong className="rm-live-title">{data.title || 'Red Moon Live'}</strong>
        <span className="rm-live-dj">
          <Radio size={10}/> {data.dj || 'Red Moon DJ'} a pultban
        </span>
        {playing && <span className="rm-live-track" title={playing}>♪ {playing}</span>}

        {streamUrl ? (
          <div className="rm-live-controls">
            <button type="button" onClick={toggleStream} className={`rm-live-play${streamPlaying || streamLoading ? ' is-on' : ''}`} aria-label={streamPlaying || streamLoading ? 'Szünet' : 'Lejátszás'}>
              {streamLoading ? <Loader2 size={15} className="animate-spin"/> : streamPlaying ? <Pause size={15}/> : <Play size={15}/>}
            </button>
            <button type="button" onClick={toggleStreamMuted} className="rm-live-mute" aria-label={streamMuted ? 'Hang vissza' : 'Némítás'}>
              {streamMuted ? <VolumeX size={14}/> : <Volume2 size={14}/>}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={streamMuted ? 0 : streamVolume}
              onChange={(event) => setStreamVolume(Number(event.target.value))}
              aria-label="Élő adás hangereje"
              className="rm-volume-slider flex-1"
              style={{'--vol': `${streamMuted ? 0 : streamVolume}%`} as React.CSSProperties}
            />
          </div>
        ) : (
          <p className="mt-3 text-[10px] leading-[1.7] text-[#8d8584]">Az adás címe még nincs beállítva. A klub oldalon a GoCast lejátszó szól.</p>
        )}
        {streamError && <p className="mt-2 text-[10px] text-[color:var(--rm-red)]">{streamError}</p>}

        <div className="rm-live-links">
          <Link to="/club" className="rm-btn is-red !px-3 !py-2 !text-[8px]">
            A KLUBBA ↗
          </Link>
          {data.providerUrl && (
            <a href={data.providerUrl} target="_blank" rel="noreferrer" className="rm-btn !px-3 !py-2 !text-[8px]">
              GOCAST <ExternalLink size={10}/>
            </a>
          )}
        </div>
      </div>
    </aside>
  );
};
