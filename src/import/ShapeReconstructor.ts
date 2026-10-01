/**
 * ShapeReconstructor — image → millimetre outline.
 *
 *   image
 *     ↓ downscale (speed)
 *     ↓ background removal      (alpha, or colour distance to the border colour + Otsu)
 *     ↓ object detection        (largest connected component)
 *     ↓ contour detection       (Moore tracing of the silhouette)
 *     ↓ perspective correction  (optional homography of the 4 outer corners)
 *     ↓ simplification          (Douglas–Peucker)
 *     ↓ dimension calibration   scale = knownMm / measuredPx
 *     ↓ Shape (mm)
 *
 * The calibration is mandatory: a picture alone carries no scale. A single known
 * dimension fixes the scale; supplying both width and depth also lets us verify the
 * aspect ratio and warn when the photo is distorted.
 *
 * Output is `reconstructed` precision at best — never "official".
 */
import type { ConfidenceInfo, MountingPoint, Point2D, Profile, Shape } from '../types/keyboard';
import { makeShape, offsetPolygon, round, simplifyPolygon, simplifyPolyline } from '../geometry/shape';
import { traceContour, quadFromContour, rectifyPoints, type Quad } from './vision/geometry';
import { downscale, fillHoles, findHoles, largestComponent, openMask, rimColor, segment, smooth, trimProtrusions, type ImageLike, type Mask } from './vision/mask';

export interface ReconstructOptions {
  /** Real width (left-right extent) of the object in mm. */
  knownWidthMm?: number;
  /** Real depth (front-back extent) in mm. */
  knownDepthMm?: number;
  perspective?: 'none' | 'auto' | Quad;
  /**
   * A published depth to *verify* the result against (does not change the scale). A reconstructed outline
   * whose depth contradicts it by more than 15% is rejected: the image is not a clean top view.
   */
  expectedDepthMm?: number;
  /**
   * Remove attachments thinner than this (mm) before measuring: strap mounts, cable tabs, hooks. Applied to the
   * silhouette with a disk, so rounded corners of the body (radius ≥ half of this) are preserved.
   */
  removeThinFeaturesMm?: number;
  /**
   * Cut back stretches that stick out of the body's straight edge by more than this many mm (strap mounts, hooks glued
   * to a side). Only short stretches (≤ 40% of a side) are treated as protrusions.
   */
  trimProtrusionsMm?: number;
  /** Douglas–Peucker tolerance in mm. */
  simplifyMm?: number;
  /** Longest side used for processing. */
  maxSize?: number;
  /** Override the automatic colour-distance threshold. */
  threshold?: number;
}

export interface DetectedHole {
  x: number;
  y: number;
  diameter: number;
  circularity: number;
}

export interface ReconstructResult {
  shape: Shape;
  /** Millimetres per processed pixel (x, y). */
  scale: { x: number; y: number };
  holes: DetectedHole[];
  confidence: ConfidenceInfo;
  steps: string[];
  warnings: string[];
  /** Silhouette used, for debugging overlays. */
  mask: Mask;
  /** Colour of the object's rim (the case), `#rrggbb`; null when it could not be measured. */
  rimColor: string | null;
}

/** The image produced a result that contradicts what is already known — better no outline than a wrong one. */
export class ReconstructionRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconstructionRejected';
  }
}

export class CalibrationError extends Error {
  constructor(message = 'A known width or depth (mm) is required to calibrate the image.') {
    super(message);
    this.name = 'CalibrationError';
  }
}

