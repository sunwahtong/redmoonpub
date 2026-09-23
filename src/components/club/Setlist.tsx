import React from 'react';
import {ListMusic, Radio, Trash2} from 'lucide-react';
import type {SetlistEntry} from '../../hooks/useClub';
import {formatTime} from '../../lib/api';

interface Props {
  entries: SetlistEntry[];
  /** What the stream names right now, ahead of the list. */
  nowPlaying?: {title: string; artist: string} | null;
  live: boolean;
  canModerate?: boolean;
  onRemove?: (id: string) => void;
  limit?: number;
}

const SOURCE_LABEL: Record<string, string> = {announce: 'DJ', library: 'TÁR', request: 'KÉRÉS', station: 'STREAM'};

/** The line a track prints as. */
export const trackLine = (entry: {title: string; artist: string}): string => (entry.artist ? `${entry.artist} – ${entry.title}` : entry.title);

/**
 * Tonight's setlist: what the DJ announced, started from the library, marked
 * played from a request, or what the stream's own metadata named. Newest
 * first; the top line is what is on right now.
 */
export const Setlist: React.FC<Props> = ({entries, nowPlaying, live, canModerate, onRemove, limit = 12}) => {
  const current = nowPlaying?.title ? nowPlaying : entries[0] ? {title: entries[0].title, artist: entries[0].artist} : null;
  const rows = entries.slice(0, limit);

  return (
    <div className="rm-card p-0">
      <div className="flex items-center justify-between border-b border-[color:var(--rm-line)] px-6 py-4">
        <span className="rm-label flex items-center gap-2">
          <ListMusic size={11}/> MA ESTE SZÓLT
        </span>
        <span className="text-[9px] text-[#777]">{entries.length} szám</span>
      </div>

      {live && current && (
        <div className="rm-setlist-now">
          <span className="rm-eq is-on w-10 shrink-0" aria-hidden="true">
            {Array.from({length: 5}, (_, index) => (
              <i key={index}/>
            ))}
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-[7px] tracking-[0.3em] text-[color:var(--rm-red-bright)]">MOST SZÓL</span>
            <strong className="block truncate text-[12px] text-white" title={trackLine(current)}>{trackLine(current)}</strong>
          </div>
        </div>
      )}

      <div className="max-h-[320px] overflow-y-auto">
        {!rows.length && <p className="px-6 py-5 text-[11px] text-[#8d8584]">{live ? 'A setlist a DJ bemondásaival és a stream címeivel töltődik.' : 'Csend van. Az esti setlist itt gyűlik majd.'}</p>}
        {rows.map((entry, index) => (
          <div key={entry.id} className="rm-setlist-row">
            <span className="w-6 shrink-0 text-[9px] text-[#5f5959]">{String(entries.length - index).padStart(2, '0')}</span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[11px] text-white" title={trackLine(entry)}>{trackLine(entry)}</span>
              <span className="text-[8px] tracking-[0.15em] text-[#777]">
                {formatTime(entry.at)}
                {entry.source === 'request' && entry.byName ? ` · ${entry.byName} kérte` : ''}
                {entry.source === 'announce' && entry.byName ? ` · ${entry.byName}` : ''}
              </span>
            </div>
            <span className={`rm-source is-${entry.source}`} title={entry.source === 'station' ? 'A stream metaadatából' : ''}>
              {entry.source === 'station' && <Radio size={8} className="mr-1 inline-block align-[-1px]"/>}
              {SOURCE_LABEL[entry.source] || entry.source}
            </span>
            {canModerate && onRemove && (
              <button type="button" onClick={() => onRemove(entry.id)} aria-label="Törlés a setlistről" className="p-1 text-[#5f5959] hover:text-[color:var(--rm-red)]">
                <Trash2 size={11}/>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
