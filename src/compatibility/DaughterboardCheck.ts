import { polygonsOverlap, translatePoints } from '../geometry/shape';
import type { Case, CheckResult, Daughterboard, PCB, Placement, Tolerances } from '../types/keyboard';
import { check, fmt } from './common';
import { checkUsbAlignment } from './USBAlignmentCheck';

export interface DaughterboardOutcome {
  checks: CheckResult[];
  /** Daughterboard → case translation (when the case defines a bay). */
  placement?: Placement;
}

/** Where the daughterboard sits: centred along the bay's width, flush with the bay's back edge. */
export function daughterboardPlacement(db: Daughterboard, c: Case): Placement | undefined {
  const area = c.daughterboardArea;
  if (!area) return undefined;
  return {
    dx: area.x + (area.width - db.dimensions.width) / 2,
    dy: area.y,
    method: 'manual',
    matched: 0,
    total: 0,
    residual: 0,
  };
}

/**
 * Daughterboard checks:
 *  - connector on the PCB header matches the daughterboard connector,
 *  - the board fits in the bay the case reserves for it,
 *  - the daughterboard does not overlap the PCB footprint,
 *  - its USB receptacle lines up with the case cutout.
 */
export function checkDaughterboard(
  db: Daughterboard,
  pcb: PCB | undefined,
  pcbPlacement: Placement | undefined,
  c: Case | undefined,
  tol: Tolerances,
): DaughterboardOutcome {
  const checks: CheckResult[] = [];

  if (pcb) {
    if (!pcb.daughterboard) {
      checks.push(
        pcb.usbPort
          ? check('daughterboard', 'Daughterboard', 'fail', 'This PCB has its own USB port and no daughterboard header.')
          : check('daughterboard', 'Daughterboard', 'unknown', 'The PCB does not say whether it supports a daughterboard.'),
      );
    } else if (!pcb.daughterboard.connectorType || !db.connectorType) {
      checks.push(check('daughterboard', 'Daughterboard', 'unknown', 'Connector type is missing on the PCB or the daughterboard.'));
    } else if (pcb.daughterboard.connectorType === db.connectorType) {
      checks.push(check('daughterboard', 'Daughterboard', 'ok', `Connector "${db.connectorType}" matches the PCB header.`));
    } else {
      checks.push(
        check(
          'daughterboard',
          'Daughterboard',
          'fail',
          `Connector mismatch: PCB expects "${pcb.daughterboard.connectorType}", daughterboard has "${db.connectorType}".`,
        ),
      );
    }
  }

  if (!c) return { checks };
  const placement = daughterboardPlacement(db, c);
  const area = c.daughterboardArea;
  if (!area || !placement) {
    checks.push(check('daughterboard', 'Daughterboard bay', 'unknown', 'The case does not define a daughterboard area.'));
    checks.push(checkUsbAlignment(db.usbPort, 0, 0, c, 'Daughterboard', tol, 'Position unknown: no daughterboard area in the case.'));
    return { checks };
  }

  const slackX = area.width - db.dimensions.width;
  const slackY = area.depth - db.dimensions.depth;
  const worst = Math.min(slackX, slackY);
  if (worst < 0) {
    checks.push(
      check(
        'daughterboard',
        'Daughterboard bay',
        'fail',
        `Daughterboard (${db.dimensions.width}×${db.dimensions.depth}) does not fit the bay (${area.width}×${area.depth}).`,
        { valueMm: worst, region: { x: area.x + area.width / 2, y: area.y + area.depth / 2 } },
      ),
    );
  } else if (worst < tol.tightClearanceMm) {
    checks.push(check('daughterboard', 'Daughterboard bay', 'warn', `Only ${fmt(worst)} of slack in the daughterboard bay.`, { valueMm: worst }));
  } else {
    checks.push(check('daughterboard', 'Daughterboard bay', 'ok', `Fits the bay with ${fmt(worst)} of slack.`, { valueMm: worst }));
  }

  if (pcb && pcbPlacement) {
    const dbPts = translatePoints(db.outline.points, placement.dx, placement.dy);
    const pcbPts = translatePoints(pcb.outline.points, pcbPlacement.dx, pcbPlacement.dy);
    if (polygonsOverlap(dbPts, pcbPts)) {
      checks.push(
        check('collision', 'Collision', 'fail', 'The daughterboard footprint overlaps the PCB.', {
          region: { x: placement.dx + db.dimensions.width / 2, y: placement.dy + db.dimensions.depth / 2 },
        }),
      );
    }
  }

  checks.push(checkUsbAlignment(db.usbPort, placement.dx, placement.dy, c, 'Daughterboard', tol));
  return { checks, placement };
}
