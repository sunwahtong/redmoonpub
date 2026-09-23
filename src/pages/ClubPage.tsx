import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {Ban, Check, Disc3, ExternalLink, MessageSquare, Music2, Palette, Pause, Play, Radio, Send, Trash2, UserMinus, Users, Volume2, VolumeX, X} from 'lucide-react';
import {PageHero} from '../components/ui/PageHero';
import {Btn} from '../components/ui/Btn';
import {clubClientId, useClub, useClubIdentity, type ClubChatMessage, type RegisteredListener} from '../hooks/useClub';
import {apiSend, formatTime} from '../lib/api';
import {realtimeAvailable} from '../lib/realtime';
import {playSfx} from '../lib/sfx';
import {dialog} from '../stores/useDialogStore';
import {toast} from '../stores/useToastStore';
import {useAudioStore} from '../stores/useAudioStore';
import {useAuthStore} from '../stores/useAuthStore';

const CHAT_MAX = 500;
const PALETTE = ['#ff5c7a', '#ff9f43', '#ffd166', '#2ee6a6', '#4cc9f0', '#5b8cff', '#c77dff', '#f472b6', '#9ef01a', '#ff8fab', '#00e5ff', '#ffb347'];

const initialOf = (name: string) => (name || '?').trim().slice(0, 1).toUpperCase();

/* ------------------------------------------------------------------ */
/* Chat line                                                           */
/* ------------------------------------------------------------------ */

