import React, {useState} from 'react';
import {Eye, EyeOff, ImagePlus, Pencil, Pin, PinOff, Trash2, X} from 'lucide-react';
import {Btn} from '../../components/ui/Btn';
import {Badge, Field, inputClass, PageHeader, Panel} from '../../components/ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, assetUrl, formatDate, formatTime} from '../../lib/api';
import {uploadMedia} from '../../lib/media';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {dialog} from '../../stores/useDialogStore';
import type {Post} from '../../types';

interface Draft {
  title: string;
  body: string;
  imageUrl: string;
  imagePublicId: string;
  pinned: boolean;
  active: boolean;
  publishedAt: string;
}

const empty = (): Draft => ({title: '', body: '', imageUrl: '', imagePublicId: '', pinned: false, active: true, publishedAt: ''});

const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const draftOf = (post: Post): Draft => ({
  title: post.title,
  body: post.body,
  imageUrl: post.imageUrl,
  imagePublicId: post.imagePublicId,
  pinned: post.pinned,
  active: post.active,
  publishedAt: toLocalInput(post.publishedAt)
});

/**
 * Where the owner writes the house's news. A post is a title, plain text
 * (blank lines separate paragraphs), an optional picture, and whether it is
 * pinned or hidden. Published at once unless a later date is set.
 */
