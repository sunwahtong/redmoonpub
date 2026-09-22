import React, {useEffect, useRef} from 'react';

interface Props {
  /** Particle count at 1440px wide. Scaled down on narrow screens. */
  density?: number;
  className?: string;
}

interface Ember {
  x: number;
  y: number;
  radius: number;
  drift: number;
  rise: number;
  life: number;
  maxLife: number;
  hot: boolean;
}

/**
 * Embers drifting upward behind a section.
 *
 * Canvas rather than DOM nodes: a hundred absolutely positioned elements each
 * running their own CSS animation is a hundred composited layers, and on a
 * mid-range phone that is what turns a smooth page into a stuttering one. One
 * canvas is one layer.
 *
 * Purely decorative, so it renders nothing at all when the visitor has asked
 * for reduced motion.
 */
export const Embers: React.FC<Props> = ({density = 46, className = ''}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    // Cap the backing store at 2x. Beyond that the extra pixels cost real
    // frame time and nobody can see the difference on drifting sparks.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let embers: Ember[] = [];
    let frame = 0;
    let running = true;

    const spawn = (seeded: boolean): Ember => {
      const maxLife = 260 + Math.random() * 420;
      return {
        x: Math.random() * width,
        // Seeded particles start scattered so the section is already alive on
        // the first frame instead of filling up from the bottom.
        y: seeded ? Math.random() * height : height + Math.random() * 40,
        radius: 0.6 + Math.random() * 1.7,
        drift: (Math.random() - 0.5) * 0.22,
        rise: 0.16 + Math.random() * 0.42,
        life: seeded ? Math.random() * maxLife : 0,
        maxLife,
        hot: Math.random() < 0.3
      };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const count = Math.round(density * Math.min(1, width / 1440) + 10);
      embers = Array.from({length: count}, () => spawn(true));
    };

    const draw = () => {
      if (!running) return;
      context.clearRect(0, 0, width, height);

      for (let i = 0; i < embers.length; i += 1) {
        const ember = embers[i];
        ember.life += 1;
        ember.y -= ember.rise;
        ember.x += ember.drift;

        if (ember.life > ember.maxLife || ember.y < -10) {
          embers[i] = spawn(false);
          continue;
        }

        // Fade in over the first fifth of the life, out over the last third.
        const progress = ember.life / ember.maxLife;
        const fade = progress < 0.2 ? progress / 0.2 : progress > 0.66 ? (1 - progress) / 0.34 : 1;
        const alpha = Math.max(0, Math.min(1, fade)) * (ember.hot ? 0.72 : 0.36);

        context.beginPath();
        context.arc(ember.x, ember.y, ember.radius, 0, Math.PI * 2);
        context.fillStyle = ember.hot
          ? `rgba(255, 92, 120, ${alpha})`
          : `rgba(227, 40, 78, ${alpha})`;
        context.shadowBlur = ember.hot ? 12 : 6;
        context.shadowColor = 'rgba(255, 43, 79, 0.65)';
        context.fill();
      }

      context.shadowBlur = 0;
      frame = window.requestAnimationFrame(draw);
    };

    resize();
    frame = window.requestAnimationFrame(draw);

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // A hidden tab should not be burning frames on sparks nobody is watching.
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(frame);
      } else if (!running) {
        running = true;
        frame = window.requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
};
