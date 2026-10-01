/**
 * Shared Three.js helpers for the parametric generators.
 *
 * World mapping (millimetres, Three is Y-up):
 *   component frame (x, y, z↑)  →  Three (X = x, Y = z, Z = y)
 * so the *front* of a keyboard points to +Z (towards the default camera) and the
 * USB side (back, y = 0) to −Z.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { circlePoints } from '../shape';
import type { Point2D } from '../../types/keyboard';

/** Polygon (x, y) → THREE.Shape. y is mirrored so that rotateX(−90°) maps it to +Z. */
export function toThreeShape(points: readonly Point2D[], holes: readonly (readonly Point2D[])[] = []): THREE.Shape {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.y))));
  return shape;
}

/**
 * Extrude a polygon (with optional holes) vertically.
 * The result spans Y ∈ [z0, z0 + height] and keeps the (x, y) → (X, Z) mapping.
 */
export function extrude(
  points: readonly Point2D[],
  height: number,
  z0 = 0,
  holes: readonly (readonly Point2D[])[] = [],
  curveSegments = 4,
): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(toThreeShape(points, holes), { depth: Math.max(height, 0.001), bevelEnabled: false, curveSegments });
  g.rotateX(-Math.PI / 2);
  g.translate(0, z0, 0);
  return g;
}

/** Axis-aligned box centred at (cx, cy) in the plane, from z0 up by `height`. Returns Y-up geometry. */
export function box(cx: number, cy: number, w: number, d: number, height: number, z0: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, height, d);
  g.translate(cx, z0 + height / 2, cy);
  return g;
}

export function cylinder(cx: number, cy: number, radius: number, height: number, z0: number, segments = 16): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, height, segments);
  g.translate(cx, z0 + height / 2, cy);
  return g;
}

export function holeCircle(x: number, y: number, diameter: number, segments = 14): Point2D[] {
  return circlePoints(x, y, diameter / 2, segments);
}

export function holeRect(cx: number, cy: number, w: number, d: number, rotationDeg = 0): Point2D[] {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, y]) => ({ x: cx + (x as number) * c - (y as number) * s, y: cy + (x as number) * s + (y as number) * c }));
}

/**
 * Square frustum (keycap-like): base bw×bd at z0, top tw×td at z0+height.
 * Non-indexed so that every face gets flat shading.
 */
export function frustum(bw: number, bd: number, tw: number, td: number, height: number, z0 = 0, topDy = 0): THREE.BufferGeometry {
  const b = [
    [-bw / 2, z0, -bd / 2],
    [bw / 2, z0, -bd / 2],
    [bw / 2, z0, bd / 2],
    [-bw / 2, z0, bd / 2],
  ];
  const t = [
    [-tw / 2, z0 + height, -td / 2 + topDy],
    [tw / 2, z0 + height, -td / 2 + topDy],
    [tw / 2, z0 + height, td / 2 + topDy],
    [-tw / 2, z0 + height, td / 2 + topDy],
  ];
  const quads: number[][][] = [
    [t[0] as number[], t[3] as number[], t[2] as number[], t[1] as number[]], // top (+Y)
    [b[0] as number[], b[1] as number[], b[2] as number[], b[3] as number[]], // bottom (−Y)
    [b[0] as number[], t[0] as number[], t[1] as number[], b[1] as number[]], // back (−Z)
    [b[2] as number[], t[2] as number[], t[3] as number[], b[3] as number[]], // front (+Z)
    [b[3] as number[], t[3] as number[], t[0] as number[], b[0] as number[]], // left
    [b[1] as number[], t[1] as number[], t[2] as number[], b[2] as number[]], // right
  ];
  const pos: number[] = [];
  for (const [a, bb, c, d] of quads as [number[], number[], number[], number[]][]) {
    pos.push(...a, ...bb, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function merge(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 0) return new THREE.BufferGeometry();
  // ExtrudeGeometry has groups and uv; strip so that attributes are compatible
  const clean = geometries.map((g) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    n.clearGroups();
    n.deleteAttribute('uv');
    return n;
  });
  const merged = mergeGeometries(clean, false);
  clean.forEach((g) => g.dispose());
  return merged ?? new THREE.BufferGeometry();
}

export function bounds(g: THREE.BufferGeometry): THREE.Box3 {
  g.computeBoundingBox();
  return g.boundingBox ?? new THREE.Box3();
}

/** Counter-clockwise (seen from +Y) rounded-rectangle ring in the XZ plane with `seg + 1` points per corner. */
function roundedRing(hw: number, hd: number, r: number, seg: number): Array<[number, number]> {
  const rad = Math.max(0.05, Math.min(r, hw, hd));
  const out: Array<[number, number]> = [];
  // corner centres, walking counter-clockwise starting at the front-right corner
  const corners: Array<[number, number, number]> = [
    [hw - rad, hd - rad, 0],
    [-(hw - rad), hd - rad, 90],
    [-(hw - rad), -(hd - rad), 180],
    [hw - rad, -(hd - rad), 270],
  ];
  for (const [cx, cz, start] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = ((start + (90 * i) / seg) * Math.PI) / 180;
      out.push([cx + rad * Math.cos(a), cz + rad * Math.sin(a)]);
    }
  }
  return out;
}

