import React, {useEffect, useRef, useState} from 'react';

interface Props {
  text: string;
  /** Delay between letters, in ms. */
  stagger?: number;
  /** Delay before the first letter, in ms. */
  delay?: number;
  className?: string;
}

/**
 * Display type that rises letter by letter when it scrolls into view.
 *
 * Split by word first, then by character inside each word. That order matters:
 * a flat list of inline-block letters lets the browser break a line between any
 * two of them, so on a narrow screen "DOLGOZZ" wrapped as "DOLGOZ / Z" and a
 * trailing full stop ended up alone on its own line. Words are `nowrap`, and
 * the spaces between them are ordinary breakable spaces, so the heading wraps
 * where a heading should.
 *
 * The whole string stays readable to assistive technology: the split spans are
 * hidden with `aria-hidden` and the real text is carried by a visually hidden
 * copy. Otherwise a screen reader announces the heading one character at a
 * time, which is how this effect usually ruins a page.
 */
export const SplitReveal: React.FC<Props> = ({text, stagger = 34, delay = 0, className = ''}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      {threshold: 0.2}
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const words = text.split(' ');
  // Runs across the whole string, so the stagger does not restart per word.
  let characterIndex = 0;

  return (
    <span ref={ref} className={`rm-split ${shown ? 'is-in' : ''} ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, wordIndex) => (
          <React.Fragment key={`${word}-${wordIndex}`}>
            <span className="whitespace-nowrap">
              {[...word].map((character, index) => {
                const step = characterIndex++;
                return (
                  <span
                    key={`${character}-${index}`}
                    className="rm-split-char"
                    style={{transitionDelay: `${delay + step * stagger}ms`}}
                  >
                    {character}
                  </span>
                );
              })}
            </span>
            {/* A real space between words: the one place a line may break. */}
            {wordIndex < words.length - 1 ? ' ' : null}
          </React.Fragment>
        ))}
      </span>
    </span>
  );
};
