import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Check, Eye, EyeOff, GripVertical, ImagePlus, PenLine, Trash2, X} from 'lucide-react';
import {Btn, BtnLink} from '../../components/ui/Btn';
import {Select} from '../../components/ui/Select';
import {Badge, Field, inputClass, PageHeader, Panel} from '../../components/ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, assetUrl} from '../../lib/api';
import {uploadMedia} from '../../lib/media';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {dialog} from '../../stores/useDialogStore';
import type {GalleryItem, GalleryTag} from '../../types';

const TAG_OPTIONS: {value: GalleryTag; label: string; glyph: string}[] = [
  {value: 'ter', label: 'A tér', glyph: '場'},
  {value: 'este', label: 'Az este', glyph: '夜'},
  {value: 'jel', label: 'A jel', glyph: '印'}
];

interface Draft {
  title: string;
  caption: string;
  tag: GalleryTag;
}

/**
 * The owner's gallery: drop pictures in, give them a line, drag them into
 * order, hide or remove them. The public wall follows within a second.
 */
export const StaffGalleryPage: React.FC = () => {
  const {data, refresh, mutate} = useLiveData<{items: GalleryItem[]}>('/api/gallery', {intervalMs: 60000, topics: ['content'], refetchOnMutation: false});
  const items = useMemo(() => [...(data?.items || [])].sort((a, b) => a.sortOrder - b.sortOrder), [data]);

  const [uploads, setUploads] = useState<{name: string; progress: number}[]>([]);
  const [over, setOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<{url: string; publicId: string; width: number; height: number; name: string}[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pending.length) return;
    // Register what finished uploading, one by one, so a failure only loses one picture.
    const next = pending[0];
    apiSend('/api/gallery', 'POST', {title: next.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').toUpperCase().slice(0, 80), caption: '', tag: 'este', imageUrl: next.url, publicId: next.publicId, width: next.width, height: next.height})
      .then(() => {
        playSfx('success');
        refresh();
      })
      .catch((err) => toast.error('Nem került be', (err as Error).message))
      .finally(() => setPending((current) => current.slice(1)));
  }, [pending, refresh]);

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((file) => /^image\//.test(file.type));
    if (!list.length) {
      toast.error('Képet válassz', 'PNG, JPG, WebP, GIF vagy AVIF.');
      return;
    }
    for (const file of list) {
      setUploads((current) => [...current, {name: file.name, progress: 0}]);
      try {
        const media = await uploadMedia('image', 'gallery', file, (fraction) => setUploads((current) => current.map((entry) => (entry.name === file.name ? {...entry, progress: fraction} : entry))));
        setPending((current) => [...current, {url: media.url, publicId: media.publicId, width: media.width, height: media.height, name: file.name}]);
      } catch (err) {
        toast.error('A feltöltés nem sikerült', (err as Error).message);
        playSfx('error');
      } finally {
        setUploads((current) => current.filter((entry) => entry.name !== file.name));
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const startEdit = (item: GalleryItem) => {
    setEditingId(item.id);
    setDraft({title: item.title, caption: item.caption, tag: item.tag});
  };

  const saveEdit = async (item: GalleryItem) => {
    if (!draft) return;
    try {
      await apiSend(`/api/gallery/${item.id}`, 'PATCH', draft);
      setEditingId(null);
      setDraft(null);
      toast.success('Mentve.');
      playSfx('success');
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    }
  };

  const toggle = async (item: GalleryItem) => {
    mutate((current) => (current ? {items: current.items.map((entry) => (entry.id === item.id ? {...entry, active: !entry.active} : entry))} : current));
    try {
      await apiSend(`/api/gallery/${item.id}`, 'PATCH', {active: !item.active});
      playSfx('ui_click');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      refresh();
    }
  };

  const remove = async (item: GalleryItem) => {
    const sure = await dialog.confirm({title: `Törlöd: ${item.title || 'ezt a képet'}?`, message: 'A kép a galériából és a médiatárból is eltűnik.', confirmLabel: 'TÖRLÉS', tone: 'danger'});
    if (!sure) return;
    mutate((current) => (current ? {items: current.items.filter((entry) => entry.id !== item.id)} : current));
    try {
      await apiSend(`/api/gallery/${item.id}`, 'DELETE');
      playSfx('delete');
      toast.success('Kép törölve.');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      refresh();
    }
  };

  const reorder = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const list = [...items];
    const from = list.findIndex((item) => item.id === fromId);
    const to = list.findIndex((item) => item.id === toId);
    if (from < 0 || to < 0) return;
    const [moving] = list.splice(from, 1);
    list.splice(to, 0, moving);
    const next = list.map((item, index) => ({...item, sortOrder: index}));
    mutate(() => ({items: next}));
    try {
      await apiSend('/api/gallery/order', 'PUT', next.map((item) => ({id: item.id, sortOrder: item.sortOrder})));
      playSfx('ui_click');
    } catch (err) {
      toast.error('A sorrend nem mentődött', (err as Error).message);
      refresh();
    }
  };

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / GALÉRIA"
          title={
            <>
              A <em>fal.</em>
            </>
          }
          lead="Ami ide kerül, a nyilvános galériában jelenik meg. A rács magától igazodik a képek számához és arányához: a széles képek két oszlopot, a magasak két sort kapnak, az első a nagy helyet."
          actions={<BtnLink to="/gallery">A NYILVÁNOS GALÉRIA ↗</BtnLink>}
        />

        <div
          className={`rm-dropzone mb-6${over ? ' is-over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            addFiles(event.dataTransfer.files);
          }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => event.key === 'Enter' && fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={(event) => event.target.files && addFiles(event.target.files)} className="hidden"/>
          <ImagePlus size={22} className="text-[color:var(--rm-red)]"/>
          <strong className="text-[11px] tracking-[0.15em] text-white">HÚZD IDE A KÉPEKET, VAGY KATTINTS</strong>
          <span className="text-[10px] text-[#8d8584]">PNG, JPG, WebP, GIF, AVIF · legfeljebb 12 MB képenként · több kép egyszerre is mehet</span>
          {uploads.map((upload) => (
            <div key={upload.name} className="w-full max-w-sm">
              <div className="rm-progress">
                <i style={{width: `${Math.round(upload.progress * 100)}%`}}/>
              </div>
              <span className="mt-1 block truncate text-[9px] text-[#777]">{upload.name}</span>
            </div>
          ))}
        </div>

        <Panel padded={false} label={`KÉPEK (${items.length})`}>
          {!items.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">Még nincs kép. Húzz be egyet fent.</p>}
          <div className="rm-gallery-admin p-4">
            {items.map((item, index) => {
              const editing = editingId === item.id && draft;
              return (
                <div
                  key={item.id}
                  draggable={!editing}
                  onDragStart={(event) => {
                    setDragId(item.id);
                    event.dataTransfer.setData('text/plain', item.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (overId !== item.id) setOverId(item.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const id = dragId || event.dataTransfer.getData('text/plain');
                    setOverId(null);
                    setDragId(null);
                    if (id) reorder(id, item.id);
                  }}
                  className={`rm-gallery-card${dragId === item.id ? ' is-dragging' : ''}${overId === item.id ? ' is-over' : ''}${item.active ? '' : ' is-hidden'}`}
                >
                  <div className="rm-gallery-thumb">
                    <img src={assetUrl(item.src)} alt="" loading="lazy"/>
                    <span className="absolute left-2 top-2 flex items-center gap-1 border border-white/15 bg-black/60 px-2 py-1 text-[7px] tracking-[0.2em] text-[#ddd]">
                      <GripVertical size={9}/> {String(index + 1).padStart(2, '0')}
                    </span>
                    {!item.active && (
                      <span className="absolute right-2 top-2">
                        <Badge tone="warn">REJTETT</Badge>
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    {editing ? (
                      <div className="flex flex-col gap-2">
                        <input value={draft.title} onChange={(event) => setDraft({...draft, title: event.target.value.slice(0, 80)})} placeholder="Cím" className={`${inputClass} !py-2 !text-[11px]`}/>
                        <input value={draft.caption} onChange={(event) => setDraft({...draft, caption: event.target.value.slice(0, 200)})} placeholder="Egy sor a kép alá" className={`${inputClass} !py-2 !text-[11px]`}/>
                        <Field label="CÍMKE">
                          <Select value={draft.tag} options={TAG_OPTIONS} onChange={(value) => setDraft({...draft, tag: value})} size="sm"/>
                        </Field>
                        <div className="flex gap-2">
                          <Btn variant="red" className="!px-3 !py-2 !text-[8px]" onClick={() => saveEdit(item)}>
                            <Check size={11}/> MENTÉS
                          </Btn>
                          <Btn
                            className="!px-3 !py-2 !text-[8px]"
                            onClick={() => {
                              setEditingId(null);
                              setDraft(null);
                            }}
                          >
                            <X size={11}/>
                          </Btn>
                        </div>
                      </div>
                    ) : (
                      <>
                        <strong className="block truncate text-[11px] text-white">{item.title || '—'}</strong>
                        <span className="mt-1 block truncate text-[9px] text-[#8d8584]">{item.caption || 'nincs felirat'}</span>
                        <span className="mt-1 block text-[8px] tracking-[0.2em] text-[#5f5959]">
                          {TAG_OPTIONS.find((tag) => tag.value === item.tag)?.label.toUpperCase()} · {item.width && item.height ? `${item.width}×${item.height}` : 'méret ismeretlen'}
                        </span>
                        <div className="mt-3 flex items-center gap-1">
                          <button type="button" onClick={() => startEdit(item)} aria-label="Szerkesztés" className="p-1.5 text-[#777] hover:text-white">
                            <PenLine size={12}/>
                          </button>
                          <button type="button" onClick={() => toggle(item)} aria-label={item.active ? 'Elrejtés' : 'Megjelenítés'} className="p-1.5 text-[#777] hover:text-white">
                            {item.active ? <Eye size={12}/> : <EyeOff size={12}/>}
                          </button>
                          <button type="button" onClick={() => remove(item)} aria-label="Törlés" className="ml-auto p-1.5 text-[#777] hover:text-[color:var(--rm-red)]">
                            <Trash2 size={12}/>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </section>
    </main>
  );
};
