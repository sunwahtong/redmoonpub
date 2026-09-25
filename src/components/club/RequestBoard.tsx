import React, {useState} from 'react';
import {Check, Disc3, Music2, ThumbsUp, Trash2, X} from 'lucide-react';
import type {MusicRequest} from '../../hooks/useClub';
import {TierChip} from '../house/TierChip';
import {formatTime} from '../../lib/api';
import {RANK, tierMeta, type Tier} from '../../lib/houseCard';

/** Gold and above ask the booth first. */
const priorityOf = (tier: string | undefined): number => (tier && RANK[tier as Tier] >= 2 ? 1 : 0);

export type RequestAction = 'accept' | 'decline' | 'played' | 'delete';

type View = 'all' | 'pending' | 'accepted' | 'played' | 'declined';

interface Props {
  requests: MusicRequest[];
  requestsOpen: boolean;
  votedIds: string[];
  onVote?: (id: string) => void;
  canModerate?: boolean;
  onAction?: (id: string, action: RequestAction) => void;
  /** The booth sees declined ones too. */
  showDeclined?: boolean;
  emptyText?: string;
}

const STATUS_LABEL: Record<string, string> = {pending: 'VÁR', accepted: 'SORBAN', played: 'MENT', declined: 'NEM'};
const VIEWS: {id: View; label: string}[] = [
  {id: 'pending', label: 'VÁR'},
  {id: 'accepted', label: 'SORBAN'},
  {id: 'played', label: 'MENT'},
  {id: 'declined', label: 'NEM'},
  {id: 'all', label: 'MIND'}
];

/**
 * Tonight's song requests in one place, backed by the room. The most wanted
 * rise to the top; the DJ works the same list from the booth, filtered by
 * what still needs a decision.
 */
export const RequestBoard: React.FC<Props> = ({requests, requestsOpen, votedIds, onVote, canModerate, onAction, showDeclined, emptyText}) => {
  const [view, setView] = useState<View>(canModerate ? 'pending' : 'all');
  const counts = requests.reduce<Record<string, number>>((acc, request) => ({...acc, [request.status]: (acc[request.status] || 0) + 1}), {});
  const base = requests.filter((request) => showDeclined || request.status !== 'declined');
  const visible = canModerate && view !== 'all' ? base.filter((request) => request.status === view) : base;
  const order = (status: string) => (status === 'pending' ? 0 : status === 'accepted' ? 1 : status === 'played' ? 2 : 3);
  const sorted = [...visible].sort((a, b) => order(a.status) - order(b.status) || priorityOf(b.tier) - priorityOf(a.tier) || b.votes - a.votes || a.at.localeCompare(b.at));

  return (
    <div className="rm-card p-0">
      <div className="flex items-center justify-between border-b border-[color:var(--rm-line)] px-6 py-4">
        <span className="rm-label flex items-center gap-2">
          <Music2 size={11}/> KÉRÉSEK ({counts.pending || 0})
        </span>
        <span className={`text-[8px] tracking-[0.2em] ${requestsOpen ? 'text-emerald-300' : 'text-amber-300'}`}>{requestsOpen ? 'NYITVA' : 'ZÁRVA'}</span>
      </div>
      {canModerate && (
        <div className="flex flex-wrap gap-1.5 border-b border-white/[0.04] px-4 py-2.5">
          {VIEWS.map((entry) => (
            <button key={entry.id} type="button" onClick={() => setView(entry.id)} className={`rm-board-view${view === entry.id ? ' is-on' : ''}`} aria-pressed={view === entry.id}>
              {entry.label}
              <span>{entry.id === 'all' ? base.length : counts[entry.id] || 0}</span>
            </button>
          ))}
        </div>
      )}
      <div className="max-h-[360px] overflow-y-auto">
        {!sorted.length && (
          <p className="px-6 py-5 text-[11px] text-[#8d8584]">
            {canModerate && view !== 'all' && base.length ? 'Ebben a listában most nincs kérés.' : emptyText || 'Még nincs kérés ma este. A chatben a „ZENÉT KÉREK” gombbal kérhetsz.'}
          </p>
        )}
        {sorted.map((request) => {
          const voted = votedIds.includes(request.id);
          const closed = request.status === 'played' || request.status === 'declined';
          const priority = priorityOf(request.tier) > 0 && request.status === 'pending';
          return (
            <div
              key={request.id}
              className={`rm-board-row${closed ? ' is-closed' : ''}${request.status === 'accepted' ? ' is-accepted' : ''}${priority ? ' is-priority' : ''}`}
              style={{'--bubble': request.color || '#ff5c7a', ...(request.tier && RANK[request.tier as Tier] ? {'--chip': tierMeta(request.tier as Tier).ink} : {})} as React.CSSProperties}
            >
              <button
                type="button"
                onClick={() => onVote?.(request.id)}
                disabled={closed || !onVote}
                className={`rm-vote${voted ? ' is-on' : ''}`}
                aria-pressed={voted}
                aria-label={voted ? 'Szavazat visszavonása' : 'Ezt akarom hallani'}
                title={voted ? 'Szavazat visszavonása' : 'Ezt akarom hallani'}
              >
                <ThumbsUp size={11}/>
                <b>{request.votes}</b>
              </button>
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-[11px] text-white">{request.item?.name || '—'}</strong>
                <span className="text-[9px]" style={{color: request.color || '#8d8584'}}>{request.name}</span>
                {request.tier && <TierChip tier={request.tier} className="ml-1.5"/>}
                <span className="text-[9px] text-[#777]"> · {formatTime(request.at)}</span>
              </div>
              <span className={`rm-board-status is-${request.status}`}>{STATUS_LABEL[request.status] || request.status}</span>
              {canModerate && onAction && (
                <span className="flex shrink-0 items-center gap-0.5">
                  {request.status === 'pending' && (
                    <>
                      <button type="button" onClick={() => onAction(request.id, 'accept')} aria-label="Elfogadás" title={request.item?.requestOnly ? 'Elfogadás (jelzed, hogy jön)' : 'Elfogadás és sorba'} className="p-1 text-emerald-400 hover:opacity-70">
                        <Check size={13}/>
                      </button>
                      <button type="button" onClick={() => onAction(request.id, 'decline')} aria-label="Elutasítás" title="Elutasítás" className="p-1 text-[color:var(--rm-red)] hover:opacity-70">
                        <X size={13}/>
                      </button>
                    </>
                  )}
                  {(request.status === 'pending' || request.status === 'accepted') && (
                    <button type="button" onClick={() => onAction(request.id, 'played')} aria-label="Most szól" title="Most szól — a setlistre kerül" className="p-1 text-[#ffd166] hover:opacity-70">
                      <Disc3 size={13}/>
                    </button>
                  )}
                  <button type="button" onClick={() => onAction(request.id, 'delete')} aria-label="Törlés" title="Törlés" className="p-1 text-[#777] hover:text-[color:var(--rm-red)]">
                    <Trash2 size={12}/>
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
