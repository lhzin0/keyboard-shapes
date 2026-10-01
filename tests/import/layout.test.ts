import { describe, expect, it } from 'vitest';
import { detectLayout, detectLayoutFromText } from '../../src/import/LayoutDetector';
import { buildLayout, layout40, layout60, layout65, layout75, layoutFull, layoutTKL } from '../../src/geometry/layouts';
import type { KeyDef } from '../../src/types/keyboard';

describe('reference layouts', () => {
  it('have the expected key counts and widths', () => {
    expect(layout40().keyCount).toBe(42);
    expect(layout60().keyCount).toBe(61);
    expect(layout60().widthU).toBeCloseTo(15, 6);
    expect(layout65().keyCount).toBe(68);
    expect(layout65().widthU).toBeCloseTo(16, 6);
    expect(layout75().keyCount).toBe(84);
    expect(layout75().widthU).toBeCloseTo(16, 6);
    expect(layoutTKL().keyCount).toBe(87);
    expect(layoutTKL().widthU).toBeCloseTo(18.25, 6);
    expect(layoutFull().keyCount).toBe(104);
    expect(layoutFull().widthU).toBeCloseTo(22.5, 6);
  });

  it('every row of 60/65/75 spans the full width without overlaps', () => {
    for (const l of [layout60(), layout65(), layout75()]) {
      const rows = new Map<number, KeyDef[]>();
      l.keys.forEach((k) => rows.set(k.y, [...(rows.get(k.y) ?? []), k]));
      for (const keys of rows.values()) {
        const sorted = [...keys].sort((a, b) => a.x - b.x);
        sorted.forEach((k, i) => {
          if (i > 0) {
            const prev = sorted[i - 1] as KeyDef;
            expect(k.x + 1e-9).toBeGreaterThanOrEqual(prev.x + prev.width);
          }
        });
      }
    }
  });

  it('buildLayout returns null for layouts without a reference map', () => {
    expect(buildLayout('Alice')).toBeNull();
    expect(buildLayout('65%')?.name).toBe('65%');
  });
});

describe('layout detection from key maps', () => {
  it.each([
    ['40%', layout40()],
    ['60%', layout60()],
    ['65%', layout65()],
    ['75%', layout75()],
    ['TKL', layoutTKL()],
    ['Full Size', layoutFull()],
  ] as const)('detects %s', (name, layout) => {
    const d = detectLayout(layout.keys);
    expect(d.layout).toBe(name);
    expect(d.confidence).toBeGreaterThan(0.6);
    expect(d.reasons.length).toBeGreaterThan(0);
  });

  it('flags rotated boards as Alice-like', () => {
    const keys = layout65().keys.map((k, i) => ({ ...k, rotation: i % 2 ? 12 : -12 }));
    expect(detectLayout(keys).layout).toBe('Alice');
  });

  it('flags a central gap as Split', () => {
    const keys: KeyDef[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 12; c++) {
        keys.push({ x: c < 6 ? c : c + 3, y: r, width: 1, height: 1, rotation: 0, label: 'x', row: r, keycapSize: '1u' });
      }
    }
    expect(detectLayout(keys).layout).toBe('Split');
  });

  it('lowers confidence when the spec text disagrees', () => {
    const agree = detectLayout(layout65().keys, '65% layout');
    const disagree = detectLayout(layout65().keys, '75% layout');
    expect(agree.confidence).toBeGreaterThan(disagree.confidence);
  });

  it('empty key map is Custom with zero confidence', () => {
    expect(detectLayout([]).confidence).toBe(0);
  });
});

describe('layout detection from text', () => {
  it.each([
    ['Keychron 65% wireless', '65%'],
    ['A 75% gasket board', '75%'],
    ['Tenkeyless (87 keys)', 'TKL'],
    ['Full-size 104-key', 'Full Size'],
    ['60% hot-swap', '60%'],
    ['Alice layout', 'Alice'],
  ])('%s → %s', (text, expected) => {
    expect(detectLayoutFromText(text).layout).toBe(expected);
  });

  it('is honest when nothing matches', () => {
    const d = detectLayoutFromText('Great keyboard!');
    expect(d.layout).toBe('Custom');
    expect(d.confidence).toBe(0);
  });
});
