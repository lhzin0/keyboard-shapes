import { describe, expect, it } from 'vitest';
import {
  evaluateBuild,
  evaluateDaughterboard,
  evaluatePcbCase,
  evaluatePlatePcb,
  findCompatible,
} from '../../src/compatibility/CompatibilityEngine';
import { checkUsbAlignment } from '../../src/compatibility/USBAlignmentCheck';
import { buildReferenceDatabase } from '../../src/geometry/reference';
import { DEFAULT_TOLERANCES } from '../../src/types/keyboard';
import type { Case, PCB } from '../../src/types/keyboard';

const db = buildReferenceDatabase();
const get = <T extends { id: string }>(list: T[], id: string): T => {
  const f = list.find((x) => x.id === id);
  if (!f) throw new Error(`fixture ${id} missing`);
  return f;
};
const status = (r: { checks: { id: string; status: string }[] }, id: string) =>
  r.checks.find((c) => c.id === id)?.status;

describe('compatibility scenarios (deterministic)', () => {
  const caseA = get(db.cases, 'ref-65-case-a');
  const caseB = get(db.cases, 'ref-65-case-b');
  const caseC = get(db.cases, 'ref-65-case-c');
  const pcbA = get(db.pcbs, 'ref-65-pcb-a');
  const pcbB = get(db.pcbs, 'ref-65-pcb-b');
  const plateA = get(db.plates, 'ref-65-plate-a');
  const plateB = get(db.plates, 'ref-65-plate-b');
  const dbA = get(db.daughterboards, 'ref-daughterboard-a');
  const dbB = get(db.daughterboards, 'ref-daughterboard-b');

  it('Case A + PCB A → compatible', () => {
    const r = evaluatePcbCase(pcbA, caseA);
    expect(status(r, 'mounting')).toBe('ok');
    expect(status(r, 'clearance')).toBe('ok');
    expect(status(r, 'dimensions')).toBe('ok');
    expect(r.placement?.method).toBe('mounting');
    expect(r.verdict).not.toBe('incompatible');
  });

  it('Case A + PCB B → incompatible (hole pattern differs)', () => {
    const r = evaluatePcbCase(pcbB, caseA);
    expect(status(r, 'mounting')).toBe('fail');
    expect(r.verdict).toBe('incompatible');
  });

  it('Case B + PCB A → insufficient clearance', () => {
    const r = evaluatePcbCase(pcbA, caseB);
    expect(status(r, 'mounting')).toBe('ok'); // same posts, so the PCB registers…
    expect(status(r, 'clearance')).toBe('fail'); // …but the underside hits the shallow floor
    expect(r.verdict).toBe('incompatible');
  });

  it('PCB A + Plate B → mounting incompatible', () => {
    const r = evaluatePlatePcb(plateB, pcbA);
    expect(status(r, 'plate')).toBe('ok'); // cutouts match: same layout
    expect(status(r, 'mounting')).toBe('fail');
    expect(r.verdict).toBe('incompatible');
  });

  it('PCB A + Plate A → compatible', () => {
    const r = evaluatePlatePcb(plateA, pcbA);
    expect(r.checks.every((c) => c.status === 'ok')).toBe(true);
    expect(r.verdict).toBe('compatible');
  });

  it('Daughterboard A fits PCB A and Case A, USB aligned', () => {
    const r = evaluateBuild({ case: caseA, pcb: pcbA, daughterboard: dbA });
    expect(r.summary.find((c) => c.id === 'daughterboard')?.status).toBe('ok');
    expect(r.summary.find((c) => c.id === 'usb')?.status).toBe('ok');
  });

  it('Daughterboard B → incompatible connector', () => {
    const r = evaluateDaughterboard(dbB, pcbA, caseA);
    expect(status(r, 'daughterboard')).toBe('fail');
  });

  it('Case C → USB misaligned', () => {
    const r = evaluateBuild({ case: caseC, pcb: pcbA, daughterboard: dbA });
    expect(r.summary.find((c) => c.id === 'usb')?.status).toBe('fail');
    expect(r.verdict).toBe('incompatible');
  });

  it('is deterministic', () => {
    const a = JSON.stringify(evaluateBuild({ case: caseA, pcb: pcbA, plate: plateA, daughterboard: dbA }));
    const b = JSON.stringify(evaluateBuild({ case: caseA, pcb: pcbA, plate: plateA, daughterboard: dbA }));
    expect(a).toBe(b);
  });

  it('a full compatible build is verdict compatible', () => {
    const sw = db.switches[0];
    const r = evaluateBuild({ case: caseA, pcb: pcbA, plate: plateA, daughterboard: dbA, switch: sw });
    expect(r.summary.filter((c) => c.status !== 'ok')).toEqual([]);
    expect(r.verdict).toBe('compatible');
    expect(r.collisions).toEqual([]);
  });

  it('collisions are reported with a location', () => {
    const r = evaluateBuild({ case: caseB, pcb: pcbA });
    expect(r.collisions.length).toBeGreaterThan(0);
    expect(r.collisions[0]?.at).toBeDefined();
  });
});

