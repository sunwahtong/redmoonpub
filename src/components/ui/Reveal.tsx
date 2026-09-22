import React, {useEffect, useRef, useState} from 'react';

/**
 * Extends the div attributes so callers can pass `data-*` through — the events
 * timeline styles its markers off `data-phase` on the revealed element.
 */
interface Props extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Stagger in ms, applied as a transition delay. */
  delay?: number;
  className?: string;
}

/**
 * Fades content in the first time it scrolls into view. Replaces the legacy
 * `cinematic-reveal` class, which relied on a scroll listener firing on every
 * frame. One IntersectionObserver per element, disconnected after it fires.
 */
export const Reveal: React.FC<Props> = ({children, delay = 0, className = '', style, ...rest}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {rootMargin: '0px 0px -60px 0px', threshold: 0.05}
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'} ${className}`}
      style={{transitionDelay: `${delay}ms`, ...style}}
      {...rest}
    >
      {children}
    </div>
  );
};
