import * as THREE from 'three';
import type { Daughterboard, PCB, PortPosition } from '../../types/keyboard';
import { box, extrude, holeCircle, merge } from './common';

export interface BoardGeometry {
  board: THREE.BufferGeometry;
  /** USB connector body (separate so it can be coloured differently). */
  connector?: THREE.BufferGeometry;
}

const USB_BODY_DEPTH = 7.3;

function usbConnector(port: PortPosition, zTop: number): THREE.BufferGeometry {
  const h = port.height ?? 3.26;
  // the receptacle face sits at the port position; the body extends inwards
  const dy = port.facing === 'back' ? USB_BODY_DEPTH / 2 : port.facing === 'front' ? -USB_BODY_DEPTH / 2 : 0;
  const dx = port.facing === 'left' ? USB_BODY_DEPTH / 2 : port.facing === 'right' ? -USB_BODY_DEPTH / 2 : 0;
  const horizontal = port.facing === 'front' || port.facing === 'back';
  return box(port.x + dx, port.y + dy, horizontal ? port.width : USB_BODY_DEPTH, horizontal ? USB_BODY_DEPTH : port.width, h, zTop);
}

/** PCB: outline extruded by its thickness, mounting holes drilled, USB receptacle on top. */
export function generatePcb(pcb: PCB, zBottom: number): BoardGeometry {
  const t = pcb.thickness ?? 1.6;
  const holes = pcb.mountingPoints.map((m) => holeCircle(m.x, m.y, m.diameter ?? 2.5, 10));
  const board = extrude(pcb.outline.points, t, zBottom, holes);
  const connector = pcb.usbPort ? usbConnector(pcb.usbPort, zBottom + t) : undefined;
  return { board, connector };
}

export function generateDaughterboard(db: Daughterboard, zBottom: number): BoardGeometry {
  const t = db.thickness ?? 1.6;
  const holes = db.mountingPoints.map((m) => holeCircle(m.x, m.y, m.diameter ?? 2.2, 10));
  const board = extrude(db.outline.points, t, zBottom, holes);
  return { board, connector: usbConnector(db.usbPort, zBottom + t) };
}

export { merge };
