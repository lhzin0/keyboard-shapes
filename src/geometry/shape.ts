/**
 * 2D polygon toolkit. All values are millimetres.
 *
 * Everything here is pure and allocation-light so it can run in workers,
 * Node scripts (import pipeline, validation) and the browser alike.
 */
import type { Point2D, Shape } from '../types/keyboard';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const EPS = 1e-9;

export function boundsOf(points: readonly Point2D[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Build a Shape from points; width/depth are the bounding-box extents. */
export function makeShape(points: Point2D[], closed = true): Shape {
  const b = boundsOf(points);
  return { points, width: round(b.maxX - b.minX), depth: round(b.maxY - b.minY), closed };
}

export function round(v: number, digits = 3): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

export function roundPoint(p: Point2D, digits = 3): Point2D {
  return { x: round(p.x, digits), y: round(p.y, digits) };
}

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* --------------------------------------------------------- transformations */

export function translatePoints(points: readonly Point2D[], dx: number, dy: number): Point2D[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  return { ...shape, points: translatePoints(shape.points, dx, dy) };
}

/** Translate so that the bounding-box minimum is at (0,0). */
export function normalizeShape(shape: Shape): Shape {
  const b = boundsOf(shape.points);
  return makeShape(translatePoints(shape.points, -b.minX, -b.minY), shape.closed);
}

export function scaleShape(shape: Shape, sx: number, sy = sx, origin: Point2D = { x: 0, y: 0 }): Shape {
  const points = shape.points.map((p) => ({
    x: origin.x + (p.x - origin.x) * sx,
    y: origin.y + (p.y - origin.y) * sy,
  }));
  return makeShape(points, shape.closed);
}

export function rotatePoints(points: readonly Point2D[], degrees: number, origin: Point2D): Point2D[] {
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return points.map((p) => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c };
  });
}

