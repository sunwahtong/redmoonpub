import React from 'react';

interface Props {
  className?: string;
  /** How many blocks to render. */
  count?: number;
}

/**
 * Loading placeholder in the house style.
 *
 * Tailwind's `animate-pulse` fades a grey rectangle in and out, which on a
 * ruby-and-black page reads as a rendering fault rather than as loading. This
 * sweeps a red-tinted highlight across a proper bordered surface instead, so a
 * loading grid looks like the grid that is about to replace it.
 */
export const Skeleton: React.FC<Props> = ({className = '', count = 1}) => (
  <>
    {Array.from({length: count}, (_, index) => (
      <div key={index} className={`rm-skeleton ${className}`} aria-hidden="true"/>
    ))}
  </>
);
