import { matchAt, registerPoints, toPlacement } from '../geometry/registration';
import type { CheckResult, MountingPoint, PCB, Placement, Plate, Tolerances } from '../types/keyboard';
import { check, fmt } from './common';

export interface PlateOutcome {
  checks: CheckResult[];
  /** Plate → PCB translation (found from the switch cutouts). */
  placement?: Placement;
}

/**
 * Can this plate be used with this PCB?
 *  1. Every PCB switch has a plate cutout on top of it (this also fixes the relative position).
 *  2. Stabilizer cutouts line up where the PCB expects stabilizers.
 *  3. The plate screw holes land on PCB mounting holes.
 */
export function checkPlateOnPcb(plate: Plate, pcb: PCB, tol: Tolerances): PlateOutcome {
  const checks: CheckResult[] = [];
  if (plate.switchCutouts.length === 0 || pcb.switchPositions.length === 0) {
    checks.push(check('plate', 'Plate', 'unknown', 'Switch positions are missing on the plate or the PCB.'));
    return { checks };
  }

  // register PCB switches onto plate cutouts, then express the result as plate → PCB
  const reg = registerPoints(pcb.switchPositions, plate.switchCutouts, tol.cutoutMm);
  if (!reg) {
    checks.push(check('plate', 'Plate', 'unknown', 'Could not register switch positions.'));
    return { checks };
  }
  // pcb + (dx,dy) = plate  ⇒  plate + (−dx,−dy) = pcb
  const placement = toPlacement({ ...reg, dx: -reg.dx, dy: -reg.dy }, 'switches');

  if (reg.matched === reg.total) {
    checks.push(
      check('plate', 'Plate', 'ok', `All ${reg.total} PCB switches have a plate cutout (worst error ${fmt(reg.residual)}).`, {
        valueMm: reg.residual,
      }),
    );
  } else {
    checks.push(
      check('plate', 'Plate', 'fail', `Only ${reg.matched} of ${reg.total} PCB switch positions have a matching plate cutout.`, {
        details: ['The plate was cut for a different layout or spacing.'],
      }),
    );
  }

  // stabilizers
  const pcbStabs = pcb.stabilizerPositions;
  const plateStabs = plate.stabilizerCutouts;
  if (pcbStabs && pcbStabs.length > 0) {
    if (!plateStabs) {
      checks.push(check('plate', 'Plate stabilizers', 'unknown', 'Plate stabilizer cutouts are not recorded.'));
    } else {
      const m = matchAt(pcbStabs, plateStabs, reg.dx, reg.dy, tol.cutoutMm);
      const spacingOk = pcbStabs.every((s) => {
        const j = plateStabs.findIndex((p) => Math.hypot(p.x - (s.x + reg.dx), p.y - (s.y + reg.dy)) <= tol.cutoutMm);
        return j >= 0 && Math.abs((plateStabs[j]?.spacing ?? 0) - s.spacing) <= 0.5;
      });
      checks.push(
        m.matched === m.total && spacingOk
          ? check('plate', 'Plate stabilizers', 'ok', `${m.total} stabilizer cutouts coincide with the PCB.`)
          : check('plate', 'Plate stabilizers', 'fail', `${m.total - m.matched} stabilizer positions have no matching plate cutout (or the wire spacing differs).`),
      );
    }
  }

  // mounting holes under the switch-derived alignment
  const holes: readonly MountingPoint[] = plate.mountingPoints;
  if (holes.length === 0 || pcb.mountingPoints.length === 0) {
    checks.push(check('mounting', 'Mounting', 'unknown', 'Plate or PCB mounting holes are not recorded.'));
  } else {
    const m = matchAt(holes, pcb.mountingPoints, -reg.dx, -reg.dy, tol.mountingMm);
    checks.push(
      m.matched === m.total
        ? check('mounting', 'Mounting', 'ok', `All ${m.total} plate screw holes coincide with PCB holes (worst error ${fmt(m.residual)}).`, { valueMm: m.residual })
        : check('mounting', 'Mounting', 'fail', `${m.total - m.matched} of ${m.total} plate screw holes have no PCB hole beneath them.`, {
            details: holes.filter((_, i) => m.pairs[i] === -1).map((h) => `No PCB hole under ${h.id}`),
          }),
    );
  }
  return { checks, placement };
}
