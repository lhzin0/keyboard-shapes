import * as THREE from 'three';
import { KEY_PITCH_MM } from '../layouts';
import type { Keycap, KeyboardLayout, Point2D } from '../../types/keyboard';
import { frustum } from './common';
import { keycapHeight } from './stack';

/** Gap between neighbouring keycap skirts at the base. */
export const KEYCAP_GAP = 1.0;

export interface KeycapInstance {
  /** Centre in the case frame. */
  x: number;
  y: number;
  /** Rotation about the vertical axis (rad). */
  rotation: number;
}

export interface KeycapGroup {
  /** e.g. "1u@8.4" — keycaps sharing size and height share geometry. */
  key: string;
  geometry: THREE.BufferGeometry;
  instances: KeycapInstance[];
}

/**
 * One geometry per (size, height) pair, instanced over all keys that share it.
 * `centers[i]` is the centre of key i in the case frame (taken from the PCB switch positions).
 */
export function generateKeycaps(layout: KeyboardLayout, keycap: Keycap | undefined, centers: Point2D[], baseZ: number): KeycapGroup[] {
  const taper = keycap?.taper ?? 3;
  const groups = new Map<string, KeycapGroup>();
  for (const [i, k] of layout.keys.entries()) {
    const c = centers[i];
    if (!c) continue;
    const h = keycapHeight(keycap, layout, k);
    const w = k.width * KEY_PITCH_MM - KEYCAP_GAP;
    const d = k.height * KEY_PITCH_MM - KEYCAP_GAP;
    const rotation = k.rotation * (Math.PI / 180);
    const key = `${w.toFixed(2)}x${d.toFixed(2)}@${h.toFixed(2)}`;
    let g = groups.get(key);
    if (!g) {
      // slightly shifted top towards the back gives the sculpted look without changing the footprint
      g = { key, geometry: frustum(w, d, w - taper * 2, d - taper * 2, h, baseZ, -0.4), instances: [] };
      groups.set(key, g);
    }
    g.instances.push({
      x: c.x,
      y: c.y,
      // the 2D frame is mirrored relative to Three's Y-up frame, hence the sign
      rotation: -rotation,
    });
  }
  return [...groups.values()];
}
