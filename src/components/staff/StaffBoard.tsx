import React, {useState} from 'react';
import {Pin, PinOff, Send, Trash2} from 'lucide-react';
import {Btn} from '../ui/Btn';
import {Panel} from '../ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatDate, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {dialog} from '../../stores/useDialogStore';
import {roleAtLeast, useAuthStore} from '../../stores/useAuthStore';

interface Note {
  id: string;
  at: string;
  text: string;
  byId: string | null;
  byName: string;
  pinned: boolean;
}

const MAX = 600;

/**
 * The notice board behind the bar: short lines from managers and the owner
 * for everyone on the console — tonight's plan, a warning, a thank-you.
 * Owners pin what must stay on top; authors and owners take lines down.
 */
export const StaffBoard: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const isManager = roleAtLeast(user?.role, 'manager');
  const isOwner = roleAtLeast(user?.role, 'owner');
  const {data, refresh} = useLiveData<{notes: Note[]}>('/api/staff/notes', {intervalMs: 60000, topics: ['staff']});
  const [text, setText] = useState('');
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const notes = data?.notes || [];

  const post = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await apiSend('/api/staff/notes', 'POST', {text: value, pinned: pin});
      setText('');
      setPin(false);
      playSfx('success');
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (note: Note) => {
    const sure = await dialog.confirm({title: 'Leveszed a tábláról?', message: note.text.slice(0, 120), confirmLabel: 'LEVÉTEL', tone: 'danger'});
    if (!sure) return;
    try {
      await apiSend(`/api/staff/notes/${note.id}`, 'DELETE');
      playSfx('delete');
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
    }
  };

  const togglePin = async (note: Note) => {
    try {
      await apiSend(`/api/staff/notes/${note.id}`, 'PATCH', {pinned: !note.pinned});
      playSfx('accept');
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
    }
  };

  return (
    <Panel padded={false} label="ÜZENŐFAL" title={notes.length ? undefined : 'Üres a tábla.'} action={<span className="text-[9px] text-[#777]">{notes.length} sor</span>}>
      <div className="flex max-h-[380px] flex-col gap-2 overflow-y-auto px-5 py-4">
        {!notes.length && <p className="text-[11px] text-[#8d8584]">{isManager ? 'Írj egy sort a csapatnak: mi lesz ma este, mire figyeljenek.' : 'A managerek ide írnak, ha van mit tudni az estéről.'}</p>}
        {notes.map((note) => (
          <div key={note.id} className={`rm-board-note${note.pinned ? ' is-pinned' : ''}`}>
            {note.pinned && <Pin size={10} className="mr-1.5 inline-block align-[-1px] text-[#ffd166]"/>}
            {note.text}
            <small>
              {note.byName} · {formatDate(note.at)} {formatTime(note.at)}
            </small>
            {(isOwner || note.byId === user?.id) && (
              <span className="rm-board-tools">
                {isOwner && (
                  <button type="button" onClick={() => togglePin(note)} aria-label={note.pinned ? 'Kitűzés levétele' : 'Kitűzés'} className="p-1 text-[#8d8584] hover:text-[#ffd166]">
                    {note.pinned ? <PinOff size={11}/> : <Pin size={11}/>}
                  </button>
                )}
                <button type="button" onClick={() => remove(note)} aria-label="Levétel" className="p-1 text-[#8d8584] hover:text-[color:var(--rm-red)]">
                  <Trash2 size={11}/>
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      {isManager && (
        <form onSubmit={post} className="border-t border-[color:var(--rm-line)] p-4">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, MAX))}
            rows={2}
            placeholder="Egy sor a csapatnak…"
            className="rm-input w-full resize-none"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            {isOwner ? (
              <label className="flex items-center gap-2 text-[8px] tracking-[0.22em] text-[#777]">
                <button type="button" role="switch" aria-checked={pin} onClick={() => setPin((value) => !value)} className="rm-switch rm-switch-sm"/>
                KITŰZVE
              </label>
            ) : (
              <span className="text-[8px] tracking-[0.22em] text-[#5f5959]">{text.length}/{MAX}</span>
            )}
            <Btn type="submit" variant="red" disabled={busy || !text.trim()} className="!px-3 !py-2 !text-[8px]">
              <Send size={11}/> A TÁBLÁRA
            </Btn>
          </div>
        </form>
      )}
    </Panel>
  );
};
