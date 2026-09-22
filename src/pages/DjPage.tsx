import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {Check, ListPlus, Pause, Play, Radio, Send, SkipForward, Trash2, Upload, Users, X} from 'lucide-react';
import {NeonHeading} from '../components/ui/NeonHeading';
import {Btn} from '../components/ui/Btn';
import {Field, inputClass, Panel} from '../components/ui/console';
import {useLiveData} from '../hooks/useLiveData';
import {ApiError, apiSend, assetUrl} from '../lib/api';
import {playSfx} from '../lib/sfx';
import {toast} from '../stores/useToastStore';
import {dialog} from '../stores/useDialogStore';
import {useAuthStore} from '../stores/useAuthStore';

interface Track {
  id: string;
  name: string;
  url: string;
  size?: number;
  addedBy?: string;
}

interface QueueItem extends Track {
  trackId: string;
}

interface MusicRequest {
  id: string;
  name: string;
  at: string;
  status: string;
  item: {id: string; name: string} | null;
}

interface DjState {
  live: boolean;
  dj: string | null;
  title: string;
  listenerCount: number;
  library: Track[];
  queue: QueueItem[];
  current: (Track & {playbackPlaying?: boolean; playbackPosition?: number}) | null;
  chat: {id: string; at: string; name: string; text: string; kind: string}[];
  requests: MusicRequest[];
  nameRequests: {id: string; name: string}[];
}

const formatSize = (bytes?: number) => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '');

