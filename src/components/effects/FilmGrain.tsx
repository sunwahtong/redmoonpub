import React, {useMemo} from 'react';

/**
 * Film grain over the whole page.
 *
 * A flat dark background renders as a large area of identical pixels, which
 * reads as "unfinished" rather than "dark". A little animated noise on top
 * makes the same background read as photographed. It is a fixed overlay with
 * `pointer-events: none`, so it never intercepts a click.
 *
 * The noise is generated once into a data URL rather than shipped as a PNG:
 * it is a few hundred bytes of code against a file request, and it cannot go
 * missing from a deployment.
 */
function makeNoiseDataUrl(size = 128): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) return '';

  const image = context.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.random() * 255;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);

  return canvas.toDataURL('image/png');
}

export const FilmGrain: React.FC = () => {
  const noise = useMemo(() => {
    // Guard for any environment without a DOM; the overlay is decoration, so
    // rendering nothing is a perfectly good outcome.
    if (typeof document === 'undefined') return '';
    try {
      return makeNoiseDataUrl();
    } catch {
      return '';
    }
  }, []);

  if (!noise) return null;

  return (
    <div
      className="rm-grain"
      aria-hidden="true"
      style={{['--rm-grain-image' as string]: `url(${noise})`}}
    />
  );
};