export function reconstructShape(source: ImageLike, opts: ReconstructOptions = {}): ReconstructResult {
  if (!opts.knownWidthMm && !opts.knownDepthMm) throw new CalibrationError();
  const steps: string[] = [];
  const warnings: string[] = [];

  const { image, factor } = downscale(source, opts.maxSize ?? 1024);
  if (factor > 1) steps.push(`downscaled ${source.width}×${source.height} → ${image.width}×${image.height}`);

  const seg = segment(image, { threshold: opts.threshold });
  steps.push(`background removed (${seg.method}, threshold ${seg.threshold.toFixed(0)})`);

  const object = largestComponent(smooth(seg.mask));
  if (!object) throw new Error('No object found: the image has no region different from its background.');
  const holesPx = findHoles(object.mask);
  let silhouette = fillHoles(object.mask);
  // coverage of the *filled* silhouette: a dark case around a plate that resembles the background is not "tiny"
  let filledArea = 0;
  for (let i = 0; i < silhouette.data.length; i++) filledArea += silhouette.data[i] as number;
  const coverage = filledArea / (image.width * image.height);
  steps.push(`object detected (${(coverage * 100).toFixed(0)}% of the image)`);
  if (coverage < 0.05) warnings.push('The detected object is very small in the frame; the outline will be coarse.');
  if (coverage > 0.97) warnings.push('The object fills the whole image: the background may not have been separated.');
  if (opts.removeThinFeaturesMm && opts.removeThinFeaturesMm > 0) {
    // first estimate of the scale from the raw width, to convert millimetres into pixels
    const raw = largestComponent(silhouette);
    if (raw) {
      const wRaw = raw.bbox.maxX - raw.bbox.minX + 1;
      const mmPerPx = (opts.knownWidthMm ?? (opts.knownDepthMm as number) * (wRaw / (raw.bbox.maxY - raw.bbox.minY + 1))) / wRaw;
      const r = Math.round(opts.removeThinFeaturesMm / 2 / mmPerPx);
      if (r >= 1) {
        const before = raw.area;
        const opened = largestComponent(openMask(silhouette, r));
        if (opened) {
          silhouette = opened.mask;
          steps.push(`thin features (< ${opts.removeThinFeaturesMm} mm: straps, tabs) removed — ${Math.round((1 - opened.area / before) * 1000) / 10}% of the silhouette`);
        }
      }
    }
  }
  if (opts.trimProtrusionsMm && opts.trimProtrusionsMm > 0) {
    const raw = largestComponent(silhouette);
    if (raw) {
      const wRaw = raw.bbox.maxX - raw.bbox.minX + 1;
      const mmPerPx = (opts.knownWidthMm ?? (opts.knownDepthMm as number) * (wRaw / (raw.bbox.maxY - raw.bbox.minY + 1))) / wRaw;
      const t = trimProtrusions(silhouette, Math.max(1, Math.round(opts.trimProtrusionsMm / mmPerPx)));
      const cut = (['left', 'right', 'top', 'bottom'] as const).filter((k) => t.trimmed[k] > 0);
      if (cut.length) {
        const kept = largestComponent(t.mask);
        if (kept) {
          silhouette = kept.mask;
          steps.push(`protrusions trimmed to the body edge: ${cut.map((k) => `${k} ${(t.trimmed[k] * mmPerPx).toFixed(1)} mm`).join(', ')} (strap mount, hook or tab attached to the case)`);
          warnings.push('Part of the silhouette was treated as an attachment (e.g. a strap mount) and left out of the outline.');
        }
      }
    }
  }
  let contour: Point2D[] = traceContour(silhouette);
  steps.push(`contour traced (${contour.length} points)`);

  if (opts.perspective && opts.perspective !== 'none') {
    const quad = opts.perspective === 'auto' ? quadFromContour(contour) : opts.perspective;
    contour = rectifyPoints(contour, quad);
    steps.push(opts.perspective === 'auto' ? 'perspective corrected (automatic corners)' : 'perspective corrected (user corners)');
  }

  // bounding box in pixels after the optional correction
  const xs = contour.map((p) => p.x);
  const ys = contour.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  // pixel centres → add one pixel so a 700-px wide object measures 700, not 699
  const wPx = Math.max(...xs) - minX + 1;
  const hPx = Math.max(...ys) - minY + 1;

  let sx: number;
  let sy: number;
  if (opts.knownWidthMm && opts.knownDepthMm) {
    sx = opts.knownWidthMm / wPx;
    sy = opts.knownDepthMm / hPx;
    const skew = Math.abs(sx / sy - 1);
    steps.push(`calibrated with width ${opts.knownWidthMm} mm and depth ${opts.knownDepthMm} mm`);
    if (skew > 0.03) warnings.push(`Pixel aspect differs by ${(skew * 100).toFixed(1)}% between the two known dimensions: the image is distorted or the dimensions are inconsistent.`);
  } else if (opts.knownWidthMm) {
    sx = sy = opts.knownWidthMm / wPx;
    steps.push(`calibrated with width ${opts.knownWidthMm} mm (scale ${sx.toFixed(4)} mm/px)`);
  } else {
    sx = sy = (opts.knownDepthMm as number) / hPx;
    steps.push(`calibrated with depth ${opts.knownDepthMm} mm (scale ${sx.toFixed(4)} mm/px)`);
  }

  // the contour runs through pixel centres: grow it by half a pixel so it follows the true edge
  const centres = contour.map((p) => ({ x: (p.x - minX + 0.5) * sx, y: (p.y - minY + 0.5) * sy }));
  const mm = offsetPolygon(centres, 0.5 * ((sx + sy) / 2)).map((p) => ({ x: round(p.x, 2), y: round(p.y, 2) }));
  const tol = opts.simplifyMm ?? 0.4;
  const simple = simplifyPolygon(mm, tol);
  steps.push(`simplified to ${simple.length} points (tolerance ${tol} mm)`);

  const shape = makeShape(simple);
  if (opts.expectedDepthMm && !opts.knownDepthMm) {
    const dev = Math.abs(shape.depth / opts.expectedDepthMm - 1);
    if (dev > 0.15) {
      throw new ReconstructionRejected(
        `Rejected: the outline measures ${shape.width.toFixed(1)} × ${shape.depth.toFixed(1)} mm but the published depth is ${opts.expectedDepthMm} mm (${(dev * 100).toFixed(0)}% off). This image is probably not a clean top view of the keyboard.`,
      );
    }
    if (dev > 0.05) warnings.push(`Depth is ${(dev * 100).toFixed(0)}% off the published ${opts.expectedDepthMm} mm: perspective or a tilted photo may distort the outline.`);
    else steps.push(`depth ${shape.depth.toFixed(1)} mm agrees with the published ${opts.expectedDepthMm} mm`);
  }
  const holes: DetectedHole[] = holesPx
    .filter((h) => h.circularity > 0.6)
    .map((h) => ({
      x: round((h.x - minX + 0.5) * sx, 2),
      y: round((h.y - minY + 0.5) * sy, 2),
      diameter: round(h.diameterPx * sx, 2),
      circularity: round(h.circularity, 2),
    }));
  if (holes.length) steps.push(`${holes.length} enclosed circular holes detected`);

  const rim = rimColor(image, silhouette, Math.max(3, Math.round(Math.min(silhouette.width, silhouette.height) * 0.012)));
  if (rim) steps.push(`case colour measured on the rim: ${toHex(rim)}`);

  // confidence: calibrated twice > once; clean coverage > tiny; warnings subtract
  let score = opts.knownWidthMm && opts.knownDepthMm ? 0.8 : 0.7;
  if (coverage < 0.15) score -= 0.1;
  score -= warnings.length * 0.08;
  score = Math.max(0.2, Math.min(0.85, score));

  return {
    shape,
    scale: { x: sx, y: sy },
    holes,
    confidence: {
      level: 'reconstructed',
      score: round(score, 2),
      notes: 'Outline reconstructed from an image and calibrated with a known dimension.',
    },
    steps,
    warnings,
    mask: silhouette,
    rimColor: rim ? toHex(rim) : null,
  };
}

