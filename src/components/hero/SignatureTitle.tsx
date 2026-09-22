import React, {useEffect, useRef, useState} from 'react';

const MOON_LETTERS = ['M', 'O', 'O', 'N'];

/**
 * The Red Moon wordmark — v51's "bespoke luxury-neon sign rather than a normal
 * headline". "RED" is a polished metal gradient; "MOON" is four hollow neon
 * letters, each individually offset, weighted and chromatically ghosted.
 *
 * On a fine pointer the letters drift toward the cursor (parallax depth), and
 * hover/focus fires the neon strike.
 */
export const SignatureTitle: React.FC = () => {
  const ref = useRef<HTMLHeadingElement>(null);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    const title = ref.current;
    if (!title) return;
    if (!window.matchMedia('(pointer:fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const letters = [...title.querySelectorAll<HTMLElement>('.rm-signature-moon i')];
    let frame = 0;
    let clientX = 0;
    let clientY = 0;

    const apply = () => {
      frame = 0;
      const rect = title.getBoundingClientRect();
      // Skip the maths entirely when the mark is off screen.
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;

      const px = Math.max(-1, Math.min(1, (clientX - (rect.left + rect.width / 2)) / Math.max(1, rect.width)));
      const py = Math.max(-1, Math.min(1, (clientY - (rect.top + rect.height / 2)) / Math.max(1, rect.height)));

      letters.forEach((letter, index) => {
        // Alternating letters move less, which reads as depth rather than a slide.
        const dx = px * (index % 2 ? 4 : 7);
        const dy = py * (index % 2 ? 2 : 3);
        letter.style.transform = `translate(${dx}px, ${dy}px)`;
      });
    };

    const onMove = (event: PointerEvent) => {
      clientX = event.clientX;
      clientY = event.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const onLeave = () => letters.forEach((letter) => (letter.style.transform = ''));

    window.addEventListener('pointermove', onMove, {passive: true});
    window.addEventListener('pointerleave', onLeave, {passive: true});

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <h1
      ref={ref}
      className={`rm-signature${flashing ? ' is-flashing' : ''}`}
      aria-label="Red Moon — prémium bár, naplemente után"
      tabIndex={-1}
      onPointerEnter={() => setFlashing(true)}
      onPointerLeave={() => setFlashing(false)}
      onFocus={() => setFlashing(true)}
      onBlur={() => setFlashing(false)}
    >
      <span className="rm-signature-red" aria-hidden="true">RED</span>

      <span className="rm-signature-moon" aria-hidden="true">
        {MOON_LETTERS.map((letter, index) => (
          <i key={index} data-letter={letter}>
            {letter}
          </i>
        ))}
      </span>

      <span className="rm-signature-orbit orbit-a" aria-hidden="true"/>
      <span className="rm-signature-orbit orbit-b" aria-hidden="true"/>
      <span className="rm-signature-spark spark-a" aria-hidden="true"/>
      <span className="rm-signature-spark spark-b" aria-hidden="true"/>

      <small className="rm-signature-sub">PRÉMIUM BÁR · NAPLEMENTE UTÁN</small>
    </h1>
  );
};