export function boundsCenter(b: Bounds): Point2D {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Rotate about `origin` (default: bounding-box centre). */
export function rotateShape(shape: Shape, degrees: number, origin?: Point2D): Shape {
  const o = origin ?? boundsCenter(boundsOf(shape.points));
  return makeShape(rotatePoints(shape.points, degrees, o), shape.closed);
}

/** Mirror across the vertical ('x' flips left/right) or horizontal axis through the bbox centre. */
export function mirrorShape(shape: Shape, axis: 'x' | 'y'): Shape {
  const c = boundsCenter(boundsOf(shape.points));
  const points = shape.points
    .map((p) => (axis === 'x' ? { x: 2 * c.x - p.x, y: p.y } : { x: p.x, y: 2 * c.y - p.y }))
    // mirroring flips winding; restore it so area stays positive
    .reverse();
  return makeShape(points, shape.closed);
}

/* ------------------------------------------------------------------ measure */

/** Signed area; positive when the polygon is counter-clockwise in a y-up frame. */
export function signedArea(points: readonly Point2D[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point2D;
    const q = points[(i + 1) % points.length] as Point2D;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function area(points: readonly Point2D[]): number {
  return Math.abs(signedArea(points));
}

export function perimeter(points: readonly Point2D[], closed = true): number {
  let sum = 0;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    sum += distance(points[i] as Point2D, points[(i + 1) % points.length] as Point2D);
  }
  return sum;
}

export function centroid(points: readonly Point2D[]): Point2D {
  const a = signedArea(points);
  if (Math.abs(a) < EPS) return boundsCenter(boundsOf(points));
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point2D;
    const q = points[(i + 1) % points.length] as Point2D;
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function distToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Even-odd rule point-in-polygon. */
export function pointInPolygon(p: Point2D, poly: readonly Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point2D;
    const b = poly[j] as Point2D;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from `p` to the polygon boundary (always ≥ 0). */
export function distToBoundary(p: Point2D, poly: readonly Point2D[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distToSegment(p, poly[i] as Point2D, poly[(i + 1) % poly.length] as Point2D);
    if (d < best) best = d;
  }
  return best;
}

/** Positive inside, negative outside. */
export function signedDistance(p: Point2D, poly: readonly Point2D[]): number {
  const d = distToBoundary(p, poly);
  return pointInPolygon(p, poly) ? d : -d;
}

export interface ContainmentResult {
  /** True when `inner` lies completely inside `outer`. */
  contained: boolean;
  /**
   * Signed clearance in mm: the smallest distance between the two boundaries
   * when contained (≥ 0), or minus the deepest penetration when not.
   */
  clearance: number;
  /** Location (in the shared frame) of the smallest clearance / deepest penetration. */
  at: Point2D;
}

/**
 * Smallest signed gap between `inner` and `outer`.
 *
 * The minimum distance between two polygon boundaries is always reached at a
 * vertex of one of them, so evaluating both vertex sets against the opposite
 * boundary is exact (for simple polygons). Outer vertices poking inside `inner`
 * (concave cavities) yield negative values.
 */
export function containment(inner: readonly Point2D[], outer: readonly Point2D[]): ContainmentResult {
  let best = Infinity;
  let at: Point2D = inner[0] ?? { x: 0, y: 0 };
  for (const v of inner) {
    const sd = signedDistance(v, outer);
    if (sd < best) {
      best = sd;
      at = v;
    }
  }
  for (const w of outer) {
    const sd = -signedDistance(w, inner);
    if (sd < best) {
      best = sd;
      at = w;
    }
  }
  if (!Number.isFinite(best)) best = 0;
  return { contained: best >= 0, clearance: best, at };
}

/* --------------------------------------------------------------- simplify */

/** Ramer–Douglas–Peucker for open polylines. */
export function simplifyPolyline(points: readonly Point2D[], tolerance: number): Point2D[] {
  if (points.length < 3) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(points[i] as Point2D, points[s] as Point2D, points[e] as Point2D);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx >= 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify a closed polygon by splitting it at the two farthest-apart vertices. */
export function simplifyPolygon(points: readonly Point2D[], tolerance: number): Point2D[] {
  if (points.length < 4) return points.slice();
  let ia = 0;
  let ib = 0;
  let best = -1;
  // approximate the diameter with the extreme points on x
  for (let i = 0; i < points.length; i++) {
    if ((points[i] as Point2D).x < (points[ia] as Point2D).x) ia = i;
    if ((points[i] as Point2D).x > (points[ib] as Point2D).x) ib = i;
  }
  best = distance(points[ia] as Point2D, points[ib] as Point2D);
  if (best < EPS) return points.slice();
  const lo = Math.min(ia, ib);
  const hi = Math.max(ia, ib);
  const first = points.slice(lo, hi + 1);
  const second = [...points.slice(hi), ...points.slice(0, lo + 1)];
  const a = simplifyPolyline(first, tolerance);
  const b = simplifyPolyline(second, tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

export function simplifyShape(shape: Shape, tolerance: number): Shape {
  const pts = shape.closed ? simplifyPolygon(shape.points, tolerance) : simplifyPolyline(shape.points, tolerance);
  return makeShape(pts, shape.closed);
}

/* ------------------------------------------------------------------ offset */

/**
 * Mitered polygon offset. Positive `distance` grows the shape, negative shrinks it.
 * Exact for convex polygons and for rounded rectangles with a radius larger than
 * the inset; concave corners with tiny edges can self-intersect (documented limitation).
 */
export function offsetPolygon(points: readonly Point2D[], d: number): Point2D[] {
  const n = points.length;
  if (n < 3 || Math.abs(d) < EPS) return points.slice();
  // outward normal direction depends on the winding
  const sign = signedArea(points) >= 0 ? 1 : -1;
  const out: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i + n - 1) % n] as Point2D;
    const p1 = points[i] as Point2D;
    const p2 = points[(i + 1) % n] as Point2D;
    const e1 = unit(p1.x - p0.x, p1.y - p0.y);
    const e2 = unit(p2.x - p1.x, p2.y - p1.y);
    // outward normals (for CCW: rotate edge direction by -90°)
    const n1 = { x: e1.y * sign, y: -e1.x * sign };
    const n2 = { x: e2.y * sign, y: -e2.x * sign };
    const dot = n1.x * n2.x + n1.y * n2.y;
    const k = d / Math.max(1 + dot, 0.2);
    out.push({ x: p1.x + (n1.x + n2.x) * k, y: p1.y + (n1.y + n2.y) * k });
  }
  return out;
}

export function offsetShape(shape: Shape, d: number): Shape {
  return makeShape(offsetPolygon(shape.points, d), shape.closed);
}

function unit(x: number, y: number): Point2D {
  const l = Math.hypot(x, y);
  return l < EPS ? { x: 0, y: 0 } : { x: x / l, y: y / l };
}

/* ---------------------------------------------------------- constructors */

export function rectPoints(x: number, y: number, w: number, h: number): Point2D[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export function rectShape(x: number, y: number, w: number, h: number): Shape {
  return makeShape(rectPoints(x, y, w, h));
}

/** Rounded rectangle; `segments` points per corner arc. Winding: clockwise on screen. */
export function roundedRectPoints(x: number, y: number, w: number, h: number, r: number, segments = 6): Point2D[] {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rad < EPS) return rectPoints(x, y, w, h);
  const corners: Array<[number, number, number]> = [
    [x + w - rad, y + rad, -90], // top-right
    [x + w - rad, y + h - rad, 0], // bottom-right
    [x + rad, y + h - rad, 90], // bottom-left
    [x + rad, y + rad, 180], // top-left
  ];
  const pts: Point2D[] = [];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = ((start + (90 * i) / segments) * Math.PI) / 180;
      pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
    }
  }
  return pts.map((p) => roundPoint(p));
}

export function roundedRectShape(x: number, y: number, w: number, h: number, r: number, segments = 6): Shape {
  return makeShape(roundedRectPoints(x, y, w, h, r, segments));
}

export function circlePoints(cx: number, cy: number, r: number, segments = 24): Point2D[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (2 * Math.PI * i) / segments;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

/* ------------------------------------------------------------ intersection */

function orient(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** True when two simple polygons overlap (edges cross, or one contains the other). */
export function polygonsOverlap(a: readonly Point2D[], b: readonly Point2D[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i] as Point2D;
    const a2 = a[(i + 1) % a.length] as Point2D;
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a1, a2, b[j] as Point2D, b[(j + 1) % b.length] as Point2D)) return true;
    }
  }
  const a0 = a[0];
  const b0 = b[0];
  if (a0 && pointInPolygon(a0, b)) return true;
  if (b0 && pointInPolygon(b0, a)) return true;
  return false;
}

