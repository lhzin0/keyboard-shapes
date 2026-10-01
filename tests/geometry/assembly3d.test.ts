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
    const caps = a.parts.filter((p) => p.layer === 'keycaps').reduce((n, p) => n + (p.instances as Float32Array).length / 16, 0);
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
