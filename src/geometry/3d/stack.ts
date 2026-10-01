/**
 * Vertical stack of an assembly in the *typing-plane frame* (z up, z = 0 is the inner
 * floor of the case). The whole assembly is tilted afterwards by the case angle, so
 * these heights are measured along the tilted axis.
 */
import type { Case, Keycap, KeyDef, KeyboardLayout, PCB, Plate, Switch } from '../../types/keyboard';

export interface StackLevels {
  floorThickness: number;
  pcbBottom: number;
  pcbTop: number;
  plateBottom: number;
  plateTop: number;
  /** Top of the case walls. */
  rim: number;
  /** Where the top case separates from the bottom case. */
  split: number;
  keycapBase: number;
  tiltDeg: number;
}

export interface StackInput {
  case?: Case;
  pcb?: PCB;
  plate?: Plate;
  switch?: Switch;
  keycap?: Keycap;
}

export const DEFAULTS = {
  floorToPcb: 5,
  pcbThickness: 1.6,
  plateToPcb: 5,
  plateThickness: 1.5,
  floorThickness: 4,
  seatAbovePlate: 4.5,
};

export function computeStack(s: StackInput): StackLevels {
  const floorThickness = s.case?.floorThickness ?? DEFAULTS.floorThickness;
  const pcbBottom = s.case?.clearance?.floorToPcb ?? DEFAULTS.floorToPcb;
  const pcbTop = pcbBottom + (s.pcb?.thickness ?? DEFAULTS.pcbThickness);
  const plateBottom = pcbTop + (s.switch?.plateToPcb ?? DEFAULTS.plateToPcb);
  const plateTop = plateBottom + (s.plate?.thickness ?? DEFAULTS.plateThickness);
  const tilt = s.case?.angle ?? 0;
  const cos = Math.cos((tilt * Math.PI) / 180);
  const rimFromCase = s.case?.frontHeight !== undefined ? s.case.frontHeight / cos - floorThickness : undefined;
  const rim = Math.max(rimFromCase ?? plateTop, pcbTop + 0.5);
  return {
    floorThickness,
    pcbBottom,
    pcbTop,
    plateBottom,
    plateTop,
    rim,
    split: Math.min(pcbTop, rim - 0.5),
    keycapBase: plateTop + (s.keycap?.seatAbovePlate ?? DEFAULTS.seatAbovePlate),
    tiltDeg: tilt,
  };
}

/** Height of a keycap body for a key, according to its row counted from the bottom row. */
export function keycapHeight(keycap: Keycap | undefined, layout: KeyboardLayout, key: KeyDef): number {
  const heights = keycap?.rowHeights ?? [9];
  const maxRow = Math.max(...layout.keys.map((k) => k.row));
  const fromBottom = maxRow - key.row;
  return heights[Math.min(fromBottom, heights.length - 1)] ?? 9;
}
