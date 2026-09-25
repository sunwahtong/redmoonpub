import React, {useEffect, useMemo, useRef} from 'react';
import {Disc3, MessageSquare, Pin, Trash2} from 'lucide-react';
import type {ClubChatMessage, ClubPerson} from '../../hooks/useClub';
import {TierChip} from '../house/TierChip';
import {formatTime} from '../../lib/api';
import {tierMeta, type Tier} from '../../lib/houseCard';

const TIERS = new Set(['silver', 'gold', 'black', 'royal']);

const PALETTE_FALLBACK = '#ff5c7a';
const DJ_COLOR = '#ff2b4f';

const initialOf = (name: string) => (name || '?').trim().slice(0, 1).toUpperCase();

/** Lines the house writes, not a person. */
const HOUSE_KINDS = new Set(['system', 'request-accepted', 'request-declined', 'now-playing', 'notice', 'poll']);

const systemClass = (kind: string): string => {
  if (kind === 'request-accepted') return ' is-accept';
  if (kind === 'request-declined') return ' is-decline';
  if (kind === 'now-playing') return ' is-now';
  if (kind === 'notice') return ' is-notice';
  if (kind === 'poll') return ' is-poll';
  return '';
};

/**
 * A line of chat with @mentions coloured after the person they name.
 * Unknown names stay plain text; nothing else is interpreted.
 */
export const MentionText: React.FC<{text: string; people: ClubPerson[]}> = ({text, people}) => {
  const parts = useMemo(() => text.split(/(@[\p{L}\p{N}_.-]{2,32})/u), [text]);
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 0) return <React.Fragment key={index}>{part}</React.Fragment>;
        const person = people.find((entry) => entry.name.toLowerCase() === part.slice(1).toLowerCase());
        if (!person) return <React.Fragment key={index}>{part}</React.Fragment>;
        return (
          <b key={index} className="rm-mention" style={{'--bubble': person.color} as React.CSSProperties}>
            {part}
          </b>
        );
      })}
    </>
  );
};

export const Bubble: React.FC<{
  message: ClubChatMessage;
  self: boolean;
  mentioned: boolean;
  people: ClubPerson[];
  canDelete: boolean;
  onDelete?: () => void;
}> = ({message, self, mentioned, people, canDelete, onDelete}) => {
  if (HOUSE_KINDS.has(message.kind)) {
    return (
      <div className={`rm-chat-system${systemClass(message.kind)}`}>
        {message.kind === 'notice' && <Pin size={9} className="mr-1.5 inline-block align-[-1px]"/>}
        {message.text}
        <span className="ml-2 text-[#5f5959]">{formatTime(message.at)}</span>
        {canDelete && onDelete && (
          <button type="button" onClick={onDelete} aria-label="Sor törlése" className="ml-2 text-[#5f5959] hover:text-[color:var(--rm-red)]">
            <Trash2 size={10}/>
          </button>
        )}
      </div>
    );
  }
  const dj = message.kind === 'dj';
  const color = dj ? DJ_COLOR : message.color || PALETTE_FALLBACK;
  const tiered = !dj && !!message.tier && TIERS.has(message.tier);
  return (
    <div
      className={`rm-bubble${self ? ' is-self' : ''}${dj ? ' is-dj' : ''}${message.kind === 'request' ? ' is-request' : ''}${mentioned ? ' is-mentioned' : ''}${tiered ? ' is-tiered' : ''}`}
      style={{'--bubble': color, ...(tiered ? {'--chip': tierMeta(message.tier as Tier).ink} : {})} as React.CSSProperties}
    >
      <span className="rm-bubble-avatar" aria-hidden="true">
        {dj ? <Disc3 size={13}/> : initialOf(message.name)}
      </span>
      <div className="rm-bubble-body">
        <div className="rm-bubble-meta">
          <span className="rm-bubble-name">{message.name}</span>
          {tiered && <TierChip tier={message.tier}/>}
          <span className="rm-bubble-time">{formatTime(message.at)}</span>
        </div>
        <p className="rm-bubble-text">
          <MentionText text={message.text} people={people}/>
        </p>
      </div>
      {canDelete && onDelete && (
        <button type="button" onClick={onDelete} aria-label="Üzenet törlése" className="rm-chat-delete">
          <Trash2 size={12}/>
        </button>
      )}
    </div>
  );
};

interface Props {
  /** Chronological. */
  lines: ClubChatMessage[];
  people: ClubPerson[];
  myName: string;
  canModerate: boolean;
  onDelete?: (id: string) => void;
  notice?: string;
  slowMode?: number;
  title?: string;
  /** Right side of the header. */
  meta?: React.ReactNode;
  /** A strip of moderation tools under the header (the booth). */
  tools?: React.ReactNode;
  /** The form — or the status block — under the lines. */
  composer: React.ReactNode;
  heightClass?: string;
  error?: string | null;
}

/**
 * The room's chat: the DJ's pinned notice, the lines (stuck to the newest
 * unless the reader scrolled up), and whatever the page puts underneath.
 */
export const ChatPanel: React.FC<Props> = ({lines, people, myName, canModerate, onDelete, notice, slowMode = 0, title = 'KLUB CHAT', meta, tools, composer, heightClass = 'max-h-[520px] min-h-[320px]', error}) => {
  const chatRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const element = chatRef.current;
    if (!element) return;
    if (stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const element = chatRef.current;
    if (!element) return;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
  };

  const me = myName.toLowerCase();
  const mentionsMe = (text: string) => !!me && new RegExp(`@${me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu').test(text);

  return (
    <div className="rm-card flex flex-col p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--rm-line)] px-6 py-4">
        <span className="rm-label flex items-center gap-2">
          <MessageSquare size={11}/> {title}
        </span>
        <span className="flex items-center gap-3 text-[9px] text-[#777]">
          {slowMode > 0 && <span className="text-amber-300">LASSÚ MÓD · {slowMode} MP</span>}
          {meta}
        </span>
      </div>
      {tools}
      {notice && (
        <div className="rm-notice">
          <Pin size={11}/>
          <span>{notice}</span>
        </div>
      )}

      <div ref={chatRef} onScroll={onScroll} className={`rm-chat ${heightClass}`}>
        {!lines.length && <p className="text-[11px] text-[#8d8584]">Még nincs üzenet. Légy te az első.</p>}
        {lines.map((message) => (
          <Bubble
            key={message.id}
            message={message}
            people={people}
            self={!!myName && message.name === myName && !HOUSE_KINDS.has(message.kind)}
            mentioned={!HOUSE_KINDS.has(message.kind) && mentionsMe(message.text)}
            canDelete={canModerate}
            onDelete={onDelete ? () => onDelete(message.id) : undefined}
          />
        ))}
      </div>

      {composer}
      {error && <p className="px-6 pb-4 text-[11px] text-[color:var(--rm-red)]">{error}</p>}
    </div>
  );
};
