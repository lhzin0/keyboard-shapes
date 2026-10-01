/**
 * Front and side silhouettes of a comparable item, in millimetres: desk = 0, up = negative y.
 * Front: x across the width. Side: x along the desk from the front edge.
 *
 * Real shapes only where heights are recorded (front/rear height of the case). When only the overall height is
 * known the silhouette is a bounding box (`box: true`); with no height at all there is none — nothing is invented.
 */
import { simplifyPolygon } from '../geometry/shape';
import type { Point2D } from '../types/keyboard';
import { buildProfileModel } from '../viewer2d/profileModel';
import type { CompareItem } from '../stores';
import { selectionOfItem } from './selection';
import type { ShapeEntry } from './shapes';

export interface Silhouette {
  points: Point2D[];
  box: boolean;
}

const STEP = 0.5;
/** Gaps narrower than this (between rows of keycaps) are bridged: a row of keys reads as one block. */
const BRIDGE = 2.5;

/** Vertical extent of a convex polygon at x (as heights), or null outside it. */
function spanAt(poly: readonly Point2D[], x: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (Math.min(a.x, b.x) <= x && x <= Math.max(a.x, b.x)) {
      const t = a.x === b.x ? 0 : (x - a.x) / (b.x - a.x);
      for (const h of a.x === b.x ? [-a.y, -b.y] : [-(a.y + (b.y - a.y) * t)]) {
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
  }
  return lo === Infinity ? null : [lo, hi];
}

/** Max filter then min filter: bridges dips narrower than the window. */
function close(values: number[], radius: number): number[] {
  const win = (src: number[], pick: (a: number, b: number) => number) =>
    src.map((_, i) => src.slice(Math.max(0, i - radius), i + radius + 1).reduce((acc, v) => pick(acc, v)));
  return win(win(values, Math.max), Math.min);
}

/** Outer outline of every part of the assembly seen from the side or the front. */
function outline(item: CompareItem, view: 'side' | 'front'): Point2D[] | null {
  const sel = selectionOfItem(item);
  if (!sel) return null;
  const polys = buildProfileModel(sel, view).polys.filter((p) => p.kind !== 'cavity' && p.points.length >= 3);
  if (!polys.length) return null;
  const xs = polys.flatMap((p) => p.points.map((q) => q.x));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const at: number[] = [];
  const top: number[] = [];
  const bottom: number[] = [];
  for (let x = minX; x < maxX + STEP; x += STEP) {
    const spans = polys.map((p) => spanAt(p.points, Math.min(x, maxX))).filter((s): s is [number, number] => !!s);
    if (!spans.length) continue;
    at.push(Math.min(x, maxX));
    bottom.push(Math.min(...spans.map((s) => s[0])));
    top.push(Math.max(...spans.map((s) => s[1])));
  }
  if (at.length < 2) return null;
  const bridged = close(top, Math.ceil(BRIDGE / STEP / 2));
  const upper = at.map((x, i) => ({ x, y: -Math.max(bridged[i]!, top[i]!) }));
  const lower = at.map((x, i) => ({ x, y: -bottom[i]! })).reverse();
  return simplifyPolygon([...upper, ...lower], 0.12);
}

const rect = (w: number, h: number): Point2D[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: -h },
  { x: 0, y: -h },
];

export function silhouettes(item: CompareItem, entry: ShapeEntry): { front: Silhouette | null; side: Silhouette | null } {
  const c = selectionOfItem(item)?.case;
  if (c?.frontHeight !== undefined && c.rearHeight !== undefined) {
    const front = outline(item, 'front');
    const side = outline(item, 'side');
    return { front: front && { points: front, box: false }, side: side && { points: side, box: false } };
  }
  const { width, depth, height } = entry.dimensions;
  if (!height) return { front: null, side: null };
  return { front: { points: rect(width, height), box: true }, side: { points: rect(depth, height), box: true } };
}
