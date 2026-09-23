import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {Ban, Check, Disc3, ListPlus, Music2, Palette, Pause, Play, Radio, Send, SkipForward, Trash2, Upload, UserMinus, Users, X} from 'lucide-react';
import {NeonHeading} from '../components/ui/NeonHeading';
import {Btn} from '../components/ui/Btn';
import {Badge, Field, inputClass, Panel} from '../components/ui/console';
import {useClub, type ClubChatMessage, type ClubTrack, type RegisteredListener} from '../hooks/useClub';
import {apiSend, assetUrl, formatTime} from '../lib/api';
import {uploadMedia} from '../lib/media';
import {playSfx} from '../lib/sfx';
import {toast} from '../stores/useToastStore';
import {dialog} from '../stores/useDialogStore';
import {useAuthStore} from '../stores/useAuthStore';

const PALETTE = ['#ff5c7a', '#ff9f43', '#ffd166', '#2ee6a6', '#4cc9f0', '#5b8cff', '#c77dff', '#f472b6', '#9ef01a', '#ff8fab', '#00e5ff', '#ffb347'];

const formatSize = (bytes?: number) => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '');

/**
 * The booth.
 *
 * Everything the DJ touches during a show: going live with a title and the
 * stream the site should play, the library and queue, the local player, the
 * requests and the chat, and the room's names. Talks under the DJ's nickname.
 */