export interface KeycapShape {
  /** Rounding radius of the base / top outline (mm). */
  baseRadius?: number;
  topRadius?: number;
  /** How far the centre of the top surface sits below its rim (mm): the "dish". */
  dish?: number;
  /** Shift of the top surface towards the back (mm): the typical sculpted slope. */
  topShift?: number;
}

/**
 * Sculpted keycap: rounded base, softly tapered walls, rounded top rim and a concave (dished) top surface.
 * Closed, indexed (smooth normals). Footprint w × d at y = z0, height `h`.
 */
export function sculptedKeycap(w: number, d: number, taper: number, h: number, z0 = 0, shape: KeycapShape = {}): THREE.BufferGeometry {
  const seg = 5;
  const hwB = w / 2;
  const hdB = d / 2;
  const hwT = Math.max(w / 2 - taper, 1);
  const hdT = Math.max(d / 2 - taper, 1);
  const base = roundedRing(hwB, hdB, shape.baseRadius ?? 1.4, seg);
  const top = roundedRing(hwT, hdT, shape.topRadius ?? 2.6, seg);
  const N = base.length;
  const dish = shape.dish ?? Math.min(0.75, h * 0.08);
  const shift = shape.topShift ?? -0.4;

  const pos: number[] = [];
  const idx: number[] = [];
  const ringStart: number[] = [];
  const addRing = (pts: Array<[number, number]>, y: number, dz = 0) => {
    ringStart.push(pos.length / 3);
    for (const [x, z] of pts) pos.push(x, y, z + dz);
  };
  const lerpRing = (t: number) => base.map(([bx, bz], i) => [bx + ((top[i] as [number, number])[0] - bx) * t, bz + ((top[i] as [number, number])[1] - bz) * t] as [number, number]);

  // walls: bottom → rim, easing the taper so the upper part is steeper (a soft shoulder)
  const wallSteps = 4;
  for (let k = 0; k <= wallSteps; k++) {
    const t = k / wallSteps;
    const eased = 1 - (1 - t) ** 1.6;
    addRing(lerpRing(eased), z0 + h * t * 0.97, shift * t);
  }
  // top surface: concentric rings shrinking to the centre; the dish deepens towards the middle
  const topSteps = 4;
  for (let k = 1; k <= topSteps; k++) {
    const s = 1 - k / (topSteps + 1);
    addRing(top.map(([x, z]) => [x * s, z * s] as [number, number]), z0 + h * 0.97 - dish * (1 - s * s) + h * 0.03 * s, shift);
  }
  const centre = pos.length / 3;
  pos.push(0, z0 + h * 0.97 - dish, shift);
  // bottom cap
  const bottomCentre = centre + 1;
  pos.push(0, z0, 0);

  const stitch = (a: number, b: number) => {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      // two triangles, outward-facing for rings stacked upwards (verified by the signed-volume test)
      idx.push(a + i, b + j, a + j, a + i, b + i, b + j);
    }
  };
  for (let r = 0; r + 1 < ringStart.length; r++) stitch(ringStart[r] as number, ringStart[r + 1] as number);
  const lastRing = ringStart[ringStart.length - 1] as number;
  for (let i = 0; i < N; i++) idx.push(lastRing + i, centre, lastRing + ((i + 1) % N));
  const firstRing = ringStart[0] as number;
  for (let i = 0; i < N; i++) idx.push(firstRing + ((i + 1) % N), bottomCentre, firstRing + i);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
