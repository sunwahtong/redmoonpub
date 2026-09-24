import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ExternalLink, Headphones, Loader2, Pause, Play, Radio, Users, Volume2, VolumeX} from 'lucide-react';
import {clubClientId, type ClubState, type Identity} from '../../hooks/useClub';
import {useLiveEvent} from '../../hooks/useLiveData';
import {useElapsed} from '../../hooks/useElapsed';
import {apiSend, assetUrl} from '../../lib/api';
import {isRealtimeConnected} from '../../lib/realtime';
import {playSfx} from '../../lib/sfx';
import {useAudioStore} from '../../stores/useAudioStore';
import {trackLine} from './Setlist';

/** Must match the server's list. */
export const REACTIONS = ['🔥', '❤️', '🍻', '🎉', '👏', '🙌'];

interface Float {
  id: number;
  emoji: string;
  color: string;
  x: number;
}

/** Reactions in the last minute, as the room reads them. */
export function vibeLabel(vibe: number): string {
  if (vibe <= 0) return 'CSEND';
  if (vibe < 5) return 'MOZGOLÓDÁS';
  if (vibe < 15) return 'BULI';
  return 'TOMBOL A HÁZ';
}

export const VibeMeter: React.FC<{vibe: number; className?: string}> = ({vibe, className = ''}) => (
  <div className={`rm-vibe ${className}`} title={`${vibe} reakció az elmúlt percben`}>
    <span className="rm-vibe-label">HANGULAT</span>
    <span className="rm-vibe-bar" aria-hidden="true">
      <i style={{width: `${Math.min(100, vibe * 5)}%`}}/>
    </span>
    <span className="rm-vibe-value">{vibeLabel(vibe)}</span>
  </div>
);

interface Props {
  state: ClubState;
  identity: Identity;
}

/**
 * The stage: who is in the booth, what is on, the player, and the room's
 * reactions floating up over it. The player is the site's own audio element
 * (see useAudioStore) so the mixer, the popup and this card are one thing.
 */
