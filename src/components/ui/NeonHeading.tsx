import React, {useState} from 'react';

type Level = 'h1' | 'h2' | 'h3';

interface Props {
  as?: Level;
  /** Display scale. Defaults to the one that matches the heading level. */
  size?: 1 | 2 | 3;
  className?: string;
  children: React.ReactNode;
}

const DEFAULT_SIZE: Record<Level, 1 | 2 | 3> = {h1: 1, h2: 2, h3: 3};

/**
 * V52's reactive heading: a permanent soft neon bloom that brightens, lifts and
 * lights its underline on hover or keyboard focus. Legacy attached this to a
 * hand-maintained list of ~20 selectors in v52-heading-system.js; here it is
 * just the component you reach for.
 *
 * Wrap emphasised words in <em> — they stay bright white instead of dropping
 * into the background.
 */
export const NeonHeading: React.FC<Props> = ({as = 'h2', size, className = '', children}) => {
  const [active, setActive] = useState(false);
  const Tag = as;
  const scale = size ?? DEFAULT_SIZE[as];

  return (
    <Tag
      className={`rm-heading rm-display-${scale}${active ? ' is-active' : ''} ${className}`}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
    >
      {children}
    </Tag>
  );
};
