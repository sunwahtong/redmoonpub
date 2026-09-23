import React from 'react';
import {BarChart3, Check, Lock, Trash2} from 'lucide-react';
import type {ClubPoll} from '../../hooks/useClub';
import {useCountdown} from '../../hooks/useCountdown';

interface Props {
  poll: ClubPoll;
  /** The option this browser chose, if any. */
  myVote?: string;
  canVote: boolean;
  onVote?: (optionId: string) => void;
  canModerate?: boolean;
  onClose?: () => void;
  onDelete?: () => void;
}

/**
 * The DJ's question to the room. Open: the options are buttons and the bars
 * fill as votes land. Closed: the result stays up, the winner marked.
 */
export const PollCard: React.FC<Props> = ({poll, myVote, canVote, onVote, canModerate, onClose, onDelete}) => {
  const countdown = useCountdown(poll.open && poll.closesAt ? poll.closesAt : null);
  const leader = poll.total ? [...poll.options].sort((a, b) => b.votes - a.votes)[0] : null;

  return (
    <div className={`rm-card p-6${poll.open ? ' rm-poll is-open' : ' rm-poll'}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="rm-label flex items-center gap-2">
          <BarChart3 size={11}/> {poll.open ? 'SZAVAZÁS' : 'EREDMÉNY'}
        </span>
        <span className="text-[8px] tracking-[0.2em] text-[#777]">
          {poll.open ? (poll.closesAt && !countdown.elapsed ? `${countdown.h !== '00' ? `${countdown.h}:` : ''}${countdown.m}:${countdown.s}` : 'NYITVA') : 'LEZÁRVA'}
        </span>
      </div>
      <h3 className="mt-3 font-heading text-[18px] leading-tight text-white">{poll.question}</h3>
      <p className="mt-1 text-[9px] text-[#8d8584]">
        {poll.byName ? `${poll.byName} kérdezi · ` : ''}
        {poll.total} szavazat
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {poll.options.map((option) => {
          const share = poll.total ? Math.round((option.votes / poll.total) * 100) : 0;
          const mine = myVote === option.id;
          const winner = !poll.open && leader && leader.id === option.id && option.votes > 0;
          const content = (
            <>
              <i className="rm-poll-bar" style={{width: `${share}%`}} aria-hidden="true"/>
              <span className="rm-poll-label">
                {mine && <Check size={11} className="mr-1.5 inline-block align-[-1px]"/>}
                {option.label}
              </span>
              <span className="rm-poll-count">
                {winner && '★ '}
                {option.votes} · {share}%
              </span>
            </>
          );
          return poll.open && canVote && onVote ? (
            <button key={option.id} type="button" onClick={() => onVote(option.id)} className={`rm-poll-opt${mine ? ' is-mine' : ''}`} aria-pressed={mine}>
              {content}
            </button>
          ) : (
            <div key={option.id} className={`rm-poll-opt is-static${mine ? ' is-mine' : ''}${winner ? ' is-winner' : ''}`}>
              {content}
            </div>
          );
        })}
      </div>

      {poll.open && !canVote && <p className="mt-3 text-[9px] text-[#8d8584]">A szavazáshoz elég a klubban lenni — csak koppints.</p>}

      {canModerate && (
        <div className="mt-4 flex gap-2">
          {poll.open && onClose && (
            <button type="button" onClick={onClose} className="rm-btn !px-3 !py-2 !text-[8px]">
              <Lock size={10}/> LEZÁRÁS
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={onDelete} className="rm-btn is-ghost !px-3 !py-2 !text-[8px]">
              <Trash2 size={10}/> TÖRLÉS
            </button>
          )}
        </div>
      )}
    </div>
  );
};
