import React, {useEffect, useRef} from 'react';

interface Props {
  /** Puffs on screen at once, at 1440px wide. Scaled down on narrow screens. */
  density?: number;
  className?: string;
}

interface Puff {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  driftX: number;
  wobble: number;
  wobbleSpeed: number;
  rise: number;
  life: number;
  maxLife: number;
  peak: number;
}

/**
 * A haze of pale smoke drifting slowly upward behind the hero.
 *
 * Canvas rather than a stack of blurred, animated divs: a handful of large
 * soft-edged circles is cheap to redraw every frame, where the same look
 * built from filtered DOM elements would force the browser to repaint a
 * blurred layer the size of the hero on every tick. `screen` blending lets
 * the puffs lighten the picture underneath instead of sitting on top of it
 * like a sticker, which is what keeps the effect from reading as fog on a
 * lens rather than smoke in the room.
 *
 * Purely decorative: renders nothing when the visitor has asked for reduced
 * motion, and pauses while the tab is hidden.
 */
export const Smoke: React.FC<Props> = ({density = 5, className = ''}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let puffs: Puff[] = [];
    let frame = 0;
    let running = true;

    const spawn = (seeded: boolean): Puff => {
      const maxLife = 1400 + Math.random() * 1600;
      const maxRadius = width * (0.32 + Math.random() * 0.3);
      return {
        x: Math.random() * width,
        // Seeded puffs start already drifting through the frame; spawned ones
        // rise in from below so nothing pops into view mid-air.
        y: seeded ? height * (0.25 + Math.random() * 0.85) : height + maxRadius * 0.3,
        radius: maxRadius,
        maxRadius,
        driftX: (Math.random() - 0.5) * 0.12,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.0025 + Math.random() * 0.003,
        rise: 0.05 + Math.random() * 0.09,
        life: seeded ? Math.random() * maxLife : 0,
        maxLife,
        peak: 0.05 + Math.random() * 0.05
      };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const count = Math.max(2, Math.round(density * Math.min(1, width / 1440)));
      puffs = Array.from({length: count}, () => spawn(true));
    };

    const draw = () => {
      if (!running) return;
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'screen';

      for (let i = 0; i < puffs.length; i += 1) {
        const puff = puffs[i];
        puff.life += 1;
        puff.wobble += puff.wobbleSpeed;
        puff.y -= puff.rise;
        puff.x += puff.driftX + Math.sin(puff.wobble) * 0.18;

        if (puff.life > puff.maxLife || puff.y < -puff.maxRadius) {
          puffs[i] = spawn(false);
          continue;
        }

        // Grows in as it rises, fades in over the first quarter of its life
        // and out over the last third — never a hard edge in time either.
        const progress = puff.life / puff.maxLife;
        const fade = progress < 0.25 ? progress / 0.25 : progress > 0.66 ? (1 - progress) / 0.34 : 1;
        const alpha = Math.max(0, Math.min(1, fade)) * puff.peak;
        puff.radius = puff.maxRadius * (0.7 + 0.3 * Math.min(1, progress / 0.25));

        const gradient = context.createRadialGradient(puff.x, puff.y, 0, puff.x, puff.y, puff.radius);
        gradient.addColorStop(0, `rgba(255, 248, 244, ${alpha})`);
        gradient.addColorStop(0.45, `rgba(255, 238, 232, ${alpha * 0.55})`);
        gradient.addColorStop(1, 'rgba(255, 235, 230, 0)');

        context.fillStyle = gradient;
        context.beginPath();
        context.arc(puff.x, puff.y, puff.radius, 0, Math.PI * 2);
        context.fill();
      }

      frame = window.requestAnimationFrame(draw);
    };

    resize();
    frame = window.requestAnimationFrame(draw);

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

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
