import React from 'react';
import {NeonHeading} from './NeonHeading';

interface Props {
  label: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<Props> = ({label, title, description, action}) => (
  <div className="flex flex-col items-center gap-5 border border-dashed border-white/10 bg-[#09090b] px-8 py-20 text-center">
    <span className="rm-label">{label}</span>
    <NeonHeading as="h3">{title}</NeonHeading>
    <p className="max-w-md text-[11px] leading-[1.8] text-[#8e7e86]">{description}</p>
    {action}
  </div>
);
