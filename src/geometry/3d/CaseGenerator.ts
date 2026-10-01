/**
 * CaseGenerator: Case → top case + bottom case geometry.
 *
 *  - floor slab with a wedge underside, so that after the typing angle is applied
 *    the case rests flat on the desk;
 *  - walls extruded from the external outline with the internal cavity as a hole;
 *  - a real notch in the wall for the USB cutout (no CSG: the notch is part of the
 *    wall polygon, see `notchedRing`);
 *  - standoffs at the case mounting points.
 *
 * Output is in the typing-plane frame (see stack.ts); the viewer tilts it.
 */
import * as THREE from 'three';
import { makeShape, offsetPolygon, signedArea } from '../shape';
import type { Case, Cutout, Point2D } from '../../types/keyboard';
import { cylinder, extrude, merge } from './common';
import type { StackLevels } from './stack';

export interface CaseGeometry {
  bottom: THREE.BufferGeometry;
  top: THREE.BufferGeometry;
  /** Cavity actually used (fallback = outline inset by the wall thickness). */
  cavity: Point2D[];
  warnings: string[];
}

const EPS = 1e-6;

type Mapper = { to: (p: Point2D) => Point2D; from: (p: Point2D) => Point2D };

/** Transforms that bring any wall to y = min ("back") so one notch routine serves all walls. */
function wallMapper(wall: Cutout['wall'], w: number, d: number): Mapper {
  switch (wall) {
    case 'back':
      return { to: (p) => p, from: (p) => p };
    case 'front':
      return { to: (p) => ({ x: p.x, y: d - p.y }), from: (p) => ({ x: p.x, y: d - p.y }) };
    case 'left':
      return { to: (p) => ({ x: p.y, y: p.x }), from: (p) => ({ x: p.y, y: p.x }) };
    case 'right':
      return { to: (p) => ({ x: p.y, y: w - p.x }), from: (p) => ({ x: w - p.y, y: p.x }) };
  }
}

function edgeOn(poly: Point2D[], y: number, x1: number, x2: number): number {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Point2D;
    const b = poly[(i + 1) % poly.length] as Point2D;
    if (Math.abs(a.y - y) < EPS && Math.abs(b.y - y) < EPS && Math.min(a.x, b.x) <= x1 + EPS && Math.max(a.x, b.x) >= x2 - EPS) return i;
  }
  return -1;
}

/**
 * A wall ring (outer outline minus cavity) with a rectangular notch through the "back"
 * wall, expressed as a single simple polygon:
 *   outer … → (entry, yOuter) → (entry, yCavity) → cavity (the long way round) → (exit, yCavity) → (exit, yOuter) → … outer
 * Returns null when the notch does not lie on straight wall segments.
 */
export function notchedRing(outer: Point2D[], cavity: Point2D[], x1: number, x2: number): Point2D[] | null {
  let O = outer.slice();
  let C = cavity.slice();
  if (Math.sign(signedArea(O)) !== Math.sign(signedArea(C))) C = C.reverse();
  const yo = Math.min(...O.map((p) => p.y));
  const yc = Math.min(...C.map((p) => p.y));
  let i = edgeOn(O, yo, x1, x2);
  let j = edgeOn(C, yc, x1, x2);
  if (i < 0 || j < 0) {
    // try the opposite orientation of the traversal direction check
    O = O.slice();
    i = edgeOn(O, yo, x1, x2);
    j = edgeOn(C, yc, x1, x2);
    if (i < 0 || j < 0) return null;
  }
  const a = O[i] as Point2D;
  const b = O[(i + 1) % O.length] as Point2D;
  const c0 = C[j] as Point2D;
  const c1 = C[(j + 1) % C.length] as Point2D;
  const dirO = Math.sign(b.x - a.x);
  const dirC = Math.sign(c1.x - c0.x);
  if (dirO !== dirC) {
    C = C.reverse();
    j = edgeOn(C, yc, x1, x2);
    if (j < 0) return null;
  }
  const entry = dirO < 0 ? x2 : x1;
  const exit = dirO < 0 ? x1 : x2;

  const out: Point2D[] = [];
  for (let k = 0; k <= i; k++) out.push(O[k] as Point2D);
  out.push({ x: entry, y: yo }, { x: entry, y: yc });
  // cavity, backwards from C[j] around to C[j+1]
  for (let k = 0; k < C.length; k++) out.push(C[(j - k + C.length) % C.length] as Point2D);
  out.push({ x: exit, y: yc }, { x: exit, y: yo });
  for (let k = i + 1; k < O.length; k++) out.push(O[k] as Point2D);
  return out;
}