export const DjPage: React.FC = () => {
  const {user, loading} = useAuthStore();
  const isDj = !!user && user.capabilities.dj;
  const {state, refresh, error, appendLocal} = useClub('/api/dj/state', isDj);

  const [title, setTitle] = useState('Red Moon Live');
  const [streamUrl, setStreamUrl] = useState('');
  const [providerUrl, setProviderUrl] = useState('');
  const [chatText, setChatText] = useState('');
  const [uploading, setUploading] = useState<{name: string; progress: number} | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);

  useEffect(() => {
    if (!state || touched.current) return;
    if (state.title) setTitle(state.title);
    setStreamUrl(state.streamUrl || '');
    setProviderUrl(state.providerUrl || '');
  }, [state]);

  const lines = useMemo(() => [...(state?.chat || [])].reverse(), [state?.chat]);
  useEffect(() => {
    const element = chatRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const act = useCallback(
    async (run: () => Promise<unknown>, sound: 'success' | 'accept' | 'delete' = 'success', okText?: string) => {
      setBusy(true);
      try {
        await run();
        playSfx(sound);
        if (okText) toast.success(okText);
        refresh();
      } catch (err) {
        toast.error('Nem sikerült', (err as Error).message);
        playSfx('error');
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const toggleLive = () =>
    act(
      () => apiSend('/api/dj/live', 'POST', {live: !state?.live, title, streamUrl, providerUrl}),
      state?.live ? 'delete' : 'success',
      state?.live ? 'Adás lezárva.' : 'Adásban vagy. A háttérzene mindenkinél elhallgatott.'
    );

  const saveStream = () => act(() => apiSend('/api/dj/stream', 'PATCH', {streamUrl, providerUrl}), 'success', 'Adásforrás mentve.');

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading({name: file.name, progress: 0});
    try {
      const signed = await apiSend<{provider: 'cloudinary' | 'local'; trackId: string}>('/api/dj/upload-url', 'POST', {filename: file.name, size: file.size, type: file.type});
      if (signed.provider === 'local') {
        const body = new FormData();
        body.append('file', file);
        const response = await fetch('/api/dj/upload', {method: 'POST', body});
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Feltöltés sikertelen.');
      } else {
        const media = await uploadMedia('audio', 'dj-music', file, (fraction) => setUploading({name: file.name, progress: fraction}));
        await apiSend('/api/dj/library/confirm', 'POST', {trackId: signed.trackId, publicId: media.publicId, url: media.url, name: file.name, size: media.size, duration: media.duration});
      }
      toast.success('Feltöltve', file.name);
      playSfx('success');
      refresh();
    } catch (err) {
      toast.error('A feltöltés nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeTrack = async (track: ClubTrack) => {
    const sure = await dialog.confirm({title: `Törlöd: ${track.name}?`, message: 'A fájl a médiatárból is törlődik, és kikerül a sorból.', confirmLabel: 'TÖRLÉS', tone: 'danger'});
    if (!sure) return;
    act(() => apiSend(`/api/dj/library/${track.id}`, 'DELETE'), 'delete');
  };

  const sendChat = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = chatText.trim();
    if (!value) return;
    try {
      const data = await apiSend<{message: ClubChatMessage}>('/api/dj/chat', 'POST', {text: value});
      if (data.message) appendLocal(data.message);
      setChatText('');
      playSfx('chat_message');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
    }
  };

  const decideName = (id: string, action: 'accept' | 'decline') => act(() => apiSend('/api/club/name-decision', 'POST', {id, action}), action === 'accept' ? 'accept' : 'delete');

  const banListener = async (listener: RegisteredListener) => {
    const reason = await dialog.prompt({
      title: `${listener.name} kitiltása`,
      message: 'Egy órára tiltod a chatből. Az indokot a hallgató is látja.',
      label: 'INDOK',
      confirmLabel: 'KITILTÁS',
      tone: 'danger',
      validate: (value) => (value.trim() ? null : 'Indok nélkül nem tiltunk.')
    });
    if (!reason?.trim()) return;
    act(() => apiSend('/api/club/ban', 'POST', {ip: listener.ip, browserHash: listener.browserHash, minutes: 60, reason: reason.trim()}), 'delete');
  };

  const kickListener = async (listener: RegisteredListener) => {
    const sure = await dialog.confirm({title: `${listener.name} eltávolítása?`, message: 'A neve megszűnik, újat kell kérnie.', confirmLabel: 'ELTÁVOLÍTÁS', tone: 'danger'});
    if (!sure) return;
    act(() => apiSend('/api/club/listener-action', 'POST', {action: 'remove', ip: listener.ip, browserHash: listener.browserHash}), 'delete');
  };

  const recolor = async (listener: RegisteredListener) => {
    const color = PALETTE[(PALETTE.indexOf(listener.color) + 1) % PALETTE.length];
    act(() => apiSend('/api/club/listener-action', 'POST', {action: 'recolor', ip: listener.ip, browserHash: listener.browserHash, color}), 'accept');
  };

  if (loading) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center pt-[68px]">
        <span className="text-[10px] tracking-[0.3em] text-[#777]">BETÖLTÉS…</span>
      </main>
    );
  }

  if (!user || !isDj) {
    return (
      <main className="flex min-h-[80vh] items-center justify-center px-[var(--rm-gutter)] pt-[68px] text-center">
        <div>
          <div className="rm-label">RED MOON / BOOTH</div>
          <NeonHeading as="h1" size={2} className="my-5">
            DJ <em>hozzáférés kell.</em>
          </NeonHeading>
          <p className="mx-auto max-w-sm text-[12px] leading-[1.8] text-[#9e9795]">
            {user ? 'A pultot a DJ beosztás nyitja meg. Kérd a tulajdonost, hogy adja hozzá a fiókodhoz.' : 'A pult a személyzet DJ beosztású tagjainak, a managereknek és a tulajdonosnak érhető el.'}
          </p>
          <Link to={user ? '/staff' : '/staff-login'} className="rm-btn is-red mt-8 inline-flex">
            {user ? 'KONZOL ↗' : 'BELÉPÉS ↗'}
          </Link>
        </div>
      </main>
    );
  }

  const pendingRequests = (state?.requests || []).filter((request) => request.status === 'pending');
  const djName = user.nickname || user.name;

  return (
    <main className="pt-[68px]">
      <section className="rm-section">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="rm-label">RED MOON / BOOTH</div>
            <NeonHeading as="h1" size={2} className="mb-2 mt-3.5">
              A <em>pult.</em>
            </NeonHeading>
            <p className="text-[11px] text-[#8d8584]">
              A pultban: <b className="text-white">{djName}</b> · a klubban ezen a néven szólsz.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link to="/club" className="rm-btn">
              KLUB OLDAL ↗
            </Link>
            <Link to="/staff" className="rm-btn is-ghost">
              KONZOL ↗
            </Link>
          </div>
        </div>

        {/* ------------------------------------------------ LIVE CONTROL */}
        <div className={`rm-now mb-3.5 mt-8 p-6 md:p-7${state?.live ? ' is-on' : ''}`}>
          <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr_auto] lg:items-center">
            <div className="flex items-center gap-4">
              <span className="rm-now-disc" aria-hidden="true"/>
              <div>
                <span className={`flex items-center gap-2 border px-3 py-2 text-[9px] font-bold tracking-[0.2em] ${state?.live ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.18)] text-white' : 'border-white/10 text-[#8f8887]'}`}>
                  <Radio size={11} className={state?.live ? 'animate-pulse text-[color:var(--rm-red)]' : ''}/>
                  {state?.live ? 'ÉLŐBEN' : 'OFFLINE'}
                </span>
                <span className="mt-2 flex items-center gap-2 text-[9px] tracking-[0.2em] text-[#8f8887]">
                  <Users size={11}/> {state?.listenerCount ?? 0} A KLUBBAN
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="ADÁS CÍME">
                <input
                  value={title}
                  onChange={(event) => {
                    touched.current = true;
                    setTitle(event.target.value);
                  }}
                  maxLength={80}
                  className={inputClass}
                />
              </Field>
              <Field label="STREAM CÍME (AMIT AZ OLDAL LEJÁTSZIK)" hint="A gocast.fm állomás közvetlen hangfolyama (mp3/aac URL). Ezt hallja a popup és a klub oldal.">
                <input
                  value={streamUrl}
                  onChange={(event) => {
                    touched.current = true;
                    setStreamUrl(event.target.value);
                  }}
                  placeholder="https://…/stream"
                  className={inputClass}
                />
              </Field>
              <Field label="ÁLLOMÁS OLDALA" hint="A gocast.fm oldal, ahová a „GOCAST” gomb mutat." className="md:col-span-2">
                <div className="flex gap-2">
                  <input
                    value={providerUrl}
                    onChange={(event) => {
                      touched.current = true;
                      setProviderUrl(event.target.value);
                    }}
                    placeholder="https://gocast.fm/station/red-moon-pub"
                    className={inputClass}
                  />
                  <Btn onClick={saveStream} disabled={busy}>
                    <Check size={12}/> MENTÉS
                  </Btn>
                </div>
              </Field>
            </div>

            <Btn variant={state?.live ? 'outline' : 'red'} onClick={toggleLive} disabled={busy} className="justify-center lg:self-end">
              {state?.live ? 'ADÁS LEÁLLÍTÁSA' : 'ADÁS INDÍTÁSA'}
            </Btn>
          </div>
        </div>

        {error && <p className="mb-3.5 text-[11px] text-[color:var(--rm-red)]">{error}</p>}

        <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-3">
          {/* ------------------------------------------------ LEFT: player + library */}
          <div className="flex flex-col gap-3.5 xl:col-span-2">
            <Panel label="MOST SZÓL A PULTBAN" title={state?.current ? state.current.name : 'Nincs lejátszott zene.'}>
              {state?.current ? (
                <>
                  <audio
                    ref={audioRef}
                    src={assetUrl(state.current.url)}
                    controls
                    className="w-full"
                    onPlay={() => apiSend('/api/dj/player-sync', 'POST', {position: audioRef.current?.currentTime || 0, playing: true}).catch(() => {})}
                    onPause={() => apiSend('/api/dj/player-sync', 'POST', {position: audioRef.current?.currentTime || 0, playing: false}).catch(() => {})}
                  />
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Btn onClick={() => act(() => apiSend('/api/dj/control', 'POST', {action: 'play', position: audioRef.current?.currentTime || 0}))}>
                      <Play size={13}/> PLAY
                    </Btn>
                    <Btn onClick={() => act(() => apiSend('/api/dj/control', 'POST', {action: 'pause', position: audioRef.current?.currentTime || 0}))}>
                      <Pause size={13}/> PAUSE
                    </Btn>
                    <Btn variant="red" onClick={() => act(() => apiSend('/api/dj/control', 'POST', {action: 'next'}))}>
                      <SkipForward size={13}/> KÖVETKEZŐ
                    </Btn>
                  </div>
                  <p className="mt-3 text-[10px] text-[#6f6968]">Ez a pult saját lejátszója. A vendégek a stream címén hallják az adást.</p>
                </>
              ) : (
                <p className="text-[11px] text-[#8d8584]">Indíts el egyet a tárból, vagy vedd elő a sort.</p>
              )}
            </Panel>

            <Panel
              padded={false}
              label={`ZENETÁR (${state?.library.length ?? 0})`}
              action={
                <label className="rm-btn is-ghost !px-3 !py-2 !text-[8px] cursor-pointer">
                  <input ref={fileRef} type="file" accept="audio/*" onChange={upload} className="hidden" disabled={!!uploading}/>
                  <Upload size={12}/> {uploading ? `FELTÖLTÉS ${Math.round(uploading.progress * 100)}%` : 'FELTÖLTÉS'}
                </label>
              }
            >
              {uploading && (
                <div className="px-6 pt-4">
                  <div className="rm-progress">
                    <i style={{width: `${Math.round(uploading.progress * 100)}%`}}/>
                  </div>
                  <span className="mt-2 block truncate text-[9px] text-[#777]">{uploading.name}</span>
                </div>
              )}
              <div className="max-h-[420px] overflow-y-auto">
                {!state?.library.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">A tár üres. Tölts fel egy hangfájlt (legfeljebb 80 MB).</p>}
                {state?.library.map((track) => (
                  <div key={track.id} className="flex items-center gap-3 border-b border-white/[0.04] px-6 py-3">
                    <Disc3 size={13} className="shrink-0 text-[#6d5d64]"/>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-[11px] text-white">{track.name}</strong>
                      <span className="text-[9px] text-[#777]">
                        {formatSize(track.size)}
                        {track.addedBy ? ` · ${track.addedBy}` : ''}
                      </span>
                    </div>
                    <button type="button" onClick={() => act(() => apiSend('/api/dj/queue', 'POST', {trackId: track.id}), 'accept')} aria-label="Sorba" title="Sorba" className="p-1 text-[#777] transition-colors hover:text-white">
                      <ListPlus size={13}/>
                    </button>
                    <button type="button" onClick={() => act(() => apiSend('/api/dj/play', 'POST', {trackId: track.id}))} aria-label="Lejátszás" title="Lejátszás" className="p-1 text-[color:var(--rm-red)] transition-opacity hover:opacity-70">
                      <Play size={13}/>
                    </button>
                    <button type="button" onClick={() => removeTrack(track)} aria-label="Törlés" title="Törlés" className="p-1 text-[#777] transition-colors hover:text-[color:var(--rm-red)]">
                      <Trash2 size={12}/>
                    </button>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Chat */}
            <div className="rm-card flex flex-col p-0">
              <div className="flex items-center justify-between border-b border-[color:var(--rm-line)] px-6 py-4">
                <span className="rm-label">A KLUB CHATJE</span>
                <span className="text-[9px] text-[#777]">{lines.length} üzenet</span>
              </div>
              <div ref={chatRef} className="rm-chat max-h-[380px] min-h-[220px]">
                {!lines.length && <p className="text-[11px] text-[#8d8584]">Csend van.</p>}
                {lines.map((message) =>
                  message.kind === 'system' || message.kind === 'request-accepted' || message.kind === 'request-declined' ? (
                    <div key={message.id} className={`rm-chat-system${message.kind === 'request-accepted' ? ' is-accept' : message.kind === 'request-declined' ? ' is-decline' : ''}`}>
                      {message.text}
                    </div>
                  ) : (
                    <div key={message.id} className={`rm-bubble${message.kind === 'dj' ? ' is-dj is-self' : ''}${message.kind === 'request' ? ' is-request' : ''}`} style={{'--bubble': message.kind === 'dj' ? '#ff2b4f' : message.color || PALETTE[0]} as React.CSSProperties}>
                      <span className="rm-bubble-avatar" aria-hidden="true">
                        {message.kind === 'dj' ? <Disc3 size={13}/> : (message.name || '?').slice(0, 1).toUpperCase()}
                      </span>
                      <div className="rm-bubble-body">
                        <div className="rm-bubble-meta">
                          <span className="rm-bubble-name">{message.name}</span>
                          <span className="rm-bubble-time">{formatTime(message.at)}</span>
                        </div>
                        <p className="rm-bubble-text">{message.text}</p>
                      </div>
                      <button type="button" onClick={() => act(() => apiSend(`/api/club/chat/${message.id}`, 'DELETE'), 'delete')} aria-label="Üzenet törlése" className="rm-chat-delete">
                        <Trash2 size={12}/>
                      </button>
                    </div>
                  )
                )}
              </div>
              <form onSubmit={sendChat} className="rm-chat-composer">
                <input value={chatText} onChange={(event) => setChatText(event.target.value.slice(0, 500))} placeholder={`Üzenet a klubnak ${djName} néven…`} className={inputClass}/>
                <Btn type="submit" variant="red" disabled={!chatText.trim()}>
                  <Send size={13}/>
                </Btn>
              </form>
            </div>
          </div>

          {/* ------------------------------------------------ RIGHT: queue, requests, names */}
          <div className="flex flex-col gap-3.5">
            <Panel padded={false} label={`KÉRÉSEK (${pendingRequests.length})`}>
              <div className="max-h-[300px] overflow-y-auto">
                {!pendingRequests.length && <p className="px-6 py-4 text-[11px] text-[#8d8584]">Nincs függő kérés. Ami a chatben „ZENÉT KÉREK”-kel érkezik, itt jelenik meg.</p>}
                {pendingRequests.map((request) => (
                  <div key={request.id} className="flex items-center gap-3 border-b border-white/[0.04] px-6 py-3">
                    <Music2 size={13} className="shrink-0" style={{color: request.color || PALETTE[0]}}/>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-[11px] text-white">{request.item?.name || '—'}</strong>
                      <span className="text-[9px]" style={{color: request.color || '#777'}}>{request.name}</span>
                      <span className="text-[9px] text-[#777]"> · {formatTime(request.at)}</span>
                    </div>
                    <button type="button" onClick={() => act(() => apiSend('/api/dj/request', 'POST', {id: request.id, action: 'accept'}), 'accept')} aria-label="Elfogadás" title={request.item?.requestOnly ? 'Elfogadás (nincs a tárban, csak jelzed)' : 'Elfogadás és sorba'} className="p-1 text-emerald-400">
                      <Check size={13}/>
                    </button>
                    <button type="button" onClick={() => act(() => apiSend('/api/dj/request', 'POST', {id: request.id, action: 'decline'}), 'delete')} aria-label="Elutasítás" className="p-1 text-[color:var(--rm-red)]">
                      <X size={13}/>
                    </button>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel padded={false} label={`SOR (${state?.queue.length ?? 0})`}>
              <div className="max-h-[220px] overflow-y-auto">
                {!state?.queue.length && <p className="px-6 py-4 text-[11px] text-[#8d8584]">A sor üres.</p>}
                {state?.queue.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-2 border-b border-white/[0.04] px-6 py-2.5">
                    <span className="w-5 text-[9px] text-[#5f5959]">{index + 1}.</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10px] text-white">{item.name}</span>
                      {item.addedBy && <span className="text-[8px] text-[#777]">{item.addedBy}</span>}
                    </span>
                    <button type="button" onClick={() => act(() => apiSend('/api/dj/play', 'POST', {queueId: item.id}))} aria-label="Most játszd" className="p-1 text-[color:var(--rm-red)]">
                      <Play size={12}/>
                    </button>
                    <button type="button" onClick={() => act(() => apiSend(`/api/dj/queue/${item.id}`, 'DELETE'), 'delete')} aria-label="Kivétel a sorból" className="p-1 text-[#777] hover:text-[color:var(--rm-red)]">
                      <X size={12}/>
                    </button>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel padded={false} label={`NÉVKÉRELMEK (${state?.nameRequests.length ?? 0})`}>
              <div className="max-h-[220px] overflow-y-auto">
                {!state?.nameRequests.length && <p className="px-6 py-4 text-[11px] text-[#8d8584]">Nincs függő kérelem.</p>}
                {state?.nameRequests.map((request) => (
                  <div key={request.id} className="flex items-center gap-2 border-b border-white/[0.04] px-6 py-3">
                    <span className="flex-1 truncate text-[11px] text-white">{request.name}</span>
                    <button type="button" onClick={() => decideName(request.id, 'accept')} aria-label="Elfogadás" className="p-1 text-emerald-400">
                      <Check size={14}/>
                    </button>
                    <button type="button" onClick={() => decideName(request.id, 'decline')} aria-label="Elutasítás" className="p-1 text-[color:var(--rm-red)]">
                      <X size={14}/>
                    </button>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel padded={false} label={`A KLUBBAN (${state?.registeredListeners.length ?? 0})`}>
              <div className="max-h-[260px] overflow-y-auto">
                {!state?.registeredListeners.length && <p className="px-6 py-4 text-[11px] text-[#8d8584]">Nincs regisztrált név.</p>}
                {state?.registeredListeners.map((listener) => (
                  <div key={`${listener.ip}-${listener.browserHash}`} className="flex items-center gap-2 border-b border-white/[0.04] px-6 py-3">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{background: listener.color || PALETTE[0], boxShadow: `0 0 8px ${listener.color || PALETTE[0]}`}}/>
                    <span className={`flex-1 truncate text-[11px] ${listener.banned ? 'text-[#777] line-through' : 'text-white'}`}>{listener.name}</span>
                    {listener.banned && <Badge tone="warn">TILTVA</Badge>}
                    <button type="button" onClick={() => recolor(listener)} aria-label="Új szín" title="Új szín" className="p-1 text-[#777] hover:text-white">
                      <Palette size={12}/>
                    </button>
                    <button type="button" onClick={() => kickListener(listener)} aria-label="Eltávolítás" title="Eltávolítás" className="p-1 text-[#777] hover:text-white">
                      <UserMinus size={12}/>
                    </button>
                    <button type="button" onClick={() => banListener(listener)} aria-label="Kitiltás" title="Kitiltás" className="p-1 text-[#777] hover:text-[color:var(--rm-red)]">
                      <Ban size={12}/>
                    </button>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </section>
    </main>
  );
};