const toHex = (c: { r: number; g: number; b: number }) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Holes that look like screw holes (1.5–6.5 mm) as mounting-point candidates. */
export function holesToMountingPoints(holes: DetectedHole[], prefix = 'h'): MountingPoint[] {
  return holes
    .filter((h) => h.diameter >= 1.5 && h.diameter <= 6.5)
    .map((h, i) => ({ id: `${prefix}${i + 1}`, x: h.x, y: h.y, diameter: h.diameter, kind: 'screw' as const }));
}

export interface ProfileOptions {
  /** Real depth (front → back) of the keyboard, i.e. the horizontal extent of the side view. */
  knownDepthMm: number;
  /** Which edge of the image is the front of the keyboard. */
  frontSide?: 'left' | 'right';
  /** Sampling step along the depth. */
  stepMm?: number;
  maxSize?: number;
  threshold?: number;
}

export interface ProfileResult {
  profile: Profile;
  confidence: ConfidenceInfo;
  steps: string[];
  warnings: string[];
}

/**
 * Side view → height profile: for every column the silhouette's top edge, measured
 * above the lowest point of the object (the desk).
 */
export function reconstructProfile(source: ImageLike, opts: ProfileOptions): ProfileResult {
  const steps: string[] = [];
  const warnings: string[] = [];
  const { image } = downscale(source, opts.maxSize ?? 1024);
  const seg = segment(image, { threshold: opts.threshold });
  const object = largestComponent(seg.mask);
  if (!object) throw new Error('No object found in the side image.');
  const { bbox, mask } = object;
  const wPx = bbox.maxX - bbox.minX + 1;
  const scale = opts.knownDepthMm / wPx;
  steps.push(`side silhouette ${wPx}px wide → ${scale.toFixed(4)} mm/px`);

  const top = new Array<number>(wPx).fill(Infinity);
  for (let x = bbox.minX; x <= bbox.maxX; x++) {
    for (let y = bbox.minY; y <= bbox.maxY; y++) {
      if (mask.data[y * mask.width + x]) {
        top[x - bbox.minX] = y;
        break;
      }
    }
  }
  const baseline = bbox.maxY + 1;
  const front = opts.frontSide ?? 'left';
  const step = opts.stepMm ?? 5;
  const raw: Array<{ x: number; height: number }> = [];
  for (let mmX = 0; mmX <= opts.knownDepthMm + 1e-6; mmX += step) {
    const col = Math.min(wPx - 1, Math.round(mmX / scale));
    const idx = front === 'left' ? col : wPx - 1 - col;
    const t = top[idx] as number;
    if (!Number.isFinite(t)) continue;
    raw.push({ x: round(mmX, 2), height: round((baseline - t) * scale, 2) });
  }
  if (raw.length < 2) throw new Error('Could not sample the profile.');
  const simplified = simplifyPolyline(
    raw.map((p) => ({ x: p.x, y: p.height })),
    0.4,
  ).map((p) => ({ x: p.x, height: p.y }));

  const peak = Math.max(...raw.map((p) => p.height));
  if (peak < 8 || peak > 90 || peak / opts.knownDepthMm > 0.6) {
    throw new ReconstructionRejected(`Rejected: the silhouette is ${peak.toFixed(1)} mm tall for a ${opts.knownDepthMm} mm deep keyboard — this does not look like a side view.`);
  }
  const frontH = (raw[0] as { height: number }).height;
  const rearH = (raw[raw.length - 1] as { height: number }).height;
  const angle = round((Math.atan2(rearH - frontH, opts.knownDepthMm) * 180) / Math.PI, 1);
  steps.push(`profile sampled every ${step} mm; front ${frontH} mm, rear ${rearH} mm`);
  if (angle === 0) warnings.push('No typing angle detected (front and rear heights are identical): check that this really is a side view.');
  if (Math.abs(angle) > 15) warnings.push(`Unusual overall angle (${angle}°): check that the front side is set correctly.`);

  return {
    profile: { points: simplified, frontHeight: frontH, rearHeight: rearH, angle },
    confidence: { level: 'reconstructed', score: warnings.length ? 0.5 : 0.65, notes: 'Height profile read from a side photo; includes keycaps if visible.' },
    steps,
    warnings,
  };
}
