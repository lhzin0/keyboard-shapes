import { registerPoints, toPlacement } from '../geometry/registration';
import type { CheckResult, MountingPoint, Placement, Tolerances } from '../types/keyboard';
import { check, fmt } from './common';

export interface MountingOutcome {
  result: CheckResult;
  placement?: Placement;
}

/**
 * Do all mounting points of `moving` land on a mounting point of `fixed`?
 *
 * The relative position of the two parts is not known up front, so the
 * translation that maximises coincident points is searched (see registration.ts).
 * Every point of the moving part must match — a PCB with a hole that has no
 * post underneath is not compatible, even if most holes line up.
 */
export function checkMounting(
  moving: readonly MountingPoint[],
  fixed: readonly MountingPoint[],
  movingName: string,
  fixedName: string,
  tol: Tolerances,
  label = 'Mounting',
): MountingOutcome {
  if (moving.length === 0 || fixed.length === 0) {
    return {
      result: check('mounting', label, 'unknown', `No mounting points recorded for ${moving.length === 0 ? movingName : fixedName}.`),
    };
  }
  const reg = registerPoints(moving, fixed, tol.mountingMm);
  if (!reg) return { result: check('mounting', label, 'unknown', 'Could not register mounting points.') };
  const placement = toPlacement(reg, 'mounting');
  if (reg.matched === reg.total) {
    return {
      placement,
      result: check(
        'mounting',
        label,
        'ok',
        `All ${reg.total} mounting points of ${movingName} coincide with ${fixedName} (worst error ${fmt(reg.residual)}, tolerance ${fmt(tol.mountingMm)}).`,
        { valueMm: reg.residual },
      ),
    };
  }
  const missing = moving.filter((_, i) => reg.pairs[i] === -1).map((p) => p.id);
  return {
    placement,
    result: check(
      'mounting',
      label,
      'fail',
      `Only ${reg.matched} of ${reg.total} mounting points coincide within ${fmt(tol.mountingMm)}.`,
      { details: [`No match for: ${missing.join(', ')}`] },
    ),
  };
}
