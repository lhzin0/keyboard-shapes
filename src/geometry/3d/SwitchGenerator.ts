import * as THREE from 'three';
import type { Switch } from '../../types/keyboard';
import { box, merge } from './common';

export interface SwitchInstance {
  x: number;
  y: number;
}

export interface SwitchModel {
  /** Unit geometry (centred at the origin of the plate plane) to be instanced at each position. */
  geometry: THREE.BufferGeometry;
}

/**
 * Stylised MX-style switch, built around (0, 0): lower housing under the plate,
 * upper housing through the cutout and above the plate, and a stem.
 * Heights follow the Switch record (plateToPcb, topHeight).
 */
export function generateSwitch(sw: Switch | undefined, pcbTop: number, plateBottom: number, plateTop: number): SwitchModel {
  const topHeight = sw?.topHeight ?? 6.6;
  const lower = box(0, 0, 15.6, 15.6, plateBottom - pcbTop, pcbTop);
  const upper = box(0, 0, 13.6, 13.6, plateTop - plateBottom + Math.max(topHeight - 3.6, 1.5), plateBottom);
  const stem = box(0, 0, 5.5, 5.5, 3.6, plateTop + Math.max(topHeight - 3.6, 1.5) - 0.01);
  return { geometry: merge([lower, upper, stem]) };
}
