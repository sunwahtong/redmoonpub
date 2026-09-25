import React from 'react';
import {tierMeta, type Tier} from '../../lib/houseCard';

const TIERS = new Set(['silver', 'gold', 'black', 'royal']);

/** The small crest a member's name carries around the site: glyph and tier in the tier's metal. */
export const TierChip: React.FC<{tier: string | null | undefined; compact?: boolean; className?: string}> = ({tier, compact = false, className = ''}) => {
  if (!tier || !TIERS.has(tier)) return null;
  const meta = tierMeta(tier as Tier);
  return (
    <span className={`rm-tier-chip ${className}`} data-tier={tier} style={{'--chip': meta.ink} as React.CSSProperties} title={`A House tagja · ${meta.name}`}>
      <span aria-hidden="true">{meta.glyph}</span>
      {!compact && <i>{meta.name}</i>}
    </span>
  );
};
