/**
 * Point-set registration (translation only).
 *
 * Two components never share a coordinate frame, so before comparing mounting
 * points or cutouts we must find where one sits relative to the other.
 *
 * Algorithm: every pair (moving[i], fixed[j]) proposes a translation
 * t = fixed[j] − moving[i]. For each proposal we count how many moving points
 * have a fixed point within `tolerance` after the shift. The proposal with the
 * most matches wins; ties are broken by the smallest total residual.
 * Complexity O(N·M·N·M) — fine for the ≤ 150 points of a keyboard.
 *
 * Rotation is intentionally not searched: physical compatibility between a
 * rotated and an unrotated part must be declared explicitly, never guessed.
 */
import type { Placement, Point2D } from '../types/keyboard';
import { distance } from './shape';

export interface RegistrationResult {
  dx: number;
  dy: number;
  matched: number;
  total: number;
  residual: number;
  /** For each moving point, the index of its matched fixed point (or -1). */
  pairs: number[];
}

/** Uniform grid over the fixed points so neighbour queries stay O(1). */
class Grid {
  private cells = new Map<string, number[]>();
  constructor(private pts: readonly Point2D[], private cell: number) {
    pts.forEach((p, j) => {
      const k = this.key(Math.floor(p.x / cell), Math.floor(p.y / cell));
      const list = this.cells.get(k);
      if (list) list.push(j);
      else this.cells.set(k, [j]);
    });
  }
  private key(cx: number, cy: number) {
    return cx + ',' + cy;
  }
  /** Indices of fixed points possibly within one cell of (x, y). */
  near(x: number, y: number): number[] {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const out: number[] = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const l = this.cells.get(this.key(cx + i, cy + j));
        if (l) out.push(...l);
      }
    }
    return out;
  }
  at(j: number): Point2D {
    return this.pts[j] as Point2D;
  }
}

function evaluate(moving: readonly Point2D[], grid: Grid, dx: number, dy: number, tol: number) {
  const used = new Set<number>();
  const pairs: number[] = new Array(moving.length).fill(-1);
  let matched = 0;
  let residualSum = 0;
  let residualMax = 0;
  moving.forEach((m, i) => {
    let bestJ = -1;
    let bestD = Infinity;
    const x = m.x + dx;
    const y = m.y + dy;
    for (const j of grid.near(x, y)) {
      if (used.has(j)) continue;
      const d = distance({ x, y }, grid.at(j));
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestD <= tol) {
      used.add(bestJ);
      pairs[i] = bestJ;
      matched++;
      residualSum += bestD;
      if (bestD > residualMax) residualMax = bestD;
    }
  });
  return { matched, residualSum, residualMax, pairs };
}

const gridFor = (fixed: readonly Point2D[], tol: number) => new Grid(fixed, Math.max(tol, 1e-6) * 2);

/** Number of moving points used as anchors when proposing translations. */
const ANCHORS = 3;

export function registerPoints(
  moving: readonly Point2D[],
  fixed: readonly Point2D[],
  tolerance: number,
): RegistrationResult | null {
  if (moving.length === 0 || fixed.length === 0) return null;
  const grid = gridFor(fixed, tolerance);
  let best: RegistrationResult | null = null;
  let bestSum = Infinity;
  // A full match necessarily maps the first moving points onto fixed points, so anchoring on a few
  // of them is enough to find it; partial matches are best-effort.
  for (const m of moving.slice(0, ANCHORS)) {
    for (const f of fixed) {
      const dx = f.x - m.x;
      const dy = f.y - m.y;
      const e = evaluate(moving, grid, dx, dy, tolerance);
      if (e.matched > (best?.matched ?? -1) || (e.matched === best?.matched && e.residualSum < bestSum)) {
        best = { dx, dy, matched: e.matched, total: moving.length, residual: e.residualMax, pairs: e.pairs };
        bestSum = e.residualSum;
      }
    }
  }
  return best;
}

export function toPlacement(r: RegistrationResult, method: Placement['method']): Placement {
  return { dx: r.dx, dy: r.dy, method, matched: r.matched, total: r.total, residual: r.residual };
}

/** Match the moving points to the fixed ones under a given translation (no search). */
export function matchAt(
  moving: readonly Point2D[],
  fixed: readonly Point2D[],
  dx: number,
  dy: number,
  tolerance: number,
): { matched: number; total: number; residual: number; pairs: number[] } {
  const e = evaluate(moving, gridFor(fixed, tolerance), dx, dy, tolerance);
  return { matched: e.matched, total: moving.length, residual: e.residualMax, pairs: e.pairs };
}
