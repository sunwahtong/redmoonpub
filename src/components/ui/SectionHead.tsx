import React from 'react';
import {NeonHeading} from './NeonHeading';

interface Props {
  /** Numbered eyebrow, e.g. "02 / MA ESTE". */
  label: string;
  title: React.ReactNode;
  /** Optional lead paragraph or action rendered on the right. */
  aside?: React.ReactNode;
}

/** Legacy `.rm17-section-head`: eyebrow + oversized Cinzel h2, action on the right. */
export const SectionHead: React.FC<Props> = ({label, title, aside}) => (
  <div className="mb-14 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end md:gap-10">
    <div className="text-left">
      <div className="rm-label">{label}</div>
      <NeonHeading as="h2" className="mt-3.5">
        {title}
      </NeonHeading>
    </div>
    {aside && <div className="rm-lead max-w-md text-xs md:text-right">{aside}</div>}
  </div>
);
