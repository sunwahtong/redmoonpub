import React from 'react';
import {Pin} from 'lucide-react';
import {PageHero} from '../components/ui/PageHero';
import {Reveal} from '../components/ui/Reveal';
import {Skeleton} from '../components/ui/Skeleton';
import {BtnLink} from '../components/ui/Btn';
import {useLiveData} from '../hooks/useLiveData';
import {assetUrl, formatDate} from '../lib/api';
import type {Post} from '../types';

/** Paragraphs from the plain text the owner typed. */
export const paragraphsOf = (body: string): string[] =>
  body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * The house's news: what happened, what is coming, what changed. The owner
 * writes them in the console; pinned ones stay on top.
 */
export const NewsPage: React.FC = () => {
  const {data, loading} = useLiveData<{posts: Post[]}>('/api/public/posts', {intervalMs: 120000, topics: ['content']});
  const posts = data?.posts || [];

  return (
    <main>
      <PageHero kicker="RED MOON / 08" overline="A HÁZ" title="HÍREI" lead="Ami történt a Red Moonban, és ami készül: új italok, esték, változások a csapatban — első kézből.">
        <div className="mt-8 flex flex-wrap gap-2.5">
          <BtnLink to="/events" variant="red">
            RENDEZVÉNYEK ↗
          </BtnLink>
          <BtnLink to="/club">RED MOON CLUB ↗</BtnLink>
        </div>
      </PageHero>

      <section className="rm-section">
        {loading && (
          <div className="rm-news-grid">
            <Skeleton className="h-[320px]" count={4}/>
          </div>
        )}
        {!loading && !posts.length && (
          <div className="rm-card p-10 text-center">
            <span className="rm-label">HÍREK</span>
            <p className="mt-4 text-[12px] leading-[1.8] text-[#9e9795]">Még nincs mit mesélni. Amint történik valami, itt olvasod először.</p>
          </div>
        )}
        <div className="rm-news-grid">
          {posts.map((post, index) => (
            <Reveal key={post.id} delay={Math.min(index, 6) * 60} className={`rm-news-card${post.pinned ? ' is-pinned' : ''}`}>
              {post.imageUrl && <img src={assetUrl(post.imageUrl)} alt="" loading="lazy" decoding="async"/>}
              <div className="rm-news-body">
                <div className="rm-news-meta">
                  {post.pinned && (
                    <span className="is-pin">
                      <Pin size={9} className="mr-1 inline-block align-[-1px]"/>KITŰZVE
                    </span>
                  )}
                  <span>{post.publishedAt ? formatDate(post.publishedAt).toUpperCase() : ''}</span>
                  {post.createdByName && <span>· {post.createdByName.toUpperCase()}</span>}
                </div>
                <h2 className="mt-3 font-heading text-[26px] leading-tight text-white">{post.title}</h2>
                <div className="rm-news-text">
                  {paragraphsOf(post.body).map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </main>
  );
};
