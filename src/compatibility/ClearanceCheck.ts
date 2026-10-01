import { containment, translatePoints } from '../geometry/shape';
import type { Case, CheckResult, CheckStatus, PCB, Plate, Point2D, Shape, Switch, Tolerances } from '../types/keyboard';
import { check, fmt } from './common';

const RANK: Record<CheckStatus, number> = { ok: 0, warn: 1, unknown: 2, fail: 3 };

/** Merge several partial checks into one (fail > unknown > warn > ok). */
export function mergeChecks(id: CheckResult['id'], label: string, parts: CheckResult[]): CheckResult {
  if (parts.length === 0) return check(id, label, 'unknown', 'No data.');
  const worst = parts.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a));
  const numbers = parts.map((p) => p.valueMm).filter((v): v is number => v !== undefined);
  return {
    id,
    label,
    status: worst.status,
    summary: parts.map((p) => p.summary).join(' '),
    valueMm: numbers.length ? Math.min(...numbers) : undefined,
    region: parts.find((p) => p.status === worst.status && p.region)?.region,
    details: parts.flatMap((p) => p.details ?? []),
  };
}

/**
 * Lateral gap between a placed part and the case cavity.
 * `placed` must already be expressed in the case frame.
 */
export function checkLateralClearance(
  placed: Shape | undefined,
  cavity: Shape | undefined,
  dx: number,
  dy: number,
  partName: string,
  tol: Tolerances,
  assumption?: string,
): CheckResult {
  if (!placed || !cavity) {
    return check('clearance', 'Clearance', 'unknown', `No ${!cavity ? 'internal cavity' : 'outline'} data for the lateral clearance of ${partName}.`);
  }
  const pts = translatePoints(placed.points, dx, dy);
  const res = containment(pts, cavity.points);
  const note = assumption ? [assumption] : undefined;
  if (!res.contained) {
    return check('clearance', 'Clearance', 'fail', `${partName} penetrates the case wall by ${fmt(-res.clearance)}.`, {
      valueMm: res.clearance,
      region: res.at,
      details: note,
    });
  }
  if (res.clearance < tol.tightClearanceMm) {
    return check('clearance', 'Clearance', 'warn', `${partName} is only ${fmt(res.clearance)} from the case wall.`, {
      valueMm: res.clearance,
      region: res.at,
      details: note,
    });
  }
  return check('clearance', 'Clearance', 'ok', `${partName} keeps ${fmt(res.clearance)} from the case wall.`, {
    valueMm: res.clearance,
    region: res.at,
    details: note,
  });
}

/** Free height below the PCB versus the tallest component soldered on its underside. */
export function checkBottomClearance(c: Case, pcb: PCB, tol: Tolerances): CheckResult {
  const floorToPcb = c.clearance?.floorToPcb;
  if (floorToPcb === undefined || pcb.undersideHeight === undefined) {
    return check(
      'clearance',
      'Clearance',
      'unknown',
      `Bottom clearance unknown: ${floorToPcb === undefined ? 'case floor-to-PCB distance' : 'PCB underside component height'} not recorded.`,
    );
  }
  const gap = floorToPcb - pcb.undersideHeight;
  if (gap < 0) {
    return check('clearance', 'Clearance', 'fail', `PCB underside components (${fmt(pcb.undersideHeight)}) collide with the case floor — only ${fmt(floorToPcb)} available.`, {
      valueMm: gap,
    });
  }
  if (gap < tol.tightClearanceMm / 2) {
    return check('clearance', 'Clearance', 'warn', `Only ${fmt(gap)} between the PCB underside components and the case floor.`, { valueMm: gap });
  }
  return check('clearance', 'Clearance', 'ok', `${fmt(gap)} between the PCB underside components and the case floor.`, { valueMm: gap });
}

/**
 * Vertical stack: floor → PCB → switch → plate against the case rim.
 * Heights are measured along the tilted axis of the case (the typing angle does not change them).
 */
export function checkTopStack(c: Case, pcb: PCB, plate: Plate, sw: Switch): CheckResult {
  const floorToPcb = c.clearance?.floorToPcb;
  const pcbT = pcb.thickness;
  if (floorToPcb === undefined || pcbT === undefined || c.frontHeight === undefined || c.floorThickness === undefined) {
    return check('clearance', 'Clearance', 'unknown', 'Case/PCB heights incomplete — vertical stack not verified.');
  }
  const cosA = Math.cos(((c.angle ?? 0) * Math.PI) / 180);
  const rimAboveFloor = c.frontHeight / cosA - c.floorThickness;
  const plateTop = floorToPcb + pcbT + sw.plateToPcb + plate.thickness;
  const delta = rimAboveFloor - plateTop;
  if (delta < -0.5) {
    return check('clearance', 'Clearance', 'warn', `Plate surface sits ${fmt(-delta)} above the case rim with this switch.`, { valueMm: delta });
  }
  return check('clearance', 'Clearance', 'ok', `Plate surface sits ${fmt(Math.max(delta, 0))} below the case rim.`, { valueMm: delta });
}

export type { Point2D };