export function generateCase(c: Case, stack: StackLevels): CaseGeometry {
  const warnings: string[] = [];
  const outer = c.externalShape.points;
  let cavity = c.internalCavity?.points;
  if (!cavity) {
    cavity = offsetPolygon(outer, -(c.wallThickness ?? 3));
    warnings.push('No internal cavity recorded: the cavity was estimated from the outline.');
  }
  const W = c.dimensions.width;
  const D = c.dimensions.depth;
  const { floorThickness: floorT, split, rim } = stack;

  // --- floor slab with wedge underside (becomes flat on the desk once tilted)
  const slab = extrude(outer, floorT, -floorT);
  if (stack.tiltDeg !== 0) {
    const tan = Math.tan((stack.tiltDeg * Math.PI) / 180);
    const pos = slab.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) + floorT) < 1e-6) pos.setY(i, -floorT - (D - pos.getZ(i)) * tan);
    }
    pos.needsUpdate = true;
    slab.computeVertexNormals();
  }

  // --- wall bands, with the USB notch if there is one
  const usb = c.cutouts.find((cu) => cu.kind === 'usb');
  const bands: Array<{ z0: number; z1: number; notch: boolean }> = [];
  let notchPoly: Point2D[] | null = null;
  let nz0 = 0;
  let nz1 = 0;
  if (usb) {
    const m = wallMapper(usb.wall, W, D);
    const ring = notchedRing(outer.map(m.to), cavity.map(m.to), usb.center - usb.width / 2, usb.center + usb.width / 2);
    if (ring) {
      notchPoly = ring.map(m.from);
      nz0 = Math.max(0, stack.pcbTop - 0.5);
      nz1 = Math.min(rim, nz0 + (usb.height ?? 6.5));
    } else {
      warnings.push('USB cutout could not be cut into the wall (not on a straight segment); it is not drawn.');
    }
  }
  const cuts = new Set<number>([0, split, rim]);
  if (notchPoly) {
    cuts.add(nz0);
    cuts.add(nz1);
  }
  const zs = [...cuts].filter((z) => z >= 0 && z <= rim).sort((a, b) => a - b);
  for (let k = 0; k < zs.length - 1; k++) {
    const z0 = zs[k] as number;
    const z1 = zs[k + 1] as number;
    if (z1 - z0 < 1e-4) continue;
    bands.push({ z0, z1, notch: !!notchPoly && z0 >= nz0 - 1e-6 && z1 <= nz1 + 1e-6 });
  }

  const bottomParts: THREE.BufferGeometry[] = [slab];
  const topParts: THREE.BufferGeometry[] = [];
  for (const band of bands) {
    const g = band.notch && notchPoly ? extrude(notchPoly, band.z1 - band.z0, band.z0) : extrude(outer, band.z1 - band.z0, band.z0, [cavity]);
    ((band.z0 + band.z1) / 2 < split ? bottomParts : topParts).push(g);
  }

  // --- standoffs
  for (const p of c.mountingPoints) {
    bottomParts.push(cylinder(p.x, p.y, (p.diameter ?? 4.5) / 2, stack.pcbBottom, 0, 14));
  }

  return { bottom: merge(bottomParts), top: topParts.length ? merge(topParts) : new THREE.BufferGeometry(), cavity, warnings };
}

export { makeShape };
