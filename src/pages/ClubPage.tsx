import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Ban, Check, Radio, Send, Trash2, UserMinus, Users, X} from 'lucide-react';
import {PageHero} from '../components/ui/PageHero';
import {NeonHeading} from '../components/ui/NeonHeading';
import {Btn} from '../components/ui/Btn';
import {useClubStream} from '../hooks/useClubStream';
import {apiGet, apiSend} from '../lib/api';
import {playSfx} from '../lib/sfx';
import {dialog} from '../stores/useDialogStore';
import {useAuthStore} from '../stores/useAuthStore';

const CLIENT_KEY = 'rm-club-client';
const TOKEN_KEY = 'rm-club-token';
const NAME_KEY = 'rm-club-name';
const CHAT_MAX = 500;

type NameStatus = 'none' | 'pending' | 'accepted' | 'declined' | 'banned' | 'already_named';

interface NameStatusResponse {
  status: NameStatus;
  name?: string;
  token?: string;
  retryAt?: number;
  reason?: string;
  until?: number;
}

/** Stable per-browser id. The server pairs it with the client IP. */
function clientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('hu-HU', {hour: '2-digit', minute: '2-digit'});

export const ClubPage: React.FC = () => {
  const {state, connected} = useClubStream();
  const user = useAuthStore((state) => state.user);

  const [status, setStatus] = useState<NameStatus>('none');
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) || '');
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [wantedName, setWantedName] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  /** Moderation follows the DJ capability: the DJ job, managers and owners. */
  const canModerate = !!user && user.capabilities.dj;
  const approved = status === 'accepted' && !!token;

  const refreshStatus = useCallback(async () => {
    try {
      const data = await apiGet<NameStatusResponse>(`/api/club/name-status?clientId=${encodeURIComponent(clientId())}`);
      setStatus(data.status);
      if (data.name) {
        setName(data.name);
        localStorage.setItem(NAME_KEY, data.name);
      }
      if (data.token) {
        setToken(data.token);
        localStorage.setItem(TOKEN_KEY, data.token);
      }
      if (data.retryAt) setRetryAt(data.retryAt);
      if (data.status === 'banned') setError(`Kitiltva. Indok: ${data.reason || 'nincs megadva'}`);
    } catch {
      /* the club simply stays read-only */
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  /* A pending name is decided by a DJ, so poll until it resolves. */
  useEffect(() => {
    if (status !== 'pending') return;
    const timer = window.setInterval(refreshStatus, 5000);
    return () => window.clearInterval(timer);
  }, [status, refreshStatus]);

  /* Presence heartbeat — drives the listener counter. */
  useEffect(() => {
    const id = clientId();
    const beat = () => apiSend('/api/club/listener', 'POST', {id}).catch(() => {});
    beat();
    const timer = window.setInterval(beat, 15000);
    return () => window.clearInterval(timer);
  }, []);

  /* Newest message sits at the top of the list, so keep the view pinned there. */
  useEffect(() => {
    chatRef.current?.scrollTo({top: 0, behavior: 'smooth'});
  }, [state?.chat]);

  const requestName = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const data = await apiSend<{approved?: boolean; token?: string; name?: string}>(
        '/api/club/name-request',
        'POST',
        {name: wantedName.trim(), clientId: clientId()}
      );

      if (data.approved && data.token) {
        setToken(data.token);
        setStatus('accepted');
        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.name) localStorage.setItem(NAME_KEY, data.name);
        if (data.name) setName(data.name);
        playSfx('success');
        return;
      }

      setStatus('pending');
      setName(wantedName.trim());
      playSfx('accept');
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    }
  };

  const sendChat = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setError(null);
    try {
      await apiSend('/api/club/chat', 'POST', {name, text: text.trim(), token});
      setText('');
      playSfx('chat_message');
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    }
  };

  const decide = async (id: string, action: 'accept' | 'decline') => {
    try {
      await apiSend('/api/club/name-decision', 'POST', {id, action});
      playSfx(action === 'accept' ? 'accept' : 'decline');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const banListener = async (listener: {name: string; ip: string | null; browserHash: string | null}) => {
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
      await apiSend('/api/club/ban', 'POST', {
        ip: listener.ip,
        browserHash: listener.browserHash,
        minutes: 60,
        reason: reason.trim()
      });
      playSfx('decline');
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    }
  };

  const kickListener = async (listener: {ip: string | null; browserHash: string | null}) => {
    try {
      await apiSend('/api/club/listener-action', 'POST', {
        action: 'remove',
        ip: listener.ip,
        browserHash: listener.browserHash
      });
      playSfx('delete');
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

  const retryIn = useMemo(() => {
    if (!retryAt) return 0;
    return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  }, [retryAt]);

  const field =
    'w-full border border-white/10 bg-black/50 p-3 text-xs tracking-wider text-white outline-none transition-colors placeholder:text-[#6d5d64] focus:border-[color:var(--rm-red)]';

  return (
    <main>
      <PageHero
        kicker="RED MOON / 07"
        overline="THE"
        title="CLUB"
        lead="Élő chat, zenei kérések és a ház belső köre. Naplemente után a legjobb hely a városban."
      >
        <div className="mt-8 flex flex-wrap gap-2.5 text-[9px] font-bold tracking-[0.2em]">
          <span
            className={`flex items-center gap-2 border px-4 py-2.5 ${
              state?.live
                ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.18)] text-white'
                : 'border-white/10 text-[#8f8887]'
            }`}
          >
            <Radio size={11} className={state?.live ? 'animate-pulse text-[color:var(--rm-red)]' : ''}/>
            {state?.live ? `ÉLŐ · ${state.dj || 'RED MOON DJ'}` : 'JELENLEG NINCS ADÁS'}
          </span>
          <span className="flex items-center gap-2 border border-white/10 px-4 py-2.5 text-[#8f8887]">
            <Users size={11}/> {state?.listenerCount ?? 0} HALLGATÓ
          </span>
          <span className="border border-white/10 px-4 py-2.5 text-[#8f8887]">
            {connected ? 'KAPCSOLÓDVA' : 'ÚJRACSATLAKOZÁS…'}
          </span>
        </div>
      </PageHero>

      <section className="rm-section">
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          {/* Chat */}
          <div className="rm-card flex flex-col p-0 lg:col-span-2">
            <div className="flex items-center justify-between border-b border-[color:var(--rm-line)] px-6 py-4">
              <span className="rm-label">KLUB CHAT</span>
              <span className="text-[9px] text-[#777]">{state?.chat.length ?? 0} üzenet</span>
            </div>

            <div ref={chatRef} className="flex max-h-[460px] min-h-[280px] flex-col gap-4 overflow-y-auto p-6">
              {!state?.chat.length && (
                <p className="text-[11px] text-[#8d8584]">Még nincs üzenet. Légy te az első.</p>
              )}

              {state?.chat.map((message) => (
                <div key={message.id} className="group flex gap-3">
                  <span className="mt-0.5 w-10 shrink-0 text-[9px] tabular-nums text-[#6d5d64]">
                    {timeOf(message.at)}
                  </span>
                  <div className="flex-1">
                    <strong
                      className={`text-[11px] ${
                        message.kind === 'request' ? 'text-[color:var(--rm-red)]' : 'text-white'
                      }`}
                    >
                      {message.name}
                    </strong>
                    <p className="mt-0.5 break-words text-[12px] leading-[1.7] text-[#a4949c]">{message.text}</p>
                  </div>
                  {canModerate && (
                    <button
                      type="button"
                      onClick={() => deleteMessage(message.id)}
                      aria-label="Üzenet törlése"
                      className="opacity-0 transition-opacity hover:text-[color:var(--rm-red)] group-hover:opacity-100"
                    >
                      <Trash2 size={12}/>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-[color:var(--rm-line)] p-6">
              {approved ? (
                <form onSubmit={sendChat} className="flex gap-3">
                  <input
                    value={text}
                    onChange={(event) => setText(event.target.value.slice(0, CHAT_MAX))}
                    placeholder={`Üzenet ${name} néven…`}
                    className={field}
                  />
                  <Btn type="submit" variant="red">
                    <Send size={13}/>
                  </Btn>
                </form>
              ) : status === 'pending' ? (
                <p className="text-[11px] text-[#8d8584]">
                  <b className="text-white">{name}</b> — a neved jóváhagyásra vár a DJ-nél.
                </p>
              ) : status === 'banned' ? (
                <p className="text-[11px] text-[color:var(--rm-red)]">A chat számodra le van tiltva.</p>
              ) : status === 'already_named' ? (
                <p className="text-[11px] text-[#8d8584]">
                  Erről a hálózatról már van aktív név: <b className="text-white">{name}</b>.
                </p>
              ) : (
                <form onSubmit={requestName} className="flex flex-col gap-3">
                  <span className="text-[8px] tracking-[0.25em] text-[#777]">
                    {status === 'declined' && retryIn > 0
                      ? `ELUTASÍTVA · ÚJRA ${retryIn} MP MÚLVA`
                      : 'VÁLASSZ MEGJELENÉSI NEVET'}
                  </span>
                  <div className="flex gap-3">
                    <input
                      value={wantedName}
                      onChange={(event) => setWantedName(event.target.value.slice(0, 32))}
                      placeholder="A neved a klubban"
                      required
                      disabled={status === 'declined' && retryIn > 0}
                      className={field}
                    />
                    <Btn type="submit" variant="red" disabled={status === 'declined' && retryIn > 0}>
                      KÉRELEM
                    </Btn>
                  </div>
                </form>
              )}

              {error && <p className="mt-3 text-[11px] text-[color:var(--rm-red)]">{error}</p>}
            </div>
          </div>

          {/* Side column */}
          <div className="flex flex-col gap-3.5">
            <div className="rm-card p-7">
              <span className="rm-label">MA ESTE</span>
              <NeonHeading as="h3" className="mt-2">
                {state?.live ? state.title || 'Élő adás' : 'Csend van.'}
              </NeonHeading>
              <p className="mt-3 text-[11px] leading-[1.8] text-[#8d8584]">
                {state?.live
                  ? `${state.dj || 'A Red Moon DJ'} játszik most. Kapcsolj be és írj a chatbe.`
                  : 'Most nincs élő adás. Nézz vissza naplemente után.'}
              </p>
              {state?.live && state.providerUrl && (
                <a
                  href={state.providerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rm-btn is-red mt-6 inline-flex"
                >
                  HALLGATÁS ↗
                </a>
              )}
            </div>

            {canModerate && (
              <div className="rm-card p-0">
                <div className="border-b border-[color:var(--rm-line)] px-6 py-4">
                  <span className="rm-label">NÉVKÉRELMEK</span>
                </div>
                <div className="max-h-[320px] overflow-y-auto">
                  {!state?.nameRequests.length && (
                    <p className="px-6 py-5 text-[11px] text-[#8d8584]">Nincs függő kérelem.</p>
                  )}
                  {state?.nameRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex items-center gap-2 border-b border-white/[0.04] px-6 py-3"
                    >
                      <span className="flex-1 truncate text-[11px] text-white">{request.name}</span>
                      <button
                        type="button"
                        onClick={() => decide(request.id, 'accept')}
                        aria-label="Elfogadás"
                        className="text-emerald-400 transition-opacity hover:opacity-70"
                      >
                        <Check size={14}/>
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(request.id, 'decline')}
                        aria-label="Elutasítás"
                        className="text-[color:var(--rm-red)] transition-opacity hover:opacity-70"
                      >
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
                  {!state?.registeredListeners?.length && (
                    <p className="px-6 py-4 text-[11px] text-[#8d8584]">Nincs regisztrált név.</p>
                  )}
                  {state?.registeredListeners?.map((listener) => (
                    <div
                      key={`${listener.ip}-${listener.browserHash}`}
                      className="flex items-center gap-2 border-b border-white/[0.04] px-6 py-3"
                    >
                      <span className={`flex-1 truncate text-[11px] ${listener.banned ? 'text-[#777] line-through' : 'text-white'}`}>
                        {listener.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => kickListener(listener)}
                        aria-label={`${listener.name} eltávolítása`}
                        className="text-[#777] transition-colors hover:text-white"
                      >
                        <UserMinus size={12}/>
                      </button>
                      <button
                        type="button"
                        onClick={() => banListener(listener)}
                        aria-label={`${listener.name} kitiltása`}
                        className="text-[#777] transition-colors hover:text-[color:var(--rm-red)]"
                      >
                        <Ban size={12}/>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rm-card p-7">
              <span className="rm-label">HÁZIREND</span>
              <ul className="mt-4 flex flex-col gap-2.5 text-[11px] leading-[1.7] text-[#8d8584]">
                <li>A megjelenési nevet a DJ hagyja jóvá.</li>
                <li>Két üzenet között 5 másodperc szünet van.</li>
                <li>A jóváhagyott név 3 napig él.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
