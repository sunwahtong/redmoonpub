import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {Ban, BarChart3, Check, Disc3, Eraser, ListPlus, Megaphone, Palette, Pause, Pin, Play, Radio, Send, SkipForward, Trash2, Upload, UserMinus, Users, X} from 'lucide-react';
import {NeonHeading} from '../components/ui/NeonHeading';
import {Btn} from '../components/ui/Btn';
import {Badge, Field, inputClass, Panel} from '../components/ui/console';
import {ChatPanel} from '../components/club/ChatPanel';
import {PollCard} from '../components/club/PollCard';
import {RequestBoard, type RequestAction} from '../components/club/RequestBoard';
import {Setlist} from '../components/club/Setlist';
import {VibeMeter, vibeLabel} from '../components/club/Stage';
import {useClub, type ClubChatMessage, type ClubTrack, type RegisteredListener} from '../hooks/useClub';
import {useElapsed} from '../hooks/useElapsed';
import {apiSend, assetUrl, formatTime} from '../lib/api';
import {uploadMedia} from '../lib/media';
import {playSfx} from '../lib/sfx';
import {toast} from '../stores/useToastStore';
import {dialog} from '../stores/useDialogStore';
import {useAuthStore} from '../stores/useAuthStore';

const PALETTE = ['#ff5c7a', '#ff9f43', '#ffd166', '#2ee6a6', '#4cc9f0', '#5b8cff', '#c77dff', '#f472b6', '#9ef01a', '#ff8fab', '#00e5ff', '#ffb347'];
const SLOW_MODES = [0, 5, 15, 30, 60];
const QUICK_LINES = ['Kérések nyitva — írjátok a chatbe ♪', 'Szavazzatok, merre menjen az este ↑', 'Utolsó három szám következik.', 'Köszönöm, hogy itt vagytok! 🍻'];

const formatSize = (bytes?: number) => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '');

const Tile: React.FC<{label: string; value: React.ReactNode; hint?: string; tone?: 'red' | 'good' | 'muted'}> = ({label, value, hint, tone = 'muted'}) => (
  <div className={`rm-tile${tone === 'red' ? ' is-red' : tone === 'good' ? ' is-good' : ''}`}>
    <span className="rm-tile-label">{label}</span>
    <strong className="rm-tile-value">{value}</strong>
    {hint && <span className="rm-tile-hint">{hint}</span>}
  </div>
);

/**
 * The booth.
 *
 * Everything the DJ touches during a show: the station (watched by the
 * server — the club goes live by itself when the stream starts, the booth
 * lets the DJ claim it by name), the title and stream address, what is
 * playing (announced by hand or read from the stream), the room's requests
 * with their votes, a poll, the pinned notice, chat moderation, the library
 * and queue with the local player, and the room's names.
 */
