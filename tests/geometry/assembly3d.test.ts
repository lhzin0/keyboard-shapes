import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildAssembly, tiltMatrix } from '../../src/geometry/3d/KeyboardAssembly';
import { notchedRing } from '../../src/geometry/3d/CaseGenerator';
import { computeStack } from '../../src/geometry/3d/stack';
import { resolveModelSource } from '../../src/geometry/3d/modelSource';
import { buildReferenceDatabase } from '../../src/geometry/reference';
import { rectPoints, roundedRectPoints, area } from '../../src/geometry/shape';

const db = buildReferenceDatabase();
const get = <T extends { id: string }>(list: T[], id: string) => {
  const x = list.find((i) => i.id === id);
  if (!x) throw new Error(id);
  return x;
};

function size(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const b = g.boundingBox as THREE.Box3;
  return { b, w: b.max.x - b.min.x, h: b.max.y - b.min.y, d: b.max.z - b.min.z };
}

describe('parametric 3D assembly', () => {
  const kb = get(db.keyboards, 'ref-65');
  const sel = {
    case: get(db.cases, 'ref-65-case-a'),
    pcb: get(db.pcbs, 'ref-65-pcb-a'),
    plate: get(db.plates, 'ref-65-plate-a'),
    daughterboard: get(db.daughterboards, 'ref-daughterboard-a'),
    switch: db.switches[0],
    keycap: db.keycaps[0],
    foam: db.foams[0],
    layout: kb.layout,
  };
  const a = buildAssembly(sel);

  it('creates an independent part for every layer', () => {
    expect(a.layers).toEqual(['keycaps', 'switches', 'plate', 'pcb', 'daughterboard', 'topCase', 'bottomCase', 'foam', 'hardware']);
    expect(a.warnings).toEqual([]);
  });

  it('is dimensionally coherent with the data (mm)', () => {
    const bottom = size(a.parts.find((p) => p.id === 'case-bottom')!.geometry);
    expect(bottom.w).toBeCloseTo(sel.case.dimensions.width, 1);
    expect(bottom.d).toBeCloseTo(sel.case.dimensions.depth, 1);

    const pcb = size(a.parts.find((p) => p.id === 'pcb')!.geometry);
    expect(pcb.w).toBeCloseTo(sel.pcb.dimensions.width, 1);
    expect(pcb.d).toBeCloseTo(sel.pcb.dimensions.depth, 1);
    expect(pcb.h).toBeCloseTo(1.6, 3);

    const plate = size(a.parts.find((p) => p.id === 'plate')!.geometry);
    expect(plate.w).toBeCloseTo(sel.plate.dimensions.width, 1);
    expect(plate.h).toBeCloseTo(sel.plate.thickness, 3);
  });

  it('stacks the layers in the right order', () => {
    const s = a.stack;
    expect(s.pcbBottom).toBeLessThan(s.pcbTop);
    expect(s.pcbTop + 5).toBeCloseTo(s.plateBottom, 6); // switch plate-to-PCB
    expect(s.plateBottom).toBeLessThan(s.plateTop);
    expect(s.plateTop).toBeLessThan(s.keycapBase);
    expect(s.rim).toBeGreaterThanOrEqual(s.plateTop - 1e-6);
  });

  it('places the PCB inside the case cavity using mounting registration', () => {
    const pcb = size(a.parts.find((p) => p.id === 'pcb')!.geometry);
    const cavity = sel.case.internalCavity!;
    expect(pcb.b.min.x).toBeGreaterThan(Math.min(...cavity.points.map((p) => p.x)));
    expect(pcb.b.max.x).toBeLessThan(Math.max(...cavity.points.map((p) => p.x)));
    expect(pcb.b.min.z).toBeGreaterThan(0);
    expect(pcb.b.max.z).toBeLessThan(sel.case.dimensions.depth);
  });

  it('instances one switch per PCB position and one keycap per key', () => {
    const sw = a.parts.find((p) => p.layer === 'switches')!;
    expect((sw.instances as Float32Array).length / 16).toBe(sel.pcb.switchPositions.length);
    const caps = a.parts.filter((p) => p.role === 'keycap').reduce((n, p) => n + (p.instances as Float32Array).length / 16, 0);
    expect(caps).toBe(kb.layout.keyCount);
  });

  it('wedge underside keeps the case flat on the desk after tilting', () => {
    const g = a.parts.find((p) => p.id === 'case-bottom')!.geometry.clone();
    g.applyMatrix4(tiltMatrix(a));
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 1);
    // …and the rear is higher than the front by about depth·sin(angle)
    expect(g.boundingBox!.max.y).toBeGreaterThan(sel.case.frontHeight!);
  });

  it('works with partial selections (PCB alone, plate alone)', () => {
    const pcbOnly = buildAssembly({ pcb: sel.pcb });
    expect(pcbOnly.layers).toContain('pcb');
    expect(pcbOnly.layers).toContain('switches');
    const plateOnly = buildAssembly({ plate: sel.plate });
    expect(plateOnly.layers).toContain('plate');
  });

  it('warns instead of drawing wrong keycaps when the layout does not match', () => {
    const wrong = buildAssembly({ ...sel, layout: get(db.keyboards, 'ref-60').layout });
    expect(wrong.layers).not.toContain('keycaps');
    expect(wrong.warnings.join(' ')).toMatch(/keycaps are not drawn/);
  });
});

