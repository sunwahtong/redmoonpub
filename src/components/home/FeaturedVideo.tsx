import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Play, Volume2, VolumeX, X} from 'lucide-react';
import {useAudioStore} from '../../stores/useAudioStore';
import {playSfx} from '../../lib/sfx';

export interface FeaturedClip {
  id: string;
  title: string;
  caption: string;
}

const HOST = 'https://www.youtube-nocookie.com';
/** YouTube fades its title bar and centre controls a few seconds into playback; the preview is revealed after that. */
const REVEAL_DELAY_MS = 1100;
/** How long after landing the first-visit teaser slides in. */
const TEASER_DELAY_MS = 2600;
const TEASER_KEY = 'rm-film-teased';

/** Player commands over the IFrame API's postMessage channel, no script needed. */
function command(frame: HTMLIFrameElement | null, func: 'playVideo' | 'pauseVideo' | 'mute' | 'unMute'): void {
  frame?.contentWindow?.postMessage(JSON.stringify({event: 'command', func, args: []}), HOST);
}

/**
 * The house's film, high on the home page.
 *
 * A muted preview of the YouTube clip plays by itself while it is in view
 * and pauses when scrolled away. It is cropped so none of YouTube's chrome
 * shows, and the frame only appears once the player reports it is playing
 * and its overlays have faded — until then the clip's own still stands in,
 * under the house's overlay. So it reads as part of the page rather than an
 * embedded player. One tap opens the film large, with sound and the real
 * controls; the house music steps aside for the duration.
 */
