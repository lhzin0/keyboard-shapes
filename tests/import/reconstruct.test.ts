import { describe, expect, it } from 'vitest';
import { CalibrationError, holesToMountingPoints, reconstructProfile, reconstructShape } from '../../src/import/ShapeReconstructor';
import { applyHomography, homography, traceContour, type Quad } from '../../src/import/vision/geometry';
import type { ImageLike } from '../../src/import/vision/mask';

/** White canvas with a dark rounded-ish rectangle and optional circular holes. */
function synth(w: number, h: number, rect: [number, number, number, number], holes: Array<[number, number, number]> = [], bg = 255): ImageLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let v = bg;
      const [x0, y0, x1, y1] = rect;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        v = 40;
        for (const [cx, cy, r] of holes) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) v = bg;
      }
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

describe('reconstructShape', () => {
  const img = synth(800, 300, [50, 40, 750, 260], [
    [150, 100, 6],
    [650, 100, 6],
    [400, 200, 6],
  ]);

  it('requires calibration', () => {
    expect(() => reconstructShape(img, {})).toThrow(CalibrationError);
  });

  it('calibrates the outline to millimetres from a known width', () => {
    const r = reconstructShape(img, { knownWidthMm: 325 });
    // 700 px ↔ 325 mm
    expect(r.shape.width).toBeCloseTo(325, 0);
    // 220 px × (325/700) = 102.1 mm
    expect(r.shape.depth).toBeCloseTo(102.1, 0);
    expect(r.confidence.level).toBe('reconstructed');
    expect(r.scale.x).toBeCloseTo(325 / 700, 3);
  });

  it('uses both known dimensions and warns when they disagree with the image', () => {
    const ok = reconstructShape(img, { knownWidthMm: 325, knownDepthMm: 102.1 });
    expect(ok.warnings).toEqual([]);
    const bad = reconstructShape(img, { knownWidthMm: 325, knownDepthMm: 140 });
    expect(bad.warnings.join(' ')).toMatch(/distorted|inconsistent/);
    expect(bad.confidence.score).toBeLessThan(ok.confidence.score);
  });

  it('detects the enclosed holes as mounting-point candidates', () => {
    const r = reconstructShape(img, { knownWidthMm: 325 });
    expect(r.holes).toHaveLength(3);
    const pts = holesToMountingPoints(r.holes);
    expect(pts).toHaveLength(3);
    // hole radius 6 px → ≈ 12 px diameter ≈ 5.6 mm
    expect(pts[0]?.diameter).toBeGreaterThan(5);
    expect(pts[0]?.diameter).toBeLessThan(6.2);
  });

  it('works with a transparent background', () => {
    const t = synth(400, 200, [20, 20, 380, 180]);
    for (let i = 0; i < t.width * t.height; i++) {
      const px = i * 4;
      if ((t.data[px] as number) === 255) t.data[px + 3] = 0;
    }
    const r = reconstructShape(t, { knownWidthMm: 360 });
    expect(r.steps.join(' ')).toMatch(/alpha/);
    expect(r.shape.width).toBeCloseTo(360, 0);
  });

  it('downscales large images without changing the calibrated result', () => {
    const big = synth(3200, 1200, [200, 160, 3000, 1040]);
    const r = reconstructShape(big, { knownWidthMm: 325, maxSize: 800 });
    expect(r.shape.width).toBeCloseTo(325, 0);
    expect(r.shape.depth).toBeCloseTo(102.1, -0.5);
  });

  it('fails clearly when there is no object', () => {
    const blank = synth(100, 100, [0, 0, 0, 0]);
    expect(() => reconstructShape(blank, { knownWidthMm: 100 })).toThrow(/No object/);
  });
});

describe('reconstructProfile', () => {
  it('reads a wedge-shaped side silhouette', () => {
    // wedge: height grows linearly from 20 px (front/left) to 60 px (rear/right)
    const w = 600;
    const h = 200;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let x = 50; x < 550; x++) {
      const height = 20 + ((x - 50) / 500) * 40;
      for (let y = 150 - Math.round(height); y < 150; y++) {
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 30;
      }
    }
    const r = reconstructProfile({ width: w, height: h, data }, { knownDepthMm: 250, frontSide: 'left' });
    // 500 px ↔ 250 mm → 0.5 mm/px → heights 10 mm … 30 mm
    expect(r.profile.frontHeight).toBeCloseTo(10, 0);
    expect(r.profile.rearHeight).toBeGreaterThan(28);
    expect(r.profile.angle).toBeGreaterThan(4);
    const flipped = reconstructProfile({ width: w, height: h, data }, { knownDepthMm: 250, frontSide: 'right' });
    expect(flipped.profile.frontHeight).toBeGreaterThan(28);
  });
});

describe('vision geometry', () => {
  it('traces the outline of a filled rectangle', () => {
    const w = 20;
    const h = 12;
    const data = new Uint8Array(w * h);
    for (let y = 3; y < 9; y++) for (let x = 4; x < 16; x++) data[y * w + x] = 1;
    const c = traceContour({ width: w, height: h, data });
    const xs = c.map((p) => p.x);
    const ys = c.map((p) => p.y);
    expect(Math.min(...xs)).toBe(4);
    expect(Math.max(...xs)).toBe(15);
    expect(Math.min(...ys)).toBe(3);
    expect(Math.max(...ys)).toBe(8);
    // perimeter of a 12×6 px block = 2·(11+5) boundary pixels
    expect(c.length).toBe(32);
  });

  it('homography maps the quad corners onto the target rectangle', () => {
    const src: Quad = [
      { x: 10, y: 20 },
      { x: 410, y: 5 },
      { x: 430, y: 220 },
      { x: 0, y: 230 },
    ];
    const dst: Quad = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 200 },
      { x: 0, y: 200 },
    ];
    const H = homography(src, dst);
    src.forEach((p, i) => {
      const q = applyHomography(H, p);
      expect(q.x).toBeCloseTo((dst[i] as { x: number }).x, 6);
      expect(q.y).toBeCloseTo((dst[i] as { y: number }).y, 6);
    });
  });
});

describe('guards found by testing a real shop page (regressions)', () => {
  it('rejects an outline whose depth contradicts the published depth', async () => {
    const { ReconstructionRejected } = await import('../../src/import/ShapeReconstructor');
    // 700×220 px object → 325 × 102 mm; a published depth of 145 mm cannot be right for this image
    const img = synth(800, 300, [50, 40, 750, 260]);
    expect(() => reconstructShape(img, { knownWidthMm: 325, expectedDepthMm: 145 })).toThrow(ReconstructionRejected);
    const ok = reconstructShape(img, { knownWidthMm: 325, expectedDepthMm: 102 });
    expect(ok.steps.join(' ')).toMatch(/agrees with the published/);
    const close = reconstructShape(img, { knownWidthMm: 325, expectedDepthMm: 108 });
    expect(close.warnings.join(' ')).toMatch(/off the published/);
  });

  it('rejects a "side view" that is far too tall to be a keyboard', async () => {
    const { ReconstructionRejected } = await import('../../src/import/ShapeReconstructor');
    const w = 400;
    const h = 400;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 20; y < 380; y++) for (let x = 20; x < 380; x++) data.fill(30, (y * w + x) * 4, (y * w + x) * 4 + 3);
    expect(() => reconstructProfile({ width: w, height: h, data }, { knownDepthMm: 300 })).toThrow(ReconstructionRejected);
  });
});