describe('case wall notch', () => {
  it('produces a simple ring polygon with the notch removed from the wall', () => {
    const outer = roundedRectPoints(0, 0, 100, 60, 4, 6);
    const cavity = roundedRectPoints(3, 3, 94, 54, 1.5, 6);
    const ring = notchedRing(outer, cavity, 44, 56);
    expect(ring).not.toBeNull();
    const full = Math.abs(area(outer)) - Math.abs(area(cavity));
    const notched = Math.abs(area(ring!));
    // the notch removes ≈ 12 mm × 3 mm of wall
    expect(full - notched).toBeCloseTo(36, 0);
  });

  it('returns null when the notch is not on a straight wall segment', () => {
    expect(notchedRing(rectPoints(0, 0, 100, 60), rectPoints(3, 3, 94, 54), 98, 110)).toBeNull();
  });
});

describe('stack and model source', () => {
  it('computeStack uses defaults when parts are missing', () => {
    const s = computeStack({});
    expect(s.pcbBottom).toBe(5);
    expect(s.plateTop).toBeGreaterThan(s.plateBottom);
  });

  it('prefers CAD > GLB > reconstructed > parametric > estimated, and ignores file kinds without a file', () => {
    expect(resolveModelSource([{ kind: 'parametric' }, { kind: 'glb', url: 'a.glb' }]).kind).toBe('glb');
    expect(resolveModelSource([{ kind: 'glb', url: 'a.glb' }, { kind: 'cad', url: 'a.step.glb' }]).kind).toBe('cad');
    expect(resolveModelSource([{ kind: 'cad' }, { kind: 'parametric' }]).kind).toBe('parametric');
    expect(resolveModelSource([]).kind).toBe('estimated');
    expect(resolveModelSource([{ kind: 'reconstructed', url: 'r.glb' }, { kind: 'parametric' }]).procedural).toBe(false);
    // a generated copy of a parametric model is not a reason to stop building it procedurally
    expect(resolveModelSource([{ kind: 'parametric', url: 'models/x.glb' }]).procedural).toBe(true);
  });
});

import { sculptedKeycap } from '../../src/geometry/3d/common';

describe('sculpted keycap', () => {
  const volume = (g: THREE.BufferGeometry) => {
    const geo = g.index ? g.toNonIndexed() : g;
    const p = geo.getAttribute('position');
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    const C = new THREE.Vector3();
    let v = 0;
    for (let i = 0; i < p.count; i += 3) {
      A.fromBufferAttribute(p, i);
      B.fromBufferAttribute(p, i + 1);
      C.fromBufferAttribute(p, i + 2);
      v += A.dot(B.clone().cross(C)) / 6;
    }
    return v;
  };

  it('is closed with outward faces and keeps its footprint and height', () => {
    const g = sculptedKeycap(18, 18, 3, 8.4, 4.5);
    g.computeBoundingBox();
    const b = g.boundingBox as THREE.Box3;
    expect(b.max.x - b.min.x).toBeCloseTo(18, 1);
    expect(b.max.z - b.min.z).toBeCloseTo(18, 1);
    expect(b.min.y).toBeCloseTo(4.5, 6);
    expect(b.max.y).toBeLessThanOrEqual(4.5 + 8.4 + 1e-6);
    expect(b.max.y).toBeGreaterThan(4.5 + 8.4 - 1);
    expect(volume(g)).toBeGreaterThan(0); // positive volume = faces point outwards
    // a keycap is a bit smaller than its bounding box (rounded, tapered): between 45% and 90% of the box volume
    const box = 18 * 18 * 8.4;
    expect(volume(g) / box).toBeGreaterThan(0.45);
    expect(volume(g) / box).toBeLessThan(0.9);
  });

  it('is dished: the centre of the top sits below the rim', () => {
    const g = sculptedKeycap(18, 18, 3, 8.4, 0, { dish: 0.8 });
    const p = g.getAttribute('position');
    let centreY = -1;
    let maxY = -Infinity;
    for (let i = 0; i < p.count; i++) {
      maxY = Math.max(maxY, p.getY(i));
      if (Math.abs(p.getX(i)) < 1e-6 && Math.abs(p.getZ(i) + 0.4) < 1e-6) centreY = Math.max(centreY, p.getY(i));
    }
    expect(centreY).toBeLessThan(maxY - 0.5);
  });

  it('handles wide keys (6.25u space bar)', () => {
    const g = sculptedKeycap(6.25 * 19.05 - 1, 18, 3, 8.6, 4.5);
    g.computeBoundingBox();
    expect((g.boundingBox as THREE.Box3).max.x * 2).toBeCloseTo(6.25 * 19.05 - 1, 0);
  });
});

