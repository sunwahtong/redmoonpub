import React from 'react';
import type {LeadershipMember} from '../../lib/content';

interface Props {
  member: LeadershipMember;
  /** The owner tier gets a stronger halo than the managers below it. */
  emphasis?: 'primary' | 'secondary' | 'muted';
}

const AVATAR_RING: Record<NonNullable<Props['emphasis']>, string> = {
  primary: 'border-[rgba(213,31,60,0.5)] shadow-[0_0_60px_rgba(213,31,60,0.18)]',
  secondary: 'border-[rgba(213,31,60,0.38)] shadow-[0_0_50px_rgba(213,31,60,0.12)]',
  muted: 'border-white/15 shadow-[0_0_34px_rgba(213,31,60,0.07)]'
};

/**
 * Legacy `.rm17-owner`: a tall square portrait card with a ruby bloom behind a
 * large Cinzel monogram, and the name block anchored to the bottom.
 */
export const LeaderCard: React.FC<Props> = ({member, emphasis = 'secondary'}) => (
  <article className="rm-card relative flex min-h-[360px] w-full flex-col justify-end overflow-hidden p-8 text-left">
    <div
      className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(213,31,60,0.24),transparent_32%)]"
      aria-hidden="true"
    />

    <div
      className={`absolute left-1/2 top-[50px] grid h-[160px] w-[160px] -translate-x-1/2 place-items-center rounded-full border bg-[radial-gradient(circle,#250811,#09090b_70%)] font-heading text-[35px] text-[#eee] ${AVATAR_RING[emphasis]}`}
    >
      {member.avatar}
    </div>

    <div className="relative z-[1]">
      <span className="text-[8px] tracking-[0.25em] text-[color:var(--rm-red)]">{member.role}</span>
      <h3 className="mb-1.5 mt-2.5 font-heading text-[26px] leading-none text-white">{member.name}</h3>
      <p className="text-[10px] text-[#7f7978]">{member.note}</p>
    </div>
  </article>
);
