import type { ColorRole } from './KeyboardAssembly';

export const ROLE_COLOR: Record<ColorRole, string> = {
  case: '#8e9aae',
  pcb: '#1f8a63',
  plate: '#bcc5d3',
  switch: '#3a4352',
  keycap: '#e6e1d6',
  connector: '#aeb8c6',
  foam: '#e8c957',
  hardware: '#d3d9e2',
  board: '#2f66b8',
};

export const ROLE_FINISH: Record<ColorRole, { metalness: number; roughness: number }> = {
  case: { metalness: 0.65, roughness: 0.42 },
  pcb: { metalness: 0.1, roughness: 0.7 },
  plate: { metalness: 0.7, roughness: 0.35 },
  switch: { metalness: 0.05, roughness: 0.6 },
  keycap: { metalness: 0.0, roughness: 0.55 },
  connector: { metalness: 0.8, roughness: 0.3 },
  foam: { metalness: 0, roughness: 1 },
  hardware: { metalness: 0.9, roughness: 0.3 },
  board: { metalness: 0.1, roughness: 0.7 },
};




/** Exploded view: millimetres of separation per millimetre of distance from the stack centre, at 100%. */
export const EXPLODE_GAIN = 3.4;