import { generateLegends, legendColorFor, legendText } from '../../src/geometry/3d/LegendGenerator';
import { layout60 } from '../../src/geometry/layouts';

describe('keycap legends', () => {
  const layout = layout60();
  const centers = layout.keys.map((k) => ({ x: (k.x + k.width / 2) * 19.05, y: (k.y + k.height / 2) * 19.05 }));
  const build = generateLegends(layout, undefined, centers, 12)!;

  it('makes one quad per labelled key and none for the space bar', () => {
    expect(legendText('Space')).toBe('');
    const labelled = layout.keys.filter((k) => legendText(k.label) !== '').length;
    expect(build.quads).toBe(labelled);
    expect(build.quads).toBeLessThan(layout.keyCount);
    expect(build.geometry.getAttribute('position').count).toBe(build.quads * 4);
  });

  it('atlas has each distinct text once and UVs stay inside [0,1]', () => {
    expect(new Set(build.atlas).size).toBe(build.atlas.length);
    expect(build.atlas).toContain('Tab');
    const uv = build.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
  });

  it('quads face up and sit on top of their keycaps', () => {
    const n = build.geometry.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeGreaterThan(0.99);
    const p = build.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      expect(p.getY(i)).toBeGreaterThan(12 + 8); // above the keycap base + most of its height
      expect(p.getY(i)).toBeLessThan(12 + 12);
    }
  });

  it('picks a contrasting legend colour (a rendering rule)', () => {
    expect(legendColorFor('#383838')).toBe('#f1f1f1');
    expect(legendColorFor('#e6e1d6')).toBe('#2b2b2b');
    expect(legendColorFor(undefined)).toBe('#2b2b2b');
  });
});

import { strapMountOutline } from '../../src/geometry/3d/CaseGenerator';
import { boundsOf } from '../../src/geometry/shape';

describe('strap mount attachment', () => {
  const base = db.cases.find((c) => c.id === 'ref-60-case-a')!;
  const withStrap = { ...base, attachments: [{ kind: 'strap-mount' as const, side: 'left' as const, from: 10, to: 45, depth: 6, source: 'photo' as const }] };

  it('outline sticks out of the left edge by its depth and spans from..to', () => {
    const { outline, slot } = strapMountOutline(withStrap.attachments[0]!, base.dimensions.width, base.dimensions.depth);
    const b = boundsOf(outline.map((p) => p));
    expect(b.minX).toBeCloseTo(-6, 1);
    expect(b.maxX).toBeCloseTo(1.5, 1); // reaches 1.5 mm into the wall
    expect(b.minY).toBeCloseTo(10, 1);
    expect(b.maxY).toBeCloseTo(45, 1);
    const s = boundsOf(slot);
    expect(s.minX).toBeGreaterThan(b.minX);
    expect(s.maxY).toBeLessThan(b.maxY);
  });

  it('is built as a separate part of the case and widens the assembly on that side', () => {
    const a = buildAssembly({ case: withStrap });
    const strap = a.parts.find((p) => p.id === 'case-strap');
    expect(strap).toBeDefined();
    expect(strap!.role).toBe('case');
    const g = strap!.geometry;
    g.computeBoundingBox();
    expect((g.boundingBox as THREE.Box3).min.x).toBeCloseTo(-6, 1);
    expect(a.warnings.join(' ')).toMatch(/Strap mount: position and size measured/);
    const plain = buildAssembly({ case: base });
    expect(plain.parts.find((p) => p.id === 'case-strap')).toBeUndefined();
  });

  it('works on every side', () => {
    for (const side of ['left', 'right', 'back', 'front'] as const) {
      const { outline } = strapMountOutline({ kind: 'strap-mount', side, from: 20, to: 50, depth: 5, source: 'user' }, 300, 110);
      const b = boundsOf(outline);
      if (side === 'left') expect(b.minX).toBeCloseTo(-5, 1);
      if (side === 'right') expect(b.maxX).toBeCloseTo(305, 1);
      if (side === 'back') expect(b.minY).toBeCloseTo(-5, 1);
      if (side === 'front') expect(b.maxY).toBeCloseTo(115, 1);
    }
  });
});