export const PostsPage: React.FC = () => {
  const {data, refresh} = useLiveData<{posts: Post[]}>('/api/posts', {intervalMs: 60000, topics: ['content']});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const posts = data?.posts || [];

  const payload = () => ({
    title: draft.title,
    body: draft.body,
    imageUrl: draft.imageUrl,
    imagePublicId: draft.imagePublicId,
    pinned: draft.pinned,
    active: draft.active,
    publishedAt: draft.publishedAt ? new Date(draft.publishedAt).toISOString() : undefined
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (editing) await apiSend(`/api/posts/${editing}`, 'PATCH', payload());
      else await apiSend('/api/posts', 'POST', payload());
      toast.success(editing ? 'Hír mentve.' : 'Hír közzétéve.');
      playSfx('success');
      setDraft(empty());
      setEditing(null);
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const pickImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const media = await uploadMedia('image', 'post', file);
      setDraft((current) => ({...current, imageUrl: media.url, imagePublicId: media.publicId}));
      playSfx('success');
    } catch (err) {
      toast.error('A feltöltés nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const patch = async (post: Post, change: Partial<Pick<Post, 'pinned' | 'active'>>) => {
    try {
      await apiSend(`/api/posts/${post.id}`, 'PATCH', change);
      playSfx('accept');
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
    }
  };

  const remove = async (post: Post) => {
    const sure = await dialog.confirm({title: `Törlöd: ${post.title}?`, message: 'A kép a médiatárból is törlődik.', confirmLabel: 'TÖRLÉS', tone: 'danger'});
    if (!sure) return;
    try {
      await apiSend(`/api/posts/${post.id}`, 'DELETE');
      playSfx('delete');
      if (editing === post.id) {
        setEditing(null);
        setDraft(empty());
      }
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
    }
  };

  return (
    <main>
      <section className="rm-section">
        <PageHeader kicker="RED MOON / HÍREK" title={<>A ház <em>hírei.</em></>} lead="Ami a nyilvános Hírek oldalon és a főoldalon megjelenik. Kitűzve az marad legfelül; rejtve nem látszik, de megmarad."/>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.1fr_1fr]">
          <Panel label={editing ? 'SZERKESZTÉS' : 'ÚJ HÍR'} title={editing ? draft.title || 'Hír' : 'Mi történt?'} action={editing ? <button type="button" onClick={() => { setEditing(null); setDraft(empty()); }} className="text-[9px] tracking-[0.2em] text-[#777] hover:text-white"><X size={11} className="mr-1 inline-block"/>MÉGSE</button> : undefined}>
            <form onSubmit={save} className="flex flex-col gap-4">
              <Field label="CÍM">
                <input value={draft.title} onChange={(event) => setDraft({...draft, title: event.target.value.slice(0, 140)})} required maxLength={140} className={inputClass}/>
              </Field>
              <Field label="SZÖVEG" hint="Üres sor választja el a bekezdéseket.">
                <textarea value={draft.body} onChange={(event) => setDraft({...draft, body: event.target.value.slice(0, 4000)})} rows={8} className={`${inputClass} resize-y`}/>
              </Field>
              <Field label="KÉP" hint="Tölts fel egyet, vagy írj be egy /assets/… útvonalat. Nem kötelező.">
                <div className="flex gap-2">
                  <input value={draft.imageUrl} onChange={(event) => setDraft({...draft, imageUrl: event.target.value, imagePublicId: ''})} maxLength={600} placeholder="assets/gallery/…" className={inputClass}/>
                  <label className={`rm-btn is-ghost !px-3 !py-2 !text-[8px] cursor-pointer${uploading ? ' opacity-50' : ''}`}>
                    <input type="file" accept="image/*" onChange={pickImage} className="hidden" disabled={uploading}/>
                    <ImagePlus size={12}/> {uploading ? 'FELTÖLTÉS…' : 'KÉP'}
                  </label>
                </div>
                {draft.imageUrl && <img src={assetUrl(draft.imageUrl)} alt="" className="mt-2 h-28 w-full object-cover opacity-80"/>}
              </Field>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="MEGJELENÉS" hint="Üresen: most.">
                  <input type="datetime-local" value={draft.publishedAt} onChange={(event) => setDraft({...draft, publishedAt: event.target.value})} className={inputClass}/>
                </Field>
                <label className="flex items-center justify-between gap-3 border border-[color:var(--rm-line)] px-4 py-3 text-[8px] tracking-[0.22em] text-[#777]">
                  KITŰZVE
                  <button type="button" role="switch" aria-checked={draft.pinned} onClick={() => setDraft({...draft, pinned: !draft.pinned})} className="rm-switch rm-switch-sm"/>
                </label>
                <label className="flex items-center justify-between gap-3 border border-[color:var(--rm-line)] px-4 py-3 text-[8px] tracking-[0.22em] text-[#777]">
                  LÁTHATÓ
                  <button type="button" role="switch" aria-checked={draft.active} onClick={() => setDraft({...draft, active: !draft.active})} className="rm-switch rm-switch-sm"/>
                </label>
              </div>
              <div>
                <Btn type="submit" variant="red" disabled={busy || !draft.title.trim()}>
                  {editing ? 'MENTÉS' : 'KÖZZÉTÉTEL'}
                </Btn>
              </div>
            </form>
          </Panel>

          <Panel padded={false} label={`HÍREK (${posts.length})`}>
            <div className="max-h-[720px] overflow-y-auto">
              {!posts.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">Még nincs hír. Az első itt jelenik meg.</p>}
              {posts.map((post) => (
                <div key={post.id} className={`flex items-start gap-3 border-b border-white/[0.04] px-5 py-4${!post.active ? ' opacity-55' : ''}`}>
                  {post.imageUrl ? <img src={assetUrl(post.imageUrl)} alt="" className="h-12 w-16 shrink-0 object-cover"/> : <span className="h-12 w-16 shrink-0 border border-white/[0.06] bg-[#0a0a0c]"/>}
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[12px] text-white">{post.title}</strong>
                    <span className="text-[9px] text-[#777]">
                      {post.publishedAt ? `${formatDate(post.publishedAt)} ${formatTime(post.publishedAt)}` : ''}
                      {post.createdByName ? ` · ${post.createdByName}` : ''}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {post.pinned && <Badge tone="warn">KITŰZVE</Badge>}
                      {!post.active && <Badge>REJTETT</Badge>}
                      {post.publishedAt && new Date(post.publishedAt).getTime() > Date.now() && <Badge tone="sky">IDŐZÍTVE</Badge>}
                    </span>
                  </div>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button type="button" onClick={() => { setEditing(post.id); setDraft(draftOf(post)); window.scrollTo({top: 0, behavior: 'smooth'}); }} aria-label="Szerkesztés" className="p-1 text-[#777] hover:text-white">
                      <Pencil size={12}/>
                    </button>
                    <button type="button" onClick={() => patch(post, {pinned: !post.pinned})} aria-label={post.pinned ? 'Kitűzés levétele' : 'Kitűzés'} className="p-1 text-[#777] hover:text-[#ffd166]">
                      {post.pinned ? <PinOff size={12}/> : <Pin size={12}/>}
                    </button>
                    <button type="button" onClick={() => patch(post, {active: !post.active})} aria-label={post.active ? 'Elrejtés' : 'Megjelenítés'} className="p-1 text-[#777] hover:text-white">
                      {post.active ? <EyeOff size={12}/> : <Eye size={12}/>}
                    </button>
                    <button type="button" onClick={() => remove(post)} aria-label="Törlés" className="p-1 text-[#777] hover:text-[color:var(--rm-red)]">
                      <Trash2 size={12}/>
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </section>
    </main>
  );
};
