import { describe, expect, it } from 'vitest';
import {
  area,
  boundsOf,
  containment,
  distance,
  mirrorShape,
  normalizeShape,
  offsetPolygon,
  overlapStats,
  pointInPolygon,
  polygonsOverlap,
  rectPoints,
  rectShape,
  rotateShape,
  roundedRectPoints,
  scaleShape,
  simplifyPolyline,
  translateShape,
} from '../../src/geometry/shape';
import { registerPoints } from '../../src/geometry/registration';

describe('shape transformations', () => {
  it('computes width/depth from points', () => {
    const s = rectShape(0, 0, 100, 40);
    expect(s.width).toBe(100);
    expect(s.depth).toBe(40);
  });

  it('translates, scales and normalises in millimetres', () => {
    const s = translateShape(rectShape(0, 0, 10, 10), 5, 7);
    expect(boundsOf(s.points)).toEqual({ minX: 5, minY: 7, maxX: 15, maxY: 17 });
    expect(normalizeShape(s).points[0]).toEqual({ x: 0, y: 0 });
    const big = scaleShape(rectShape(0, 0, 10, 10), 2);
    expect(big.width).toBe(20);
  });

  it('rotating a rectangle by 90° swaps width and depth', () => {
    const r = rotateShape(rectShape(0, 0, 100, 40), 90);
    expect(r.width).toBeCloseTo(40, 6);
    expect(r.depth).toBeCloseTo(100, 6);
  });

  it('mirroring keeps the bounding box and the area', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 5 },
    ];
    const m = mirrorShape({ points: pts, width: 10, depth: 5, closed: true }, 'x');
    expect(m.width).toBe(10);
    expect(area(m.points)).toBeCloseTo(25);
  });

  it('offsets a rectangle outwards and inwards', () => {
    const grown = offsetPolygon(rectPoints(0, 0, 100, 50), 3);
    const b = boundsOf(grown);
    expect(b.maxX - b.minX).toBeCloseTo(106, 6);
    expect(b.maxY - b.minY).toBeCloseTo(56, 6);
    const shrunk = offsetPolygon(roundedRectPoints(0, 0, 100, 50, 6), -3);
    const bs = boundsOf(shrunk);
    expect(bs.maxX - bs.minX).toBeCloseTo(94, 1);
  });

  it('simplifies a noisy straight line', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i % 2 === 0 ? 0 : 0.01 }));
    expect(simplifyPolyline(pts, 0.1).length).toBe(2);
  });
});

describe('distance, containment and overlap', () => {
  it('measures distance in mm', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('point in polygon', () => {
    const sq = rectPoints(0, 0, 10, 10);
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
  });

  it('containment returns the smallest gap when inside', () => {
    const outer = rectPoints(0, 0, 100, 100);
    const inner = rectPoints(4, 6, 80, 80);
    const r = containment(inner, outer);
    expect(r.contained).toBe(true);
    expect(r.clearance).toBeCloseTo(4, 6);
  });

  it('containment is negative when the inner polygon pokes out', () => {
    const r = containment(rectPoints(-2, 0, 50, 50), rectPoints(0, 0, 100, 100));
    expect(r.contained).toBe(false);
    expect(r.clearance).toBeCloseTo(-2, 6);
  });

  it('detects polygon overlap, including full containment', () => {
    expect(polygonsOverlap(rectPoints(0, 0, 10, 10), rectPoints(5, 5, 10, 10))).toBe(true);
    expect(polygonsOverlap(rectPoints(0, 0, 10, 10), rectPoints(20, 20, 5, 5))).toBe(false);
    expect(polygonsOverlap(rectPoints(0, 0, 100, 100), rectPoints(10, 10, 5, 5))).toBe(true);
  });

  it('IoU of identical shapes is 1 and of disjoint shapes is 0', () => {
    expect(overlapStats(rectPoints(0, 0, 20, 20), rectPoints(0, 0, 20, 20)).iou).toBeCloseTo(1, 6);
    expect(overlapStats(rectPoints(0, 0, 20, 20), rectPoints(50, 50, 20, 20)).iou).toBe(0);
  });
});

describe('point registration', () => {
  const base = [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 50, y: 60 },
  ];
  it('finds the translation between two frames', () => {
    const fixed = base.map((p) => ({ x: p.x + 12.5, y: p.y + 7 }));
    const r = registerPoints(base, fixed, 0.5);
    expect(r?.matched).toBe(3);
    expect(r?.dx).toBeCloseTo(12.5, 6);
    expect(r?.dy).toBeCloseTo(7, 6);
  });

  it('reports partial matches when the pattern differs', () => {
    const fixed = [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 50, y: 70 },
    ];
    const r = registerPoints(base, fixed, 0.5);
    expect(r?.matched).toBe(2);
  });

  it('respects the tolerance', () => {
    const fixed = base.map((p) => ({ x: p.x + 0.4, y: p.y }));
    expect(registerPoints(base, fixed, 0.5)?.matched).toBe(3);
    const off = [...base.slice(0, 2), { x: 50, y: 61 }];
    expect(registerPoints(base, off, 0.5)?.matched).toBe(2);
  });
});
