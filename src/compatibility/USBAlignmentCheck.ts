import type { Case, CheckResult, Cutout, PortPosition, Tolerances, Wall } from '../types/keyboard';
import { check, fmt } from './common';

/** Coordinate of a point along a wall: x for front/back walls, y for left/right walls. */
export function alongWall(wall: Wall, p: { x: number; y: number }): number {
  return wall === 'front' || wall === 'back' ? p.x : p.y;
}

/**
 * Is the USB receptacle centred in the case's USB cutout?
 *
 * `dx/dy` translate the port owner (PCB or daughterboard) into the case frame.
 *  ✓ aligned    : receptacle edge keeps `usbMarginMm` from the cutout edge
 *  ⚠ tight      : fits but with less margin
 *  ✕ misaligned : receptacle overlaps the wall, or faces the wrong wall
 *  ? unknown    : no port or no cutout recorded
 */
export function checkUsbAlignment(
  port: PortPosition | undefined,
  dx: number,
  dy: number,
  c: Case,
  ownerName: string,
  tol: Tolerances,
  assumption?: string,
): CheckResult {
  if (!port) return check('usb', 'USB', 'unknown', `${ownerName} has no USB port recorded.`);
  const usbCutouts: Cutout[] = c.cutouts.filter((cu) => cu.kind === 'usb');
  if (usbCutouts.length === 0) return check('usb', 'USB', 'unknown', 'The case has no USB cutout recorded.');

  const onWall = usbCutouts.filter((cu) => cu.wall === port.facing);
  const details = assumption ? [assumption] : undefined;
  if (onWall.length === 0) {
    return check('usb', 'USB', 'fail', `The port faces the ${port.facing} wall but the case cutout is on the ${usbCutouts[0]?.wall} wall.`, { details });
  }

  const world = { x: port.x + dx, y: port.y + dy };
  const u = alongWall(port.facing, world);
  // choose the closest cutout on that wall
  let best = onWall[0] as Cutout;
  for (const cu of onWall) if (Math.abs(cu.center - u) < Math.abs(best.center - u)) best = cu;

  const offset = Math.abs(best.center - u);
  const room = best.width / 2 - port.width / 2; // how far the port can drift before touching the edge
  const region = port.facing === 'front' || port.facing === 'back' ? { x: best.center, y: world.y } : { x: world.x, y: best.center };

  if (room < 0) {
    return check('usb', 'USB', 'fail', `The USB receptacle (${fmt(port.width)}) is wider than the case cutout (${fmt(best.width)}).`, {
      valueMm: room,
      region,
      details,
    });
  }
  if (offset > room) {
    return check('usb', 'USB', 'fail', `Misaligned: receptacle centre is ${fmt(offset)} off the cutout centre (max ${fmt(room)}).`, {
      valueMm: room - offset,
      region,
      details,
    });
  }
  if (offset > room - tol.usbMarginMm) {
    return check('usb', 'USB', 'warn', `Tight: ${fmt(offset)} off-centre, ${fmt(room - offset)} left before touching the cutout edge.`, {
      valueMm: room - offset,
      region,
      details,
    });
  }
  return check('usb', 'USB', 'ok', `Aligned: ${fmt(offset)} off-centre, ${fmt(room - offset)} of margin to the cutout edge.`, {
    valueMm: room - offset,
    region,
    details,
  });
}
