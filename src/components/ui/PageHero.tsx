import React from 'react';
import {NeonHeading} from './NeonHeading';

interface Props {
  /** Small kicker above the title, e.g. "RED MOON / 03". */
  kicker: string;
  /** The light first line — the legacy "THE". */
  overline: string;
  /** The emphasised word. */
  title: string;
  lead: string;
  children?: React.ReactNode;
}

/**
 * Interior page hero — legacy `.rm17-page-hero`: a cinematic still, content
 * anchored to the bottom, and an oversized Cinzel lockup where the second line
 * is the emphasised word.
 */
export const PageHero: React.FC<Props> = ({kicker, overline, title, lead, children}) => (
  <section className="rm-page-hero">
    <div>
      <div className="rm-label">{kicker}</div>

      <NeonHeading as="h1" className="my-5">
        {overline}
        <br/>
        <em>{title}</em>
      </NeonHeading>

      <p className="max-w-[560px] text-sm leading-[1.8] text-[#aaa]">{lead}</p>
      {children}
    </div>
  </section>
);