const Bubble: React.FC<{message: ClubChatMessage; self: boolean; canDelete: boolean; onDelete: () => void}> = ({message, self, canDelete, onDelete}) => {
  if (message.kind === 'system' || message.kind === 'request-accepted' || message.kind === 'request-declined') {
    return (
      <div className={`rm-chat-system${message.kind === 'request-accepted' ? ' is-accept' : message.kind === 'request-declined' ? ' is-decline' : ''}`}>
        {message.text}
        <span className="ml-2 text-[#5f5959]">{formatTime(message.at)}</span>
      </div>
    );
  }
  const dj = message.kind === 'dj';
  const color = dj ? '#ff2b4f' : message.color || PALETTE[0];
  return (
    <div className={`rm-bubble${self ? ' is-self' : ''}${dj ? ' is-dj' : ''}${message.kind === 'request' ? ' is-request' : ''}`} style={{'--bubble': color} as React.CSSProperties}>
      <span className="rm-bubble-avatar" aria-hidden="true">
        {dj ? <Disc3 size={13}/> : initialOf(message.name)}
      </span>
      <div className="rm-bubble-body">
        <div className="rm-bubble-meta">
          <span className="rm-bubble-name">{message.name}</span>
          <span className="rm-bubble-time">{formatTime(message.at)}</span>
        </div>
        <p className="rm-bubble-text">{message.text}</p>
      </div>
      {canDelete && (
        <button type="button" onClick={onDelete} aria-label="Üzenet törlése" className="rm-chat-delete">
          <Trash2 size={12}/>
        </button>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export const ClubPage: React.FC = () => {
  const {state, appendLocal, refresh} = useClub();
  const {identity, setColor, setIdentity, refresh: refreshIdentity} = useClubIdentity();
  const user = useAuthStore((state) => state.user);
  const audio = useAudioStore();

  const [wantedName, setWantedName] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'chat' | 'request'>('chat');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showSwatches, setShowSwatches] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  /** Moderation follows the DJ capability: the DJ job, managers and owners. */
  const canModerate = !!user && user.capabilities.dj;
  const approved = identity.status === 'accepted' && !!identity.token;
  const myName = canModerate ? user!.nickname || user!.name : identity.name;

  /* Presence heartbeat — drives the listener counter. */
  useEffect(() => {
    const id = clubClientId();
    const beat = () => apiSend('/api/club/listener', 'POST', {id}).catch(() => {});
    beat();
    const timer = window.setInterval(beat, 15000);
    return () => window.clearInterval(timer);
  }, []);

  /* Chronological order for reading; the API returns newest first. */
  const lines = useMemo(() => [...(state?.chat || [])].reverse(), [state?.chat]);

  /* Keep the view pinned to the newest line unless the reader scrolled up. */
  useEffect(() => {
    const element = chatRef.current;
    if (!element) return;
    if (stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const onChatScroll = () => {
    const element = chatRef.current;
    if (!element) return;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
  };

  const retryIn = identity.retryAt ? Math.max(0, Math.ceil((identity.retryAt - Date.now()) / 1000)) : 0;

  const requestName = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const data = await apiSend<{approved?: boolean; token?: string; name?: string; color?: string}>('/api/club/name-request', 'POST', {
        name: wantedName.trim(),
        clientId: clubClientId()
      });
      if (data.approved && data.token) {
        setIdentity((current) => ({...current, status: 'accepted', token: data.token || '', name: data.name || current.name, color: data.color || current.color}));
        localStorage.setItem('rm-club-token', data.token);
        playSfx('success');
        return;
      }
      setIdentity((current) => ({...current, status: 'pending', name: wantedName.trim()}));
      playSfx('accept');
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setError(null);
    setSending(true);
    try {
      if (mode === 'request') {
        await apiSend('/api/club/request', 'POST', {token: identity.token, title: value});
        toast.success('Kérés elküldve', 'A DJ látja a pultban.');
        setMode('chat');
      } else if (canModerate) {
        const data = await apiSend<{message: ClubChatMessage}>('/api/dj/chat', 'POST', {text: value});
        if (data.message) appendLocal(data.message);
      } else {
        const data = await apiSend<{message: ClubChatMessage}>('/api/club/chat', 'POST', {name: identity.name, text: value, token: identity.token});
        if (data.message) appendLocal(data.message);
      }
      setText('');
      stickToBottom.current = true;
      playSfx('chat_message');
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    } finally {
      setSending(false);
    }
  };

  const decide = async (id: string, action: 'accept' | 'decline') => {
    try {
      await apiSend('/api/club/name-decision', 'POST', {id, action});
      playSfx(action === 'accept' ? 'accept' : 'decline');
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const banListener = async (listener: RegisteredListener) => {
    const reason = await dialog.prompt({
      title: `${listener.name} kitiltása`,
      message: 'Egy órára tiltod a chatből. Az indokot a hallgató is látja.',
      label: 'INDOK',
      placeholder: 'pl. sértő üzenetek',
      confirmLabel: 'KITILTÁS',
      tone: 'danger',
      validate: (value) => (value.trim() ? null : 'Indok nélkül nem tiltunk.')
    });
    if (!reason?.trim()) return;
    try {
      await apiSend('/api/club/ban', 'POST', {ip: listener.ip, browserHash: listener.browserHash, minutes: 60, reason: reason.trim()});
      playSfx('decline');
      refresh();
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    }
  };

  const kickListener = async (listener: RegisteredListener) => {
    const sure = await dialog.confirm({title: `${listener.name} eltávolítása?`, message: 'A neve megszűnik, újat kell kérnie.', confirmLabel: 'ELTÁVOLÍTÁS', tone: 'danger'});
    if (!sure) return;
    try {
      await apiSend('/api/club/listener-action', 'POST', {action: 'remove', ip: listener.ip, browserHash: listener.browserHash});
      playSfx('delete');
      refresh();
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    }
  };

  const deleteMessage = async (id: string) => {
    try {
      await apiSend(`/api/club/chat/${id}`, 'DELETE');
      playSfx('delete');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const pickColor = async (color: string) => {
    try {
      await setColor(color);
      setShowSwatches(false);
      playSfx('success');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
    }
  };

  const live = !!state?.live;
  const canWrite = approved || canModerate;

  return (
    <main>
      <PageHero
        kicker="RED MOON / 07"
        overline="THE"
        title="CLUB"
        lead="Élő adás, chat és zenei kérések. A ház belső köre, ahol a DJ-vel egy térben vagy — bárhonnan."
      >
        <div className="mt-8 flex flex-wrap gap-2.5 text-[9px] font-bold tracking-[0.2em]">
          <span className={`flex items-center gap-2 border px-4 py-2.5 ${live ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.18)] text-white' : 'border-white/10 text-[#8f8887]'}`}>
            <Radio size={11} className={live ? 'animate-pulse text-[color:var(--rm-red)]' : ''}/>
            {live ? `ÉLŐ · ${state?.dj || 'RED MOON DJ'}` : 'JELENLEG NINCS ADÁS'}
          </span>
          <span className="flex items-center gap-2 border border-white/10 px-4 py-2.5 text-[#8f8887]">
            <Users size={11}/> {state?.listenerCount ?? 0} A KLUBBAN
          </span>
          <span className="flex items-center gap-2 border border-white/10 px-4 py-2.5 text-[#8f8887]" title={realtimeAvailable ? 'Azonnali frissítés' : 'Rendszeres frissítés'}>
            <span className={`h-1.5 w-1.5 rounded-full ${state ? 'bg-emerald-400' : 'bg-amber-400'}`}/> {state ? (realtimeAvailable ? 'ÉLŐ KAPCSOLAT' : 'KAPCSOLÓDVA') : 'KAPCSOLÓDÁS…'}
          </span>
          {canModerate && (
            <Link to="/dj" className="rm-btn is-ghost !px-4 !py-2.5 !text-[9px]">
              <Disc3 size={12}/> DJ PULT ↗
            </Link>
          )}
        </div>
      </PageHero>

      <section className="rm-section">
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          {/* ------------------------------------------------ MAIN COLUMN */}
          <div className="flex flex-col gap-3.5 lg:col-span-2">
            {/* Now playing / the show */}
            <div className={`rm-now p-6 md:p-7${live && audio.streamPlaying ? ' is-on' : ''}`}>
              <div className="relative flex flex-col gap-5 md:flex-row md:items-center">
                <span className="rm-now-disc" aria-hidden="true"/>
                <div className="min-w-0 flex-1">
                  <span className="rm-label">{live ? 'MOST SZÓL' : 'A PULT'}</span>
                  <h2 className="mt-2 font-heading text-[24px] leading-tight text-white">{live ? state?.title || 'Red Moon Live' : 'Csend van a pultban.'}</h2>
                  <p className="mt-2 text-[11px] leading-[1.8] text-[#a09998]">
                    {live
                      ? `${state?.dj || 'A Red Moon DJ'} a pultban${state?.current?.name ? ` · ${state.current.name}` : ''}. Kapcsolj be, és írj a chatbe.`
                      : 'Amint a DJ adásba lép, itt szól. A chat és a kérések addig is élnek.'}
                  </p>
                  {live && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {state?.streamUrl ? (
                        <>
                          <button type="button" onClick={audio.toggleStream} className={`rm-live-play${audio.streamPlaying ? ' is-on' : ''}`} aria-label={audio.streamPlaying ? 'Szünet' : 'Lejátszás'}>
                            {audio.streamPlaying ? <Pause size={15}/> : <Play size={15}/>}
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
                          <span className="rm-eq is-on w-24" aria-hidden="true">
                            {Array.from({length: 14}, (_, index) => (
                              <i key={index} style={{animationPlayState: audio.streamPlaying ? 'running' : 'paused'}}/>
                            ))}
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-[#8d8584]">A műsor a gocast.fm-en szól — nyisd meg ott.</span>
                      )}
                      {state?.providerUrl && (
                        <a href={state.providerUrl} target="_blank" rel="noreferrer" className="rm-btn !px-3 !py-2 !text-[8px]">
                          GOCAST <ExternalLink size={10}/>
                        </a>
                      )}
                      {audio.streamError && <span className="text-[10px] text-[color:var(--rm-red)]">{audio.streamError}</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Chat */}
            <div className="rm-card flex flex-col p-0">
              <div className="flex items-center justify-between border-b border-[color:var(--rm-line)] px-6 py-4">
                <span className="rm-label flex items-center gap-2">
                  <MessageSquare size={11}/> KLUB CHAT
                </span>
                <span className="text-[9px] text-[#777]">{state?.people.length ?? 0} néven · {lines.length} üzenet</span>
              </div>

              <div ref={chatRef} onScroll={onChatScroll} className="rm-chat max-h-[520px] min-h-[320px]">
                {!lines.length && <p className="text-[11px] text-[#8d8584]">Még nincs üzenet. Légy te az első.</p>}
                {lines.map((message) => (
                  <Bubble
                    key={message.id}
                    message={message}
                    self={!!myName && message.name === myName && message.kind !== 'system'}
                    canDelete={canModerate}
                    onDelete={() => deleteMessage(message.id)}
                  />
                ))}
              </div>

              {canWrite ? (
                <form onSubmit={send} className="rm-chat-composer">
                  {!canModerate && (
                    <button type="button" onClick={() => setMode(mode === 'chat' ? 'request' : 'chat')} className={`rm-chat-mode${mode === 'request' ? ' is-on' : ''}`} title="Zenét kérek">
                      <Music2 size={11}/> {mode === 'request' ? 'KÉRÉS' : 'ZENÉT KÉREK'}
                    </button>
                  )}
                  <input
                    value={text}
                    onChange={(event) => setText(event.target.value.slice(0, CHAT_MAX))}
                    placeholder={mode === 'request' ? 'Előadó – cím, amit hallanál…' : `Üzenet ${myName} néven…`}
                    className="rm-input"
                    maxLength={CHAT_MAX}
                  />
                  <Btn type="submit" variant="red" disabled={sending || !text.trim()}>
                    <Send size={13}/>
                  </Btn>
                </form>
              ) : (
                <div className="border-t border-[color:var(--rm-line)] p-6">
                  {identity.status === 'pending' ? (
                    <p className="text-[11px] text-[#8d8584]">
                      <b className="text-white">{identity.name}</b> — a neved jóváhagyásra vár a DJ-nél. Amint dönt, itt írhatsz.
                    </p>
                  ) : identity.status === 'banned' ? (
                    <p className="text-[11px] text-[color:var(--rm-red)]">A chat számodra le van tiltva. {identity.reason ? `Indok: ${identity.reason}` : ''}</p>
                  ) : identity.status === 'already_named' ? (
                    <p className="text-[11px] text-[#8d8584]">
                      Erről a hálózatról már van aktív név: <b className="text-white">{identity.name}</b>.
                    </p>
                  ) : (
                    <form onSubmit={requestName} className="flex flex-col gap-3">
                      <span className="text-[8px] tracking-[0.25em] text-[#777]">
                        {identity.status === 'declined' && retryIn > 0 ? `ELUTASÍTVA · ÚJRA ${retryIn} MP MÚLVA` : 'VÁLASSZ MEGJELENÉSI NEVET, ÉS A DJ BEENGED'}
                      </span>
                      <div className="flex gap-3">
                        <input
                          value={wantedName}
                          onChange={(event) => setWantedName(event.target.value.slice(0, 32))}
                          placeholder="A neved a klubban"
                          required
                          disabled={identity.status === 'declined' && retryIn > 0}
                          className="rm-input"
                        />
                        <Btn type="submit" variant="red" disabled={identity.status === 'declined' && retryIn > 0}>
                          BELÉPÉS
                        </Btn>
                      </div>
                    </form>
                  )}
                </div>
              )}
              {error && <p className="px-6 pb-4 text-[11px] text-[color:var(--rm-red)]">{error}</p>}
            </div>
          </div>

          {/* ------------------------------------------------ SIDE COLUMN */}
          <div className="flex flex-col gap-3.5">
            {/* Me */}
            {approved && (
              <div className="rm-card p-6" style={{'--bubble': identity.color || PALETTE[0]} as React.CSSProperties}>
                <span className="rm-label">TE</span>
                <div className="mt-3 flex items-center gap-3">
                  <span className="rm-bubble-avatar">{initialOf(identity.name)}</span>
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] text-white">{identity.name}</strong>
                    <span className="text-[9px] text-[#8d8584]">A színed a chatben. 3 napig él a neved.</span>
                  </div>
                  <button type="button" onClick={() => setShowSwatches((value) => !value)} aria-label="Szín választása" className="p-1.5 text-[#8f8887] hover:text-white">
                    <Palette size={15}/>
                  </button>
                </div>
                {showSwatches && (
                  <div className="rm-swatches mt-4">
                    {PALETTE.map((color) => (
                      <button key={color} type="button" onClick={() => pickColor(color)} className={`rm-swatch${identity.color === color ? ' is-on' : ''}`} style={{'--swatch': color} as React.CSSProperties} aria-label={color}/>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* People in the room */}
            <div className="rm-card p-6">
              <span className="rm-label">BENT VANNAK ({state?.people.length ?? 0})</span>
              {!state?.people.length && <p className="mt-3 text-[11px] text-[#8d8584]">Még senki nem kért nevet ma.</p>}
              <div className="rm-people mt-4">
                {state?.people.map((person) => (
                  <span key={person.name} className="rm-person" style={{'--bubble': person.color} as React.CSSProperties}>
                    <i aria-hidden="true"/> {person.name}
                  </span>
                ))}
              </div>
            </div>

            {canModerate && (
              <div className="rm-card p-0">
                <div className="flex items-center justify-between border-b border-[color:var(--rm-line)] px-6 py-4">
                  <span className="rm-label">NÉVKÉRELMEK</span>
                  <span className="text-[9px] text-[#777]">{state?.nameRequests.length ?? 0}</span>
                </div>
                <div className="max-h-[260px] overflow-y-auto">
                  {!state?.nameRequests.length && <p className="px-6 py-5 text-[11px] text-[#8d8584]">Nincs függő kérelem.</p>}
                  {state?.nameRequests.map((request) => (
                    <div key={request.id} className="flex items-center gap-2 border-b border-white/[0.04] px-6 py-3">
                      <span className="flex-1 truncate text-[11px] text-white">{request.name}</span>
                      <button type="button" onClick={() => decide(request.id, 'accept')} aria-label="Elfogadás" className="p-1 text-emerald-400 transition-opacity hover:opacity-70">
                        <Check size={14}/>
                      </button>
                      <button type="button" onClick={() => decide(request.id, 'decline')} aria-label="Elutasítás" className="p-1 text-[color:var(--rm-red)] transition-opacity hover:opacity-70">
                        <X size={14}/>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canModerate && (
              <div className="rm-card p-0">
                <div className="border-b border-[color:var(--rm-line)] px-6 py-4">
                  <span className="rm-label">HALLGATÓK ({state?.registeredListeners?.length ?? 0})</span>
                </div>
                <div className="max-h-[260px] overflow-y-auto">
                  {!state?.registeredListeners?.length && <p className="px-6 py-4 text-[11px] text-[#8d8584]">Nincs regisztrált név.</p>}
                  {state?.registeredListeners?.map((listener) => (
                    <div key={`${listener.ip}-${listener.browserHash}`} className="flex items-center gap-2 border-b border-white/[0.04] px-6 py-3">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{background: listener.color || PALETTE[0], boxShadow: `0 0 8px ${listener.color || PALETTE[0]}`}}/>
                      <span className={`flex-1 truncate text-[11px] ${listener.banned ? 'text-[#777] line-through' : 'text-white'}`}>{listener.name}</span>
                      <button type="button" onClick={() => kickListener(listener)} aria-label={`${listener.name} eltávolítása`} className="p-1 text-[#777] transition-colors hover:text-white">
                        <UserMinus size={12}/>
                      </button>
                      <button type="button" onClick={() => banListener(listener)} aria-label={`${listener.name} kitiltása`} className="p-1 text-[#777] transition-colors hover:text-[color:var(--rm-red)]">
                        <Ban size={12}/>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rm-card p-6">
              <span className="rm-label">HÁZIREND</span>
              <ul className="mt-4 flex flex-col gap-2.5 text-[11px] leading-[1.7] text-[#8d8584]">
                <li>A megjelenési nevet a DJ engedi be, és egy színt kapsz hozzá.</li>
                <li>Zenét a „ZENÉT KÉREK” gombbal kérsz; a DJ a pultban látja.</li>
                <li>Ami a chatbe kerül, azt a ház is látja. Tisztelet a pultnak és egymásnak.</li>
              </ul>
              <button type="button" onClick={refreshIdentity} className="mt-4 text-[8px] tracking-[0.22em] text-[#5f5959] hover:text-white">
                ÁLLAPOT FRISSÍTÉSE
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