export const DjPage: React.FC = () => {
  const {user, loading} = useAuthStore();
  const isDj = !!user && user.capabilities.dj;

  const {data, refresh, error} = useLiveData<{state: DjState}>('/api/dj/state', {intervalMs: 5000, enabled: isDj});
  const state = data?.state;

  const [title, setTitle] = useState('Red Moon Live');
  const [chatText, setChatText] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (state?.title) setTitle(state.title);
  }, [state?.title]);

  const act = useCallback(
    async (run: () => Promise<unknown>, sound: 'success' | 'accept' | 'delete' = 'success') => {
      try {
        await run();
        playSfx(sound);
        refresh();
      } catch (err) {
        toast.error('Nem sikerült', (err as Error).message);
        playSfx('error');
      }
    },
    [refresh]
  );

  const toggleLive = () => act(() => apiSend('/api/dj/live', 'POST', {live: !state?.live, title}), state?.live ? 'delete' : 'success');

  /**
   * Audio goes straight to the storage bucket: the API hands out a signed
   * upload URL, the browser sends the file there, then registers it. Where no
   * bucket is configured (a VPS serving its own files) the API says so and
   * the file goes through it as multipart instead.
   */
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(file.name);
    try {
      let signed: {trackId: string; key: string; uploadUrl: string; contentType: string} | null = null;
      try {
        signed = await apiSend('/api/dj/upload-url', 'POST', {filename: file.name, size: file.size, type: file.type});
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 503)) throw err;
      }

      if (signed) {
        const response = await fetch(signed.uploadUrl, {method: 'PUT', headers: {'Content-Type': signed.contentType}, body: file});
        if (!response.ok) throw new Error(`A tárhely elutasította a fájlt (${response.status}).`);
        await apiSend('/api/dj/library/confirm', 'POST', {trackId: signed.trackId, key: signed.key, name: file.name, size: file.size});
      } else {
        const body = new FormData();
        body.append('file', file);
        const response = await fetch('/api/dj/upload', {method: 'POST', body});
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Feltöltés sikertelen.');
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

  const removeTrack = async (track: Track) => {
    const sure = await dialog.confirm({
      title: `Törlöd: ${track.name}?`,
      message: 'A fájl a tárhelyről is törlődik, és kikerül a sorból.',
      confirmLabel: 'TÖRLÉS',
      tone: 'danger'
    });
    if (!sure) return;
    act(() => apiSend(`/api/dj/library/${track.id}`, 'DELETE'), 'delete');
  };

  const sendChat = (event: React.FormEvent) => {
    event.preventDefault();
    if (!chatText.trim()) return;
    act(async () => {
      await apiSend('/api/dj/chat', 'POST', {text: chatText.trim()});
      setChatText('');
    });
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
            {user
              ? 'A pultot a DJ beosztás nyitja meg. Kérd a tulajdonost, hogy adja hozzá a fiókodhoz.'
              : 'A pult a személyzet DJ beosztású tagjainak, az üzletvezetőknek és a tulajdonosnak érhető el.'}
          </p>
          <Link to={user ? '/staff' : '/staff-login'} className="rm-btn is-red mt-8 inline-flex">
            {user ? 'KONZOL ↗' : 'BELÉPÉS ↗'}
          </Link>
        </div>
      </main>
    );
  }

  const pendingRequests = (state?.requests || []).filter((request) => request.status === 'pending');

  return (
    <main className="pt-[68px]">
      <section className="rm-section">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="rm-label">RED MOON / BOOTH</div>
            <NeonHeading as="h1" size={2} className="mb-2 mt-3.5">
              A <em>pult.</em>
            </NeonHeading>
            <p className="text-[11px] text-[#8d8584]">Bejelentkezve: {user.name}</p>
          </div>
          <Link to="/club" className="rm-btn">
            KLUB OLDAL ↗
          </Link>
        </div>

        {/* Live control */}
        <div className="rm-card mb-3.5 mt-8 flex flex-col gap-5 p-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex-1">
            <span className="rm-label">ADÁS</span>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className={`flex items-center gap-2 border px-4 py-2.5 text-[9px] font-bold tracking-[0.2em] ${state?.live ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.18)] text-white' : 'border-white/10 text-[#8f8887]'}`}>
                <Radio size={11} className={state?.live ? 'animate-pulse text-[color:var(--rm-red)]' : ''}/>
                {state?.live ? `ÉLŐBEN · ${state.dj || ''}` : 'OFFLINE'}
              </span>
              <span className="flex items-center gap-2 border border-white/10 px-4 py-2.5 text-[9px] tracking-[0.2em] text-[#8f8887]">
                <Users size={11}/> {state?.listenerCount ?? 0} HALLGATÓ
              </span>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="ADÁS CÍME" className="flex-1">
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} className={inputClass}/>
            </Field>
            <Btn variant={state?.live ? 'outline' : 'red'} onClick={toggleLive} className="justify-center">
              {state?.live ? 'ADÁS LEÁLLÍTÁSA' : 'ADÁS INDÍTÁSA'}
            </Btn>
          </div>
        </div>

        {error && <p className="mb-3.5 text-[11px] text-[color:var(--rm-red)]">{error}</p>}

        {/* Now playing */}
        <Panel className="mb-3.5" label="MOST SZÓL">
          {state?.current ? (
            <>
              <h2 className="mb-4 font-heading text-[24px] text-white">{state.current.name}</h2>
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
            </>
          ) : (
            <p className="text-[11px] text-[#8d8584]">Nincs lejátszott zene. Indíts el egyet a tárból.</p>
          )}
        </Panel>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          {/* Library */}
          <Panel
            padded={false}
            className="lg:col-span-2"
            label="ZENETÁR"
            action={
              <label className="cursor-pointer text-[9px] tracking-[0.2em] text-[color:var(--rm-red)] hover:text-white">
                <input ref={fileRef} type="file" accept="audio/*" onChange={upload} className="hidden" disabled={!!uploading}/>
                <span className="flex items-center gap-2">
                  <Upload size={12}/> {uploading ? `FELTÖLTÉS… ${uploading}` : 'FELTÖLTÉS'}
                </span>
              </label>
            }
          >
            <div className="max-h-[420px] overflow-y-auto">
              {!state?.library.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">A tár üres. Tölts fel egy hangfájlt (legfeljebb 80 MB).</p>}
              {state?.library.map((track) => (
                <div key={track.id} className="flex items-center gap-3 border-b border-white/[0.04] px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[11px] text-white">{track.name}</strong>
                    <span className="text-[9px] text-[#777]">
                      {formatSize(track.size)}
                      {track.addedBy ? ` · ${track.addedBy}` : ''}
                    </span>
                  </div>
                  <button type="button" onClick={() => act(() => apiSend('/api/dj/queue', 'POST', {trackId: track.id}), 'accept')} aria-label="Sorba" title="Sorba" className="text-[#777] transition-colors hover:text-white">
                    <ListPlus size={13}/>
                  </button>
                  <button type="button" onClick={() => act(() => apiSend('/api/dj/play', 'POST', {trackId: track.id}))} aria-label="Lejátszás" title="Lejátszás" className="text-[color:var(--rm-red)] transition-opacity hover:opacity-70">
                    <Play size={13}/>
                  </button>
                  <button type="button" onClick={() => removeTrack(track)} aria-label="Törlés" title="Törlés" className="text-[#777] transition-colors hover:text-[color:var(--rm-red)]">
                    <Trash2 size={12}/>
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          {/* Side: queue, requests, chat */}
          <div className="flex flex-col gap-3.5">
            <Panel padded={false} label={`SOR (${state?.queue.length ?? 0})`}>
              <div className="max-h-[200px] overflow-y-auto">
                {!state?.queue.length && <p className="px-6 py-4 text-[11px] text-[#8d8584]">A sor üres.</p>}
                {state?.queue.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 border-b border-white/[0.04] px-6 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10px] text-white">{item.name}</span>
                      {item.addedBy && <span className="text-[8px] text-[#777]">{item.addedBy}</span>}
                    </span>
                    <button type="button" onClick={() => act(() => apiSend('/api/dj/play', 'POST', {queueId: item.id}))} aria-label="Most játszd" className="text-[color:var(--rm-red)]">
                      <Play size={12}/>
                    </button>
                    <button type="button" onClick={() => act(() => apiSend(`/api/dj/queue/${item.id}`, 'DELETE'), 'delete')} aria-label="Kivétel a sorból" className="text-[#777] hover:text-[color:var(--rm-red)]">
                      <X size={12}/>
                    </button>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel padded={false} label={`KÉRÉSEK (${pendingRequests.length})`}>
              <div className="max-h-[220px] overflow-y-auto">
                {!pendingRequests.length && <p className="px-6 py-4 text-[11px] text-[#8d8584]">Nincs függő kérés.</p>}
                {pendingRequests.map((request) => (
                  <div key={request.id} className="flex items-center gap-2 border-b border-white/[0.04] px-6 py-3">
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-[10px] text-white">{request.item?.name || '—'}</strong>
                      <span className="text-[9px] text-[#777]">{request.name}</span>
                    </div>
                    <button type="button" onClick={() => act(() => apiSend('/api/dj/request', 'POST', {id: request.id, action: 'accept'}), 'accept')} aria-label="Elfogadás" className="text-emerald-400">
                      <Check size={13}/>
                    </button>
                    <button type="button" onClick={() => act(() => apiSend('/api/dj/request', 'POST', {id: request.id, action: 'decline'}), 'delete')} aria-label="Elutasítás" className="text-[color:var(--rm-red)]">
                      <X size={13}/>
                    </button>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel label="ÜZENET A KLUBNAK">
              <form onSubmit={sendChat} className="flex gap-2">
                <input value={chatText} onChange={(event) => setChatText(event.target.value.slice(0, 500))} placeholder="DJ üzenet…" className={inputClass}/>
                <Btn type="submit" variant="red">
                  <Send size={13}/>
                </Btn>
              </form>
              <Link to="/club" className="mt-4 inline-block text-[9px] tracking-[0.2em] text-[color:var(--rm-red)] hover:text-white">
                NÉVKÉRELMEK ÉS HALLGATÓK A KLUB OLDALON ↗
              </Link>
            </Panel>
          </div>
        </div>
      </section>
    </main>
  );
};
