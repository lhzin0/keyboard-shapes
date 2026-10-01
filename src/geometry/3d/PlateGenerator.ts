import * as THREE from 'three';
import type { Plate, Point2D } from '../../types/keyboard';
import { extrude, holeCircle, holeRect } from './common';

/** Plate-mount stabilizer cutout (commonly published Cherry-style dimensions). */
export const STAB_CUTOUT = { width: 6.65, depth: 12.3 };

/**
 * Plate: outline + switch cutouts (14 mm squares) + stabilizer cutouts + screw holes,
 * extruded by the plate thickness starting at `zBottom`.
 */
export function generatePlate(plate: Plate, zBottom: number, cutoutSize = { width: 14, depth: 14 }): THREE.BufferGeometry {
  const holes: Point2D[][] = [];
  for (const s of plate.switchCutouts) holes.push(holeRect(s.x, s.y, cutoutSize.width, cutoutSize.depth, s.rotation));
  for (const st of plate.stabilizerCutouts ?? []) {
    const half = st.spacing / 2;
    const r = (st.rotation * Math.PI) / 180;
    for (const sign of [-1, 1]) {
      holes.push(holeRect(st.x + sign * half * Math.cos(r), st.y + sign * half * Math.sin(r), STAB_CUTOUT.width, STAB_CUTOUT.depth, st.rotation));
    }
  }
  for (const m of plate.mountingPoints) holes.push(holeCircle(m.x, m.y, m.diameter ?? 2.5, 10));
  return extrude(plate.outline.points, plate.thickness, zBottom, holes);
}