/* ---------------------------------------------------------- rasterisation */

export interface Raster {
  cols: number;
  rows: number;
  cell: number;
  originX: number;
  originY: number;
  data: Uint8Array;
}

export function rasterize(points: readonly Point2D[], bounds: Bounds, cell: number): Raster {
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell));
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cell));
  const data = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: bounds.minX + (c + 0.5) * cell, y: bounds.minY + (r + 0.5) * cell };
      if (pointInPolygon(p, points)) data[r * cols + c] = 1;
    }
  }
  return { cols, rows, cell, originX: bounds.minX, originY: bounds.minY, data };
}

export interface OverlapStats {
  areaA: number;
  areaB: number;
  intersection: number;
  union: number;
  iou: number;
  /** Area only in A / only in B (mm²). */
  onlyA: number;
  onlyB: number;
}

/** Rasterised overlap between two polygons that live in the same frame. */
export function overlapStats(a: readonly Point2D[], b: readonly Point2D[], cell = 1): OverlapStats {
  const ba = boundsOf(a);
  const bb = boundsOf(b);
  const bounds: Bounds = {
    minX: Math.min(ba.minX, bb.minX),
    minY: Math.min(ba.minY, bb.minY),
    maxX: Math.max(ba.maxX, bb.maxX),
    maxY: Math.max(ba.maxY, bb.maxY),
  };
  const ra = rasterize(a, bounds, cell);
  const rb = rasterize(b, bounds, cell);
  let inter = 0;
  let onlyA = 0;
  let onlyB = 0;
  for (let i = 0; i < ra.data.length; i++) {
    const x = ra.data[i] as number;
    const y = rb.data[i] as number;
    if (x && y) inter++;
    else if (x) onlyA++;
    else if (y) onlyB++;
  }
  const c2 = cell * cell;
  const union = (inter + onlyA + onlyB) * c2;
  return {
    areaA: (inter + onlyA) * c2,
    areaB: (inter + onlyB) * c2,
    intersection: inter * c2,
    union,
    iou: union > 0 ? (inter * c2) / union : 0,
    onlyA: onlyA * c2,
    onlyB: onlyB * c2,
  };
}