export const Stage: React.FC<Props> = ({state, identity}) => {
  const audio = useAudioStore();
  const elapsed = useElapsed(state.live ? state.startedAt : null);
  const [floats, setFloats] = useState<Float[]>([]);
  const [showEmbed, setShowEmbed] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const counter = useRef(0);

  const spawn = useCallback((emoji: string, color: string) => {
    counter.current += 1;
    const id = counter.current;
    setFloats((current) => [...current.slice(-24), {id, emoji, color, x: 8 + Math.random() * 84}]);
    window.setTimeout(() => setFloats((current) => current.filter((entry) => entry.id !== id)), 2600);
  }, []);

  /* Every reaction has an id; each is shown once whichever way it arrives. */
  const seen = useRef(new Set<number>());
  const primed = useRef(false);
  const remember = (id: number) => {
    seen.current.add(id);
    if (seen.current.size > 600) seen.current = new Set([...seen.current].slice(-300));
  };

  // Pushes: everyone's taps, our own included (the server sends them all).
  useLiveEvent('club', (event, payload) => {
    if (event !== 'reaction' || typeof payload.emoji !== 'string') return;
    const id = Number(payload.id) || 0;
    if (id) {
      if (seen.current.has(id)) return;
      remember(id);
    }
    spawn(payload.emoji, String(payload.color || ''));
  });

  // Polled state: whatever no push delivered (no socket yet, a dropped message).
  useEffect(() => {
    const recent = state.recentReactions || [];
    if (!primed.current) {
      primed.current = true;
      for (const entry of recent) remember(entry.id);
      return;
    }
    for (const entry of [...recent].reverse()) {
      if (seen.current.has(entry.id)) continue;
      remember(entry.id);
      spawn(entry.emoji, entry.color);
    }
  }, [state.recentReactions, spawn]);

  const react = async (emoji: string) => {
    if (cooldown) return;
    setCooldown(true);
    window.setTimeout(() => setCooldown(false), 2500);
    try {
      const reply = await apiSend<{id?: number}>('/api/club/react', 'POST', {emoji, clientId: clubClientId(), token: identity.token || undefined});
      // No socket right now: nothing will push our own tap back, so show it here.
      if (!isRealtimeConnected() && reply.id && !seen.current.has(reply.id)) {
        remember(reply.id);
        spawn(emoji, identity.color);
      }
      playSfx('ui_click');
    } catch {
      /* the room is cheering faster than the budget allows; the tap still counted */
    }
  };

  const live = state.live;
  const playing = audio.streamPlaying;
  const streamUrl = audio.streamUrl || state.streamUrl;
  const current = state.station.nowPlaying?.title ? state.station.nowPlaying : state.setlist[0] ? {title: state.setlist[0].title, artist: state.setlist[0].artist} : null;
  const listeners = Math.max(state.listenerCount, state.station.listeners);

  return (
    <div className={`rm-stage${live ? ' is-live' : ''}${live && playing ? ' is-on' : ''}`}>
      <div className="rm-float-layer" aria-hidden="true">
        {floats.map((entry) => (
          <span key={entry.id} className="rm-float" style={{left: `${entry.x}%`, '--c': entry.color || 'transparent'} as React.CSSProperties}>
            {entry.emoji}
          </span>
        ))}
      </div>

      <div className="rm-stage-grid">
        <div className="rm-stage-dj">
          {state.djAvatar ? <img src={assetUrl(state.djAvatar)} alt="" className="rm-stage-avatar"/> : <span className="rm-now-disc rm-stage-disc" aria-hidden="true"/>}
          <span className={`rm-stage-badge${live ? ' is-live' : ''}`}>
            <Radio size={9}/> {live ? 'ÉLŐ' : 'OFFLINE'}
          </span>
        </div>

        <div className="relative min-w-0">
          <span className="rm-label">{live ? 'A PULTBAN' : 'A PULT'}</span>
          <h2 className="mt-2 font-heading text-[26px] leading-tight text-white">{live ? state.title || 'Red Moon Live' : 'Csend van a pultban.'}</h2>
          <p className="mt-2 text-[11px] leading-[1.8] text-[#a09998]">
            {live ? (
              <>
                <b className="text-white">{state.dj || 'Red Moon DJ'}</b> a pultban
                {elapsed ? <span className="rm-live-timer"> · {elapsed}</span> : null}
                {state.autoLive ? ' · a rádió sugároz' : ''}
              </>
            ) : (
              'Amint a DJ adásba lép, itt szól — a háttérzene magától elhallgat. A chat, a kérések és a szavazás addig is élnek.'
            )}
          </p>

          {live && current && (
            <div className="rm-stage-track">
              <span className="rm-eq is-on w-10 shrink-0" aria-hidden="true">
                {Array.from({length: 5}, (_, index) => (
                  <i key={index} style={{animationPlayState: playing ? 'running' : 'paused'}}/>
                ))}
              </span>
              <span className="min-w-0">
                <i className="block text-[7px] not-italic tracking-[0.3em] text-[color:var(--rm-red-bright)]">MOST SZÓL</i>
                <strong className="block truncate text-[13px] text-white" title={trackLine(current)}>{trackLine(current)}</strong>
              </span>
            </div>
          )}

          {live && !state.onAir && <p className="rm-stage-silent">A rádió most csendes. Amint a DJ elindítja a streamet, itt szól — a háttérzene addig marad.</p>}

          {live && state.onAir && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {streamUrl ? (
                <>
                  <button type="button" onClick={audio.toggleStream} className={`rm-live-play${playing || audio.streamLoading ? ' is-on' : ''}`} aria-label={playing ? 'Szünet' : 'Lejátszás'}>
                    {audio.streamLoading ? <Loader2 size={15} className="animate-spin"/> : playing ? <Pause size={15}/> : <Play size={15}/>}
                  </button>
                  <button type="button" onClick={audio.toggleStreamMuted} className="rm-live-mute" aria-label={audio.streamMuted ? 'Hang vissza' : 'Némítás'}>
                    {audio.streamMuted ? <VolumeX size={15}/> : <Volume2 size={15}/>}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={audio.streamMuted ? 0 : audio.streamVolume}
                    onChange={(event) => audio.setStreamVolume(Number(event.target.value))}
                    aria-label="Adás hangereje"
                    className="rm-volume-slider w-40"
                    style={{'--vol': `${audio.streamMuted ? 0 : audio.streamVolume}%`} as React.CSSProperties}
                  />
                  <span className={`rm-eq w-24${playing ? ' is-on' : ''}`} aria-hidden="true">
                    {Array.from({length: 14}, (_, index) => (
                      <i key={index}/>
                    ))}
                  </span>
                </>
              ) : (
                <span className="text-[10px] text-[#8d8584]">A stream címe még nincs beállítva.</span>
              )}
              {state.embedUrl && (
                <button type="button" onClick={() => setShowEmbed((value) => !value)} className={`rm-btn is-ghost !px-3 !py-2 !text-[8px]${showEmbed ? ' is-on' : ''}`}>
                  <Headphones size={10}/> {showEmbed ? 'LEJÁTSZÓ ELREJTÉSE' : 'GOCAST LEJÁTSZÓ'}
                </button>
              )}
              {state.providerUrl && (
                <a href={state.providerUrl} target="_blank" rel="noreferrer" className="rm-btn !px-3 !py-2 !text-[8px]">
                  ÁLLOMÁS <ExternalLink size={10}/>
                </a>
              )}
              {audio.streamError && <span className="text-[10px] text-[color:var(--rm-red)]">{audio.streamError}</span>}
            </div>
          )}
        </div>

        <div className="rm-stage-meta">
          <span>
            <Users size={11}/> <b>{listeners}</b> hallgató
          </span>
          <span>
            <Radio size={11}/> <b>{state.station.listeners}</b> a rádión
          </span>
          {live && (
            <span>
              csúcs ma <b>{state.peakListeners}</b>
            </span>
          )}
        </div>
      </div>

      {showEmbed && state.embedUrl && (
        <div className="rm-embed">
          <iframe src={state.embedUrl} title="GoCast lejátszó" allow="autoplay" loading="lazy"/>
        </div>
      )}

      <div className="rm-stage-foot">
        <div className="rm-react-bar" role="group" aria-label="Reakciók">
          {REACTIONS.map((emoji) => (
            <button key={emoji} type="button" onClick={() => react(emoji)} disabled={!live || cooldown} className="rm-react-btn" aria-label={`Reakció: ${emoji}`}>
              {emoji}
            </button>
          ))}
        </div>
        <VibeMeter vibe={state.vibe}/>
      </div>
    </div>
  );
};
