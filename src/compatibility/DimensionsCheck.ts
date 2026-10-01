import type { CheckResult, Dimensions, Tolerances } from '../types/keyboard';
import { check, fmt } from './common';

/**
 * Coarse bounding-box test: can the inner part fit inside the outer one at all?
 * This is only a *necessary* condition (never a sufficient one) — the outline
 * and clearance checks do the real work.
 */
export function checkDimensions(
  inner: Dimensions | undefined,
  outer: Dimensions | undefined,
  innerName: string,
  outerName: string,
  tol: Tolerances,
): CheckResult {
  if (!inner || !outer || !inner.width || !outer.width) {
    return check('dimensions', 'Dimensions', 'unknown', `Missing dimensions for ${innerName} or ${outerName}.`);
  }
  const dw = outer.width - inner.width;
  const dd = outer.depth - inner.depth;
  const worst = Math.min(dw, dd);
  if (worst < 0) {
    return check(
      'dimensions',
      'Dimensions',
      'fail',
      `${innerName} (${inner.width}×${inner.depth}) is larger than ${outerName} (${outer.width}×${outer.depth}).`,
      { valueMm: worst },
    );
  }
  if (worst < 2 * tol.tightClearanceMm) {
    return check('dimensions', 'Dimensions', 'warn', `Only ${fmt(worst)} of total slack between bounding boxes.`, { valueMm: worst });
  }
  return check('dimensions', 'Dimensions', 'ok', `${innerName} fits in the bounding box with ${fmt(dw)} × ${fmt(dd)} of slack.`, {
    valueMm: worst,
  });
}
