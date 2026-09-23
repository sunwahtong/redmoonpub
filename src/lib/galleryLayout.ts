/**
 * The gallery wall lays itself out.
 *
 * Every picture gets a shape — a single cell, a wide one, a tall one, or a
 * big square — then the shapes are packed onto a column grid, top to bottom,
 * without leaving holes. The shape comes from the picture's own proportions
 * first and from a rhythm second, so a wall of same-shaped photographs still
 * reads as a composition rather than a list, and any count of pictures ends
 * in a flat bottom edge.
 */

export type TileShape = 'unit' | 'wide' | 'tall' | 'big';

export interface Placement {
  /** Zero-based column and row of the top-left cell. */
  col: number;
  row: number;
  /** Cells spanned. */
  w: number;
  h: number;
}

const SHAPE_SIZE: Record<TileShape, [number, number]> = {unit: [1, 1], wide: [2, 1], tall: [1, 2], big: [2, 2]};

/** The rhythm applied to pictures whose proportions do not decide for them. */
const RHYTHM: TileShape[] = ['big', 'unit', 'unit', 'wide', 'unit', 'tall', 'unit', 'unit', 'wide', 'unit', 'big', 'unit', 'unit'];

/**
 * A shape for each picture. Panoramas go wide, portraits go tall; ordinary
 * photographs (16:9 included — tiles crop, so a square suits them too)
 * follow the rhythm, and the first picture always opens big. Narrow walls
 * get only single cells and tall ones.
 */
export function shapesFor(items: {width: number; height: number}[], cols: number): TileShape[] {
  return items.map((item, index) => {
    const ratio = item.width > 0 && item.height > 0 ? item.width / item.height : 0;
    let shape: TileShape;
    if (index === 0) shape = 'big';
    else if (ratio && ratio <= 0.8) shape = 'tall';
    else if (ratio && ratio >= 2.2) shape = 'wide';
    else shape = RHYTHM[index % RHYTHM.length];
    if (cols < 2 && (shape === 'wide' || shape === 'big')) shape = shape === 'big' ? 'tall' : 'unit';
    if (cols < 3 && shape === 'big' && index > 0) shape = 'wide';
    return shape;
  });
}

/**
 * Packs the shapes onto `cols` columns. A skyline of column heights decides
 * where each piece lands: the lowest, leftmost spot. A two-column piece that
 * would not sit flat there is narrowed to one column, so no cell is ever
 * skipped. At the end the lowest pieces stretch down to a flat bottom edge.
 */
export function layoutGallery(items: {width: number; height: number}[], cols: number): Placement[] {
  const columns = Math.max(1, Math.floor(cols));
  const shapes = shapesFor(items, columns);
  const heights = new Array<number>(columns).fill(0);
  const placements: Placement[] = [];

  for (const shape of shapes) {
    let [w, h] = SHAPE_SIZE[shape];
    w = Math.min(w, columns);
    const floor = Math.min(...heights);
    let col = heights.indexOf(floor);
    // A wide piece needs every column it covers at the same height.
    const flat = (start: number, width: number) => start + width <= columns && heights.slice(start, start + width).every((value) => value === floor);
    if (w > 1 && !flat(col, w)) {
      // Try a spot further right on the same floor before giving up the width.
      const alternative = heights.findIndex((value, index) => value === floor && flat(index, w));
      if (alternative >= 0) col = alternative;
      else w = 1;
    }
    placements.push({col, row: floor, w, h});
    for (let c = col; c < col + w; c += 1) heights[c] = floor + h;
  }

  // The pieces run out before the last rows are full. Every empty cell is
  // taken by a neighbouring piece — the one above stretches down, or the one
  // beside widens — choosing the move that keeps that piece closest to a
  // pleasant proportion. Repeats until the bottom edge is flat.
  const target = Math.max(...heights);
  const covers = (piece: Placement, c: number, r: number) => c >= piece.col && c < piece.col + piece.w && r >= piece.row && r < piece.row + piece.h;
  for (let guard = 0; guard < 4000; guard += 1) {
    const floor = Math.min(...heights);
    if (floor >= target) break;
    const c = heights.indexOf(floor);
    type Move = {piece: Placement; apply: () => void; ratio: number; penalty: number};
    const moves: Move[] = [];
    const above = placements.find((piece) => covers(piece, c, floor - 1));
    if (above && Array.from({length: above.w}, (_, k) => heights[above.col + k]).every((value) => value === floor)) {
      moves.push({piece: above, ratio: above.w / (above.h + 1), penalty: above.h + 1 > 3 ? 2 : 0, apply: () => { above.h += 1; for (let k = 0; k < above.w; k += 1) heights[above.col + k] = floor + 1; }});
    }
    const left = c > 0 ? placements.find((piece) => covers(piece, c - 1, floor)) : undefined;
    if (left && left.row === floor) {
      moves.push({piece: left, ratio: (left.w + 1) / left.h, penalty: left.w + 1 > 4 ? 2 : 0, apply: () => { left.w += 1; heights[c] = left.row + left.h; }});
    }
    const right = c < columns - 1 ? placements.find((piece) => covers(piece, c + 1, floor)) : undefined;
    if (right && right.row === floor) {
      moves.push({piece: right, ratio: (right.w + 1) / right.h, penalty: right.w + 1 > 4 ? 2 : 0, apply: () => { right.col -= 1; right.w += 1; heights[c] = right.row + right.h; }});
    }
    if (!moves.length) break;
    // Closest to a gentle landscape wins; very tall or very wide results are a last resort.
    const score = (move: Move) => Math.abs(Math.log(move.ratio / 1.3)) + move.penalty;
    moves.sort((a, b) => score(a) - score(b));
    moves[0].apply();
  }

  return placements;
}

/** How many columns fit a wall of this width. */
export function columnsFor(width: number, minColumn = 240, gap = 12): number {
  if (!width) return 4;
  return Math.max(1, Math.min(6, Math.floor((width + gap) / (minColumn + gap))));
}
