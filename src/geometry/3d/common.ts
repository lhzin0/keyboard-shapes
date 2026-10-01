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
