import React from 'react';
import {Link} from 'react-router-dom';

type Variant = 'outline' | 'red';

interface CommonProps {
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}

const classes = (variant: Variant, className: string) =>
  `rm-btn${variant === 'red' ? ' is-red' : ''} ${className}`.trim();

/**
 * The Red Moon button: square corners, 0.2em tracking, lifts 3px on hover.
 * Legacy `.rm17-btn` / `.rm17-btn.red`. Deliberately not a pill — the rounded
 * treatment the rewrite used reads as a generic SaaS site, not this bar.
 */
export const Btn: React.FC<CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  variant = 'outline',
  className = '',
  children,
  ...rest
}) => (
  <button className={classes(variant, className)} {...rest}>
    {children}
  </button>
);

export const BtnLink: React.FC<CommonProps & {to: string}> = ({
  variant = 'outline',
  className = '',
  to,
  children
}) => (
  <Link to={to} className={classes(variant, className)}>
    {children}
  </Link>
);

export const BtnAnchor: React.FC<CommonProps & React.AnchorHTMLAttributes<HTMLAnchorElement>> = ({
  variant = 'outline',
  className = '',
  children,
  ...rest
}) => (
  <a className={classes(variant, className)} {...rest}>
    {children}
  </a>
);