export const FeaturedVideo: React.FC<{clip: FeaturedClip}> = ({clip}) => {
  const shellRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  /* Once per browser: a card that points at the film, for those who never scroll. */
  const [teaser, setTeaser] = useState(false);
  const musicWasOn = useRef(false);
  const {isPlaying, togglePlay} = useAudioStore();

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {threshold: 0.35});
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /* The player's own state, so the frame is only shown while it really plays. */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== HOST || event.source !== previewRef.current?.contentWindow) return;
      let data: {event?: string; info?: unknown};
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      const state =
        data.event === 'onStateChange'
          ? Number(data.info)
          : data.event === 'infoDelivery' && data.info && typeof data.info === 'object' && 'playerState' in data.info
            ? Number((data.info as {playerState: unknown}).playerState)
            : null;
      if (state === null || Number.isNaN(state)) return;
      // 1 playing, 3 buffering (keep whatever it was); anything else is a still frame with chrome on it.
      // Once playing it stays revealed through pauses; only a stop or end hides it again.
      if (state === 1) setPlaying(true);
      else if (state === 0 || state === -1 || state === 5) setPlaying(false);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!playing) {
      setRevealed(false);
      return;
    }
    const timer = window.setTimeout(() => setRevealed(true), REVEAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [playing]);

  /* Plays from page load so it is already running when the visitor reaches it; pauses only once seen and scrolled past. */
  const seen = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (inView) seen.current = true;
    if (!inView && !seen.current && !open) return;
    command(previewRef.current, inView && !open ? 'playVideo' : 'pauseVideo');
  }, [inView, loaded, open]);

  useEffect(() => {
    if (localStorage.getItem(TEASER_KEY) === clip.id) return;
    const timer = window.setTimeout(() => setTeaser(true), TEASER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [clip.id]);

  const dismissTeaser = () => {
    localStorage.setItem(TEASER_KEY, clip.id);
    setTeaser(false);
  };

  const onPreviewLoad = () => {
    setLoaded(true);
    // Ask the player to report its state changes.
    previewRef.current?.contentWindow?.postMessage(JSON.stringify({event: 'listening', id: 'rm-film', channel: 'widget'}), HOST);
  };

  const openFilm = useCallback(() => {
    musicWasOn.current = isPlaying;
    if (isPlaying) togglePlay();
    setOpen(true);
    playSfx('open');
  }, [isPlaying, togglePlay]);

  const closeFilm = useCallback(() => {
    setOpen(false);
    if (musicWasOn.current) togglePlay();
    musicWasOn.current = false;
  }, [togglePlay]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFilm();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, closeFilm]);

  const origin = typeof window !== 'undefined' ? encodeURIComponent(window.location.origin) : '';
  const preview = `${HOST}/embed/${clip.id}?autoplay=1&mute=1&controls=0&loop=1&playlist=${clip.id}&modestbranding=1&rel=0&playsinline=1&enablejsapi=1&disablekb=1&iv_load_policy=3&fs=0&origin=${origin}`;
  const full = `${HOST}/embed/${clip.id}?autoplay=1&controls=1&modestbranding=1&rel=0&playsinline=1&enablejsapi=1&iv_load_policy=3&origin=${origin}`;
  /* The clip's own still: the large one when YouTube has it, the standard one otherwise. */
  const poster = `url(https://i.ytimg.com/vi/${clip.id}/maxresdefault.jpg), url(https://i.ytimg.com/vi/${clip.id}/hqdefault.jpg)`;

  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    command(previewRef.current, next ? 'mute' : 'unMute');
  };

  return (
    <section id="film" className="rm-film" aria-label={clip.title || 'A ház filmje'}>
      {teaser && !open && (
        <div className="rm-film-teaser" role="dialog" aria-label="A ház filmje">
          <button type="button" className="rm-film-teaser-poster" style={{backgroundImage: poster}} onClick={() => {dismissTeaser(); openFilm();}} aria-label="Film megnyitása">
            <span className="rm-film-play-disc"><Play size={16}/></span>
          </button>
          <div className="rm-film-teaser-body">
            <span className="rm-label">ÚJ · A HÁZ FILMJE</span>
            <strong>{clip.title || 'Red Moon'}</strong>
            {clip.caption && <p>{clip.caption}</p>}
            <div className="rm-film-teaser-actions">
              <button type="button" className="rm-btn is-red" onClick={() => {dismissTeaser(); openFilm();}}>MEGNÉZEM</button>
              <button type="button" className="rm-film-teaser-later" onClick={dismissTeaser}>KÉSŐBB</button>
            </div>
          </div>
          <button type="button" className="rm-film-teaser-close" onClick={dismissTeaser} aria-label="Bezárás"><X size={13}/></button>
        </div>
      )}
      <div ref={shellRef} className={`rm-film-frame${revealed && !open ? ' is-loaded' : ''}`} style={{backgroundImage: poster}}>
        {(
          <iframe
            ref={previewRef}
            src={preview}
            title={clip.title || 'Red Moon'}
            allow="autoplay; encrypted-media; picture-in-picture"
            onLoad={onPreviewLoad}
            tabIndex={-1}
            aria-hidden="true"
          />
        )}
        <div className="rm-film-shade" aria-hidden="true"/>
        <div className="rm-film-grain" aria-hidden="true"/>

        <div className="rm-film-body">
          <span className="rm-label">A HÁZ FILMJE</span>
          {clip.title && <h2 className="rm-film-title">{clip.title}</h2>}
          {clip.caption && <p className="rm-film-caption">{clip.caption}</p>}
          <div className="rm-film-actions">
            <button type="button" onClick={openFilm} className="rm-film-play">
              <span className="rm-film-play-disc" aria-hidden="true">
                <Play size={18}/>
              </span>
              MEGNÉZEM
            </button>
            <button type="button" onClick={toggleMuted} className="rm-film-mute" aria-pressed={!muted} title={muted ? 'Hang be' : 'Némítás'}>
              {muted ? <VolumeX size={12}/> : <Volume2 size={12}/>}
              {muted ? 'NÉMA ELŐNÉZET' : 'HANGGAL'}
            </button>
          </div>
        </div>
        <span className="rm-film-corner tl" aria-hidden="true"/>
        <span className="rm-film-corner br" aria-hidden="true"/>
      </div>

      {open && (
        <div className="rm-film-modal" role="dialog" aria-modal="true" aria-label={clip.title || 'A ház filmje'}>
          <button type="button" className="rm-film-backdrop" onClick={closeFilm} aria-label="Bezárás"/>
          <div className="rm-film-stage">
            <div className="rm-film-stage-head">
              <span className="rm-label">A HÁZ FILMJE</span>
              <strong className="truncate font-heading text-[16px] text-white">{clip.title || 'Red Moon'}</strong>
              <button type="button" onClick={closeFilm} className="rm-film-close" aria-label="Bezárás">
                <X size={16}/>
              </button>
            </div>
            <div className="rm-film-stage-frame">
              <iframe src={full} title={clip.title || 'Red Moon'} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen/>
            </div>
            {clip.caption && <p className="rm-film-stage-caption">{clip.caption}</p>}
          </div>
        </div>
      )}
    </section>
  );
};