describe('unknown is never compatible', () => {
  const caseA = get(db.cases, 'ref-60-case-a');
  const pcbA = get(db.pcbs, 'ref-60-pcb-a');

  it('missing mounting data → unknown mounting, verdict partial or unknown', () => {
    const stripped: PCB = { ...pcbA, mountingPoints: [] };
    const r = evaluatePcbCase(stripped, caseA);
    expect(status(r, 'mounting')).toBe('unknown');
    expect(['partial', 'unknown']).toContain(r.verdict);
    expect(r.verdict).not.toBe('compatible');
  });

  it('missing cutout data → USB unknown', () => {
    const noCut: Case = { ...caseA, cutouts: [] };
    const r = evaluatePcbCase(pcbA, noCut);
    expect(status(r, 'usb')).toBe('unknown');
    expect(r.verdict).toBe('partial');
  });

  it('almost no data → never compatible', () => {
    const r = evaluatePcbCase(
      { ...pcbA, mountingPoints: [], usbPort: undefined, undersideHeight: undefined },
      { ...caseA, mountingPoints: [], cutouts: [], internalCavity: undefined, clearance: undefined },
    );
    expect(r.verdict).not.toBe('compatible');
  });
});

describe('USB alignment thresholds', () => {
  const c = get(db.cases, 'ref-60-case-a');
  const cut = c.cutouts[0];
  if (!cut) throw new Error('fixture has no cutout');
  const port = (x: number) => ({ x, y: 2, width: 8.94, facing: 'back' as const });
  it('aligned / tight / misaligned / wrong wall / unknown', () => {
    expect(checkUsbAlignment(port(cut.center), 0, 0, c, 'PCB', DEFAULT_TOLERANCES).status).toBe('ok');
    // cutout 12 wide, port 8.94 → 1.53 mm of room; margin 0.5 → tight between 1.03 and 1.53
    expect(checkUsbAlignment(port(cut.center + 1.3), 0, 0, c, 'PCB', DEFAULT_TOLERANCES).status).toBe('warn');
    expect(checkUsbAlignment(port(cut.center + 3), 0, 0, c, 'PCB', DEFAULT_TOLERANCES).status).toBe('fail');
    expect(checkUsbAlignment({ ...port(cut.center), facing: 'left' }, 0, 0, c, 'PCB', DEFAULT_TOLERANCES).status).toBe('fail');
    expect(checkUsbAlignment(undefined, 0, 0, c, 'PCB', DEFAULT_TOLERANCES).status).toBe('unknown');
  });
});

describe('reverse search', () => {
  it('finds compatible cases for a PCB and ranks compatible ones first', () => {
    const groups = findCompatible({ type: 'pcb', id: 'ref-65-pcb-a' }, db);
    const cases = groups.find((g) => g.type === 'case');
    expect(cases).toBeDefined();
    const best = cases?.matches[0];
    expect(best?.item.id).toBe('ref-65-case-a');
    expect(best?.result.verdict).not.toBe('incompatible');
    // a case for a different layout is never compatible
    const sixty = cases?.matches.find((m) => m.item.id === 'ref-60-case-a');
    expect(sixty?.result.verdict).toBe('incompatible');
  });

  it('finds PCBs for a plate', () => {
    const groups = findCompatible({ type: 'plate', id: 'ref-65-plate-a' }, db);
    const pcbs = groups.find((g) => g.type === 'pcb');
    expect(pcbs?.matches[0]?.item.id).toBe('ref-65-pcb-a');
  });
});

describe('reference dataset sanity', () => {
  it('every default keyboard build verifies as fully ok', () => {
    for (const kb of db.keyboards) {
      const r = evaluateBuild({
        case: get(db.cases, kb.components.caseId as string),
        pcb: get(db.pcbs, kb.components.pcbId as string),
        plate: get(db.plates, kb.components.plateId as string),
        daughterboard: kb.components.daughterboardId ? get(db.daughterboards, kb.components.daughterboardId) : undefined,
        switch: db.switches[0],
      });
      expect(r.summary.filter((c) => c.status !== 'ok').map((c) => `${kb.id}:${c.id}:${c.summary}`)).toEqual([]);
    }
  });
});
