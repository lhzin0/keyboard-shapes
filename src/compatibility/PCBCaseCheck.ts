import { boundsCenter, boundsOf } from '../geometry/shape';
import type { Case, CheckResult, PCB, Placement, Point2D, Tolerances } from '../types/keyboard';
import { checkBottomClearance, checkLateralClearance, mergeChecks } from './ClearanceCheck';
import { checkDimensions } from './DimensionsCheck';
import { checkMounting } from './MountingCheck';
import { checkUsbAlignment } from './USBAlignmentCheck';

export interface PcbCaseOutcome {
  checks: CheckResult[];
  placement: Placement;
}

/** Fallback when mounting cannot place a part: centre its bounding box in the outer one. */
export function centerPlacement(inner: { points: Point2D[] }, outer: { points: Point2D[] }): Placement {
  const a = boundsCenter(boundsOf(inner.points));
  const b = boundsCenter(boundsOf(outer.points));
  return { dx: b.x - a.x, dy: b.y - a.y, method: 'center', matched: 0, total: 0, residual: 0 };
}

export function checkPcbInCase(pcb: PCB, c: Case, tol: Tolerances): PcbCaseOutcome {
  const checks: CheckResult[] = [];
  const cavity = c.internalCavity;

  checks.push(
    checkDimensions(
      pcb.dimensions,
      cavity ? { width: cavity.width, depth: cavity.depth } : c.dimensions,
      'PCB',
      cavity ? 'the case cavity' : 'the case',
      tol,
    ),
  );

  const mount = checkMounting(pcb.mountingPoints, c.mountingPoints, 'PCB', 'the case', tol);
  checks.push(mount.result);

  let placement = mount.placement && mount.placement.matched === mount.placement.total ? mount.placement : undefined;
  let assumption: string | undefined;
  if (!placement) {
    // we do not know where the PCB sits: assume centred and say so
    placement = cavity
      ? centerPlacement(pcb.outline, cavity)
      : { dx: 0, dy: 0, method: 'center', matched: 0, total: 0, residual: 0 };
    assumption = 'Position assumed (PCB centred in the cavity) because the mounting points did not register.';
  }

  checks.push(
    mergeChecks('clearance', 'Clearance', [
      checkLateralClearance(pcb.outline, cavity, placement.dx, placement.dy, 'PCB', tol, assumption),
      checkBottomClearance(c, pcb, tol),
    ]),
  );

  if (pcb.usbPort) {
    checks.push(checkUsbAlignment(pcb.usbPort, placement.dx, placement.dy, c, 'PCB', tol, assumption));
  }
  return { checks, placement };
}
