import type { Point2D } from '../../types/keyboard';
import type { Mask } from './mask';

/** Clockwise (on screen) 8-neighbourhood starting at north-west. */
const N8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

/**
 * Moore-neighbour boundary tracing of a single connected, hole-free object.
 * Returns the outline as pixel-centre coordinates, clockwise on screen.
 */
export function traceContour(mask: Mask): Point2D[] {
  const { width: w, height: h, data } = mask;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;

  let sx = -1;
  let sy = -1;
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y)) {
        sx = x;
        sy = y;
        break outer;
      }
    }
  }
  if (sx < 0) return [];

  const pts: Point2D[] = [{ x: sx, y: sy }];
  let cx = sx;
  let cy = sy;
  let d = 7; // the backtrack pixel is west of the start (always background: scanning found the first object pixel)
  const limit = 4 * (w + h) * 8 + w * h;
  for (let step = 0; step < limit; step++) {
    let moved = false;
    for (let i = 1; i <= 8; i++) {
      const k = (d + i) % 8;
      const nx = cx + (N8[k] as readonly [number, number])[0];
      const ny = cy + (N8[k] as readonly [number, number])[1];
      if (at(nx, ny)) {
        const prev = (k + 7) % 8;
        const bx = cx + (N8[prev] as readonly [number, number])[0];
        const by = cy + (N8[prev] as readonly [number, number])[1];
        cx = nx;
        cy = ny;
        const vx = bx - cx;
        const vy = by - cy;
        d = N8.findIndex(([ax, ay]) => ax === vx && ay === vy);
        if (d < 0) d = 7;
        moved = true;
        break;
      }
    }
    if (!moved) break; // isolated pixel
    if (cx === sx && cy === sy) break;
    pts.push({ x: cx, y: cy });
  }
  return pts;
}

/* ---------------------------------------------------------- perspective */

export type Quad = [Point2D, Point2D, Point2D, Point2D]; // TL, TR, BR, BL

/** Solve the 3×3 homography mapping `src[i]` → `dst[i]` (4 point pairs). */
export function homography(src: Quad, dst: Quad): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i] as Point2D;
    const { x: u, y: v } = dst[i] as Point2D;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gauss–Jordan with partial pivoting on the 8×9 augmented matrix
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs((A[r] as number[])[c] as number) > Math.abs((A[p] as number[])[c] as number)) p = r;
    [A[c], A[p]] = [A[p] as number[], A[c] as number[]];
    const piv = (A[c] as number[])[c] as number;
    if (Math.abs(piv) < 1e-12) throw new Error('Degenerate quad: cannot compute perspective correction.');
    for (let k = c; k < 9; k++) (A[c] as number[])[k] = ((A[c] as number[])[k] as number) / piv;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = (A[r] as number[])[c] as number;
      for (let k = c; k < 9; k++) (A[r] as number[])[k] = ((A[r] as number[])[k] as number) - f * ((A[c] as number[])[k] as number);
    }
  }
  return [...A.map((row) => row[8] as number), 1];
}

export function applyHomography(H: number[], p: Point2D): Point2D {
  const [a, b, c, d, e, f, g, h, i] = H as [number, number, number, number, number, number, number, number, number];
  const w = g * p.x + h * p.y + i;
  return { x: (a * p.x + b * p.y + c) / w, y: (d * p.x + e * p.y + f) / w };
}

/** Classic corner estimate: extreme points along the two diagonals. */
export function quadFromContour(pts: Point2D[]): Quad {
  const by = (f: (p: Point2D) => number, sign: 1 | -1) => pts.reduce((best, p) => (sign * f(p) < sign * f(best) ? p : best), pts[0] as Point2D);
  const tl = by((p) => p.x + p.y, 1);
  const br = by((p) => p.x + p.y, -1);
  const tr = by((p) => p.x - p.y, -1);
  const bl = by((p) => p.x - p.y, 1);
  return [tl, tr, br, bl];
}

const dist = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);

/** Rectify contour points so the quad becomes an axis-aligned rectangle (px units preserved). */
export function rectifyPoints(pts: Point2D[], quad: Quad): Point2D[] {
  const w = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
  const h = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  const dst: Quad = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const H = homography(quad, dst);
  return pts.map((p) => applyHomography(H, p));
}
