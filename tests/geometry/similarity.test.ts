import { describe, expect, it } from 'vitest';
import { estimateCornerRadius, findSimilar, similarity } from '../../src/search/similarity';
import { evaluateBuild } from '../../src/compatibility/CompatibilityEngine';
import { roundedRectShape, rectShape } from '../../src/geometry/shape';
import { db } from '../../src/services/database';

describe('similarity (separate from compatibility)', () => {
  it('estimates the corner radius of a rounded rectangle', () => {
    expect(estimateCornerRadius(rectShape(0, 0, 100, 50))).toBeCloseTo(0, 6);
    // polygonal arcs slightly under-fill the circle, so allow some tolerance
    expect(estimateCornerRadius(roundedRectShape(0, 0, 100, 50, 6, 24))).toBeGreaterThan(5.5);
    expect(estimateCornerRadius(roundedRectShape(0, 0, 100, 50, 6, 24))).toBeLessThan(6.2);
  });

  it('identical items are fully similar', () => {
    const s = similarity({ kind: 'keyboard', id: 'ref-65' }, { kind: 'keyboard', id: 'ref-65' });
    expect(s?.breakdown.total).toBeCloseTo(1, 2);
  });

  it('ranks the 75% closer to the 65% than the full-size is', () => {
    const list = findSimilar({ kind: 'keyboard', id: 'ref-65' }, 10);
    const rank = (id: string) => list.findIndex((m) => m.item.id === id);
    expect(rank('ref-75')).toBeGreaterThanOrEqual(0);
    expect(rank('ref-75')).toBeLessThan(rank('ref-full'));
  });

  it('similar ≠ compatible: look-alike cases are not interchangeable by similarity alone', () => {
    // case A and case C have identical outlines (similarity ≈ 1) but case C has a shifted USB cutout
    const s = similarity({ kind: 'case', id: 'ref-65-case-a' }, { kind: 'case', id: 'ref-65-case-c' });
    expect(s?.breakdown.outline).toBeGreaterThan(0.99);
    const pcb = db.pcbs.find((p) => p.id === 'ref-65-pcb-a')!;
    const daughter = db.daughterboards.find((d) => d.id === 'ref-daughterboard-a')!;
    const usb = (caseId: string) =>
      evaluateBuild({ case: db.cases.find((c) => c.id === caseId)!, pcb, daughterboard: daughter }).summary.find((k) => k.id === 'usb')?.status;
    expect(usb('ref-65-case-a')).toBe('ok');
    expect(usb('ref-65-case-c')).toBe('fail');
  });
});