export const DjPage: React.FC = () => {
  const {user, loading} = useAuthStore();
  const isDj = !!user && user.capabilities.dj;
  const {state, refresh, error, appendLocal, mutate} = useClub('/api/dj/state', isDj);
  const elapsed = useElapsed(state?.live ? state.startedAt : null);

  const [title, setTitle] = useState('Red Moon Live');
  const [streamUrl, setStreamUrl] = useState('');
  const [providerUrl, setProviderUrl] = useState('');
  const [showSource, setShowSource] = useState(false);
  const [chatText, setChatText] = useState('');
  const [notice, setNotice] = useState('');
  const [artist, setArtist] = useState('');
  const [track, setTrack] = useState('');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [minutes, setMinutes] = useState('5');
  const [uploading, setUploading] = useState<{name: string; progress: number} | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const touched = useRef(false);
  const noticeTouched = useRef(false);

  useEffect(() => {
    if (!state) return;
    if (!touched.current) {
      if (state.title) setTitle(state.title);
      setStreamUrl(state.customStreamUrl || '');
      setProviderUrl(state.providerUrl || '');
    }
    if (!noticeTouched.current) setNotice(state.notice || '');
  }, [state]);

  const lines = useMemo(() => [...(state?.chat || [])].reverse(), [state?.chat]);

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

  const toggleLive = () => {
    const claiming = !!state?.live && !!state?.autoLive;
    const on = !state?.live || claiming;
    return act(
      () => apiSend('/api/dj/live', 'POST', {live: on, title, streamUrl, providerUrl}),
      on ? 'success' : 'delete',
      on ? (claiming ? 'A pult a tiéd. A klub a nevedet mutatja.' : 'Adásban vagy. A háttérzene mindenkinél elhallgatott.') : 'Adás lezárva.'
    );
  };

  const saveStream = () => act(() => apiSend('/api/dj/stream', 'PATCH', {streamUrl, providerUrl}), 'success', 'Adásforrás mentve.');

  const announce = (event: React.FormEvent) => {
    event.preventDefault();
    if (!track.trim()) return;
    act(() => apiSend('/api/dj/announce', 'POST', {title: track.trim(), artist: artist.trim()}), 'accept', 'Bemondva.').then(() => {
      setTrack('');
      setArtist('');
    });
  };

  const saveNotice = () => act(() => apiSend('/api/dj/notice', 'PATCH', {text: notice.trim()}), 'success', notice.trim() ? 'Közlemény kitűzve.' : 'Közlemény levéve.').then(() => (noticeTouched.current = false));

  const setSlow = (seconds: number) => act(() => apiSend('/api/dj/chat-mode', 'PATCH', {slowSeconds: seconds}), 'accept');
  const setRequestsOpen = (open: boolean) => act(() => apiSend('/api/dj/chat-mode', 'PATCH', {requestsOpen: open}), open ? 'accept' : 'delete');

  const clearChat = async () => {
    const sure = await dialog.confirm({title: 'Chat törlése?', message: 'Minden sor eltűnik mindenkinél. A kérések és a setlist maradnak.', confirmLabel: 'TÖRLÉS', tone: 'danger'});
    if (!sure) return;
    act(() => apiSend('/api/dj/chat', 'DELETE'), 'delete', 'Tiszta lap.');
  };

  const openPoll = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = options.map((option) => option.trim()).filter(Boolean);
    if (!question.trim() || clean.length < 2) {
      toast.error('Kérdés és legalább két válasz kell.');
      return;
    }
    act(() => apiSend('/api/dj/poll', 'POST', {question: question.trim(), options: clean, minutes: Number(minutes) || 0}), 'accept', 'Szavazás megnyitva.').then(() => {
      setQuestion('');
      setOptions(['', '']);
    });
  };

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

  const removeTrack = async (item: ClubTrack) => {
    const sure = await dialog.confirm({title: `Törlöd: ${item.name}?`, message: 'A fájl a médiatárból is törlődik, és kikerül a sorból.', confirmLabel: 'TÖRLÉS', tone: 'danger'});
    if (!sure) return;
    act(() => apiSend(`/api/dj/library/${item.id}`, 'DELETE'), 'delete');
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

  const quickLine = (text: string) => act(() => apiSend('/api/dj/chat', 'POST', {text}), 'accept');

  const requestAction = (id: string, action: RequestAction) =>
    act(() => (action === 'delete' ? apiSend(`/api/dj/request/${id}`, 'DELETE') : apiSend('/api/dj/request', 'POST', {id, action})), action === 'decline' || action === 'delete' ? 'delete' : 'accept');

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

  const deleteMessage = (id: string) => act(() => apiSend(`/api/club/chat/${id}`, 'DELETE'), 'delete');

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

  const djName = user.nickname || user.name;
  const live = !!state?.live;
  const claiming = live && !!state?.autoLive;
  const station = state?.station;
  const pending = (state?.requests || []).filter((request) => request.status === 'pending').length;
  const nowPlaying = station?.nowPlaying?.title ? station.nowPlaying : state?.setlist[0] ? {title: state.setlist[0].title, artist: state.setlist[0].artist} : null;

  const chatTools = (
    <div className="rm-modstrip">
      <label className="rm-modstrip-item">
        <span>LASSÚ MÓD</span>
        <select value={state?.slowMode ?? 0} onChange={(event) => setSlow(Number(event.target.value))} className="rm-input !py-1.5 !text-[10px]">
          {SLOW_MODES.map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds ? `${seconds} mp` : 'ki'}
            </option>
          ))}
        </select>
      </label>
      <label className="rm-modstrip-item">
        <span>KÉRÉSEK</span>
        <button type="button" role="switch" aria-checked={state?.requestsOpen !== false} onClick={() => setRequestsOpen(state?.requestsOpen === false)} className="rm-switch rm-switch-sm"/>
      </label>
      <div className="rm-modstrip-item flex-1">
        <span>
          <Pin size={8} className="mr-1 inline-block align-[-1px]"/>KÖZLEMÉNY
        </span>
        <div className="flex gap-1.5">
          <input
            value={notice}
            onChange={(event) => {
              noticeTouched.current = true;
              setNotice(event.target.value.slice(0, 200));
            }}
            placeholder="Kitűzött sor a chat fölött…"
            className="rm-input !py-1.5 !text-[10px]"
          />
          <button type="button" onClick={saveNotice} disabled={busy} className="rm-btn !px-2.5 !py-1.5 !text-[8px]">
            {notice.trim() ? 'KITŰZ' : 'LEVESZ'}
          </button>
        </div>
      </div>
      <button type="button" onClick={clearChat} className="rm-modstrip-clear" title="Chat törlése">
        <Eraser size={11}/> TISZTA LAP
      </button>
    </div>
  );

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
        <div className={`rm-now mb-3.5 mt-8 p-6 md:p-7${live ? ' is-on' : ''}`} data-tour="dj-live">
          <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr_auto] lg:items-start">
            <div className="flex items-start gap-4">
              <span className="rm-now-disc" aria-hidden="true"/>
              <div className="flex flex-col gap-2">
                <span className={`flex items-center gap-2 border px-3 py-2 text-[9px] font-bold tracking-[0.2em] ${live ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.18)] text-white' : 'border-white/10 text-[#8f8887]'}`}>
                  <Radio size={11} className={live ? 'animate-pulse text-[color:var(--rm-red)]' : ''}/>
                  {live ? (claiming ? 'ÉLŐ · A RÁDIÓ SUGÁROZ' : `ÉLŐ · ${state?.dj || djName}`) : 'OFFLINE'}
                  {elapsed ? <span className="text-[#c9b6bb]">· {elapsed}</span> : null}
                </span>
                <span className={`flex items-center gap-2 border px-3 py-2 text-[8px] tracking-[0.2em] ${station?.live ? 'border-emerald-500/40 text-emerald-300' : 'border-white/10 text-[#8f8887]'}`} title={station?.checkedAt ? `Ellenőrizve ${formatTime(station.checkedAt)}` : 'Még nem ellenőrizve'}>
                  <span className={`h-1.5 w-1.5 rounded-full ${station?.live ? 'bg-emerald-400' : 'bg-[#5f5959]'}`}/>
                  GOCAST: {station?.live ? `SUGÁROZ · ${station.listeners} HALLGATÓ` : 'CSENDES'}
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
              <Field label="MOST SZÓL A STREAMEN" hint="A stream metaadatából, magától. Ha a szoftvered nem küld címet, mondd be lent.">
                <div className="rm-input flex items-center gap-2 !py-2.5 text-[11px] text-white">
                  <span className="truncate">{nowPlaying ? `${nowPlaying.artist ? `${nowPlaying.artist} – ` : ''}${nowPlaying.title}` : '—'}</span>
                </div>
              </Field>
              <button type="button" onClick={() => setShowSource((value) => !value)} className="text-left text-[8px] tracking-[0.22em] text-[#777] hover:text-white md:col-span-2">
                {showSource ? '▾ ADÁSFORRÁS ELREJTÉSE' : '▸ ADÁSFORRÁS (STREAM CÍME, ÁLLOMÁS OLDALA)'}
              </button>
              {showSource && (
                <>
                  <Field label="STREAM CÍME" hint={`Üresen az állomás saját MP3 mountja szól: ${state?.streamUrl || '—'}. Csak akkor írd át, ha máshonnan streamelsz (mp3/aac, nem m3u8).`}>
                    <input
                      value={streamUrl}
                      onChange={(event) => {
                        touched.current = true;
                        setStreamUrl(event.target.value);
                      }}
                      placeholder={state?.streamUrl || 'https://…/stream'}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="ÁLLOMÁS OLDALA" hint="gocast.fm/station/… — ebből jön a rádió állapota, hallgatószáma és a beágyazott lejátszó.">
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
                </>
              )}
            </div>

            <div className="flex flex-col gap-2 lg:items-stretch">
              <Btn variant={live && !claiming ? 'outline' : 'red'} onClick={toggleLive} disabled={busy} className="justify-center">
                {live ? (claiming ? 'BEJELENTKEZEM A PULTBA' : 'ADÁS LEZÁRÁSA') : 'ADÁS INDÍTÁSA'}
              </Btn>
              {!live && !station?.live && <span className="text-[9px] leading-[1.6] text-[#6f6968]">Ha a GoCast-on elindítod a sugárzást, az oldal magától élőbe vált. Ez a gomb kézzel is elindítja.</span>}
              {claiming && <span className="text-[9px] leading-[1.6] text-[#6f6968]">A rádió sugároz, a klub már élő. Vedd át a pultot, hogy a neved és a címed legyen rajta.</span>}
              {state?.streamUrl && (
                <details className="rm-monitor">
                  <summary>MONITOR (5–10 MP KÉSÉS)</summary>
                  <audio controls preload="none" src={state.streamUrl} className="mt-2 w-full"/>
                </details>
              )}
            </div>
          </div>
        </div>

        {error && <p className="mb-3.5 text-[11px] text-[color:var(--rm-red)]">{error}</p>}

        {/* ------------------------------------------------ STATS */}
        <div className="mb-3.5 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="A KLUBBAN" value={state?.listenerCount ?? 0} hint="nyitott klub oldal" tone={live ? 'red' : 'muted'}/>
          <Tile label="A RÁDIÓN" value={station?.listeners ?? 0} hint="GoCast hallgató" tone={station?.live ? 'good' : 'muted'}/>
          <Tile label="CSÚCS MA" value={state?.peakListeners ?? 0} hint="egyszerre a klubban"/>
          <Tile label="KÉRÉS VÁR" value={pending} hint={state?.requestsOpen === false ? 'kérések zárva' : 'kérések nyitva'}/>
          <Tile label="HANGULAT" value={vibeLabel(state?.vibe ?? 0)} hint={`${state?.vibe ?? 0} reakció / perc`} tone={(state?.vibe ?? 0) >= 5 ? 'red' : 'muted'}/>
        </div>

        <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-3">
          {/* ------------------------------------------------ LEFT */}
          <div className="flex flex-col gap-3.5 xl:col-span-2">
            <Panel tour="dj-announce" label="BEMONDÁS" title="Mi szól most?" action={<VibeMeter vibe={state?.vibe ?? 0} className="w-48"/>}>
              <form onSubmit={announce} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.4fr_auto]">
                <input value={artist} onChange={(event) => setArtist(event.target.value.slice(0, 120))} placeholder="Előadó (opcionális)" className={inputClass}/>
                <input value={track} onChange={(event) => setTrack(event.target.value.slice(0, 160))} placeholder="Cím" required className={inputClass}/>
                <Btn type="submit" variant="red" disabled={busy || !track.trim()}>
                  <Megaphone size={12}/> BEMONDÁS
                </Btn>
              </form>
              <p className="mt-3 text-[9px] leading-[1.6] text-[#6f6968]">A setlistre kerül, és a chatben is megjelenik. A stream metaadatából érkező címek maguktól sorolódnak.</p>
            </Panel>

            {state && <Setlist entries={state.setlist} nowPlaying={station?.nowPlaying} live={live} canModerate onRemove={(id) => act(() => apiSend(`/api/dj/setlist/${id}`, 'DELETE'), 'delete')} limit={30}/>}

            <div data-tour="dj-chat">
            <ChatPanel
              lines={lines}
              people={state?.people || []}
              myName={djName}
              canModerate
              onDelete={deleteMessage}
              notice={state?.notice}
              slowMode={state?.slowMode}
              title="A KLUB CHATJE"
              meta={<span>{lines.length} üzenet</span>}
              tools={chatTools}
              heightClass="max-h-[420px] min-h-[240px]"
              composer={
                <div className="border-t border-[color:var(--rm-line)]">
                  <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                    {QUICK_LINES.map((line) => (
                      <button key={line} type="button" onClick={() => quickLine(line)} disabled={busy} className="rm-quickline">
                        {line}
                      </button>
                    ))}
                  </div>
                  <form onSubmit={sendChat} className="rm-chat-composer !border-t-0">
                    <input value={chatText} onChange={(event) => setChatText(event.target.value.slice(0, 500))} placeholder={`Üzenet a klubnak ${djName} néven…`} className={inputClass}/>
                    <Btn type="submit" variant="red" disabled={!chatText.trim()}>
                      <Send size={13}/>
                    </Btn>
                  </form>
                </div>
              }
            />
            </div>

            <Panel label="MOST SZÓL A PULTBAN" title={state?.current ? state.current.name : 'Nincs lejátszott zene a tárból.'}>
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
                <p className="text-[11px] text-[#8d8584]">Indíts el egyet a tárból, vagy vedd elő a sort. Ami itt indul, a setlistre is felkerül.</p>
              )}
            </Panel>

            <Panel
              padded={false}
              tour="dj-library"
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
              <div className="max-h-[360px] overflow-y-auto">
                {!state?.library.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">A tár üres. Tölts fel egy hangfájlt (legfeljebb 80 MB).</p>}
                {state?.library.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 border-b border-white/[0.04] px-6 py-3">
                    <Disc3 size={13} className="shrink-0 text-[#6d5d64]"/>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-[11px] text-white">{item.name}</strong>
                      <span className="text-[9px] text-[#777]">
                        {formatSize(item.size)}
                        {item.addedBy ? ` · ${item.addedBy}` : ''}
                      </span>
                    </div>
                    <button type="button" onClick={() => act(() => apiSend('/api/dj/queue', 'POST', {trackId: item.id}), 'accept')} aria-label="Sorba" title="Sorba" className="p-1 text-[#777] transition-colors hover:text-white">
                      <ListPlus size={13}/>
                    </button>
                    <button type="button" onClick={() => act(() => apiSend('/api/dj/play', 'POST', {trackId: item.id}))} aria-label="Lejátszás" title="Lejátszás" className="p-1 text-[color:var(--rm-red)] transition-opacity hover:opacity-70">
                      <Play size={13}/>
                    </button>
                    <button type="button" onClick={() => removeTrack(item)} aria-label="Törlés" title="Törlés" className="p-1 text-[#777] transition-colors hover:text-[color:var(--rm-red)]">
                      <Trash2 size={12}/>
                    </button>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* ------------------------------------------------ RIGHT */}
          <div className="flex flex-col gap-3.5">
            {state && (
              <div data-tour="dj-requests">
              <RequestBoard
                requests={state.requests}
                requestsOpen={state.requestsOpen}
                votedIds={[]}
                canModerate
                onAction={requestAction}
                showDeclined
                emptyText="Nincs kérés. Ami a chatben „ZENÉT KÉREK”-kel érkezik, itt jelenik meg — a szavazatokkal együtt."
              />
              </div>
            )}

            {state?.poll ? (
              <div data-tour="dj-poll">
              <PollCard
                poll={state.poll}
                canVote={false}
                canModerate
                onClose={() => act(() => apiSend(`/api/dj/poll/${state.poll!.id}/close`, 'POST', {}), 'accept', 'Szavazás lezárva.')}
                onDelete={() =>
                  act(
                    () => apiSend(`/api/dj/poll/${state.poll!.id}`, 'DELETE').then(() => mutate((current) => (current ? {state: {...current.state, poll: null}} : current))),
                    'delete'
                  )
                }
              />
              </div>
            ) : (
              <Panel tour="dj-poll" label="SZAVAZÁS" title="Kérdezd a termet.">
                <form onSubmit={openPoll} className="flex flex-col gap-2">
                  <input value={question} onChange={(event) => setQuestion(event.target.value.slice(0, 160))} placeholder="Kérdés — pl. Merre menjen az este?" className={inputClass}/>
                  {options.map((option, index) => (
                    <div key={index} className="flex gap-1.5">
                      <input
                        value={option}
                        onChange={(event) => setOptions((current) => current.map((entry, i) => (i === index ? event.target.value.slice(0, 60) : entry)))}
                        placeholder={`${index + 1}. válasz`}
                        className={inputClass}
                      />
                      {options.length > 2 && (
                        <button type="button" onClick={() => setOptions((current) => current.filter((_, i) => i !== index))} aria-label="Válasz törlése" className="px-2 text-[#777] hover:text-[color:var(--rm-red)]">
                          <X size={12}/>
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    {options.length < 5 && (
                      <button type="button" onClick={() => setOptions((current) => [...current, ''])} className="rm-btn is-ghost !px-3 !py-2 !text-[8px]">
                        + VÁLASZ
                      </button>
                    )}
                    <label className="ml-auto flex items-center gap-2 text-[8px] tracking-[0.2em] text-[#777]">
                      LEZÁR
                      <select value={minutes} onChange={(event) => setMinutes(event.target.value)} className="rm-input !w-auto !py-1.5 !text-[10px]">
                        <option value="0">kézzel</option>
                        <option value="2">2 perc</option>
                        <option value="5">5 perc</option>
                        <option value="10">10 perc</option>
                        <option value="30">30 perc</option>
                      </select>
                    </label>
                    <Btn type="submit" variant="red" disabled={busy}>
                      <BarChart3 size={12}/> INDÍTÁS
                    </Btn>
                  </div>
                </form>
              </Panel>
            )}

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

            <Panel padded={false} label={`A KLUBBAN (${state?.registeredListeners.length ?? 0})`} action={<Users size={12} className="text-[#6f6968]"/>}>
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
