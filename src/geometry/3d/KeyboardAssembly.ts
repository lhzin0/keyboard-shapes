/**
 * KeyboardAssembly: selected components → independent 3D parts, positioned relative to
 * each other by the same registration the compatibility engine uses (so what you see is
 * what was checked).
 *
 * Pure (no React). The viewer turns `AssemblyPart`s into meshes.
 */
import * as THREE from 'three';
import type { BuildEvaluation, BuildSelection } from '../../compatibility/CompatibilityEngine';
import { resolvePlacements } from '../placement';
import type { Foam, KeyboardLayout, Keycap, Plate, Profile, Stabilizer } from '../../types/keyboard';
import { offsetPolygon, roundedRectPoints } from '../shape';
import { generateCase } from './CaseGenerator';
import { box, cylinder, extrude, holeCircle, merge } from './common';
import { generateKeycaps } from './KeycapGenerator';
import { generateDaughterboard, generatePcb } from './PCBGenerator';
import { generatePlate } from './PlateGenerator';
import { computeStack, type StackLevels } from './stack';
import { generateSwitch } from './SwitchGenerator';

export type LayerId = 'keycaps' | 'switches' | 'plate' | 'pcb' | 'daughterboard' | 'topCase' | 'bottomCase' | 'foam' | 'hardware';

export const LAYER_ORDER: LayerId[] = ['keycaps', 'switches', 'plate', 'pcb', 'daughterboard', 'topCase', 'bottomCase', 'foam', 'hardware'];

export const LAYER_LABEL: Record<LayerId, string> = {
  keycaps: 'Keycaps',
  switches: 'Switches',
  plate: 'Plate',
  pcb: 'PCB',
  daughterboard: 'Daughterboard',
  topCase: 'Top case',
  bottomCase: 'Bottom case',
  foam: 'Foam',
  hardware: 'Hardware',
};

export type ColorRole = 'case' | 'pcb' | 'plate' | 'switch' | 'keycap' | 'connector' | 'foam' | 'hardware' | 'board';

export interface AssemblyPart {
  id: string;
  layer: LayerId;
  role: ColorRole;
  /** Which component the part belongs to (for compatibility colouring). */
  component?: 'case' | 'pcb' | 'plate' | 'daughterboard';
  geometry: THREE.BufferGeometry;
  /** Generic stand-in for something the data does not contain (shown as a ghost, never part of a compatibility check). */
  placeholder?: boolean;
  /** Flattened 4×4 matrices when the part is instanced. */
  instances?: Float32Array;
  /** Mean height of the part in the typing-plane frame, for the exploded view. */
  centerZ: number;
}

export interface AssemblySelection extends BuildSelection {
  layout?: KeyboardLayout | null;
  keycap?: Keycap;
  stabilizer?: Stabilizer;
  foam?: Foam;
  /** Keyboard-level side profile, used by the 2D side view when no case geometry exists. */
  profile?: Profile;
}

export interface Assembly {
  parts: AssemblyPart[];
  stack: StackLevels;
  /** Footprint in the case frame. */
  width: number;
  depth: number;
  evaluation: BuildEvaluation;
  /** Case colour measured on a product photo (`#rrggbb`), if the record has one. */
  caseColor?: string;
  /** Keycap colour measured on a product photo, if the record has one. */
  keycapColor?: string;
  /** Layers that have at least one part. */
  layers: LayerId[];
  centerZ: number;
  warnings: string[];
}

function matrices(points: Array<{ x: number; y: number; rotation?: number }>): Float32Array {
  const out = new Float32Array(points.length * 16);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3(0, 1, 0);
  points.forEach((pt, i) => {
    q.setFromAxisAngle(axis, pt.rotation ?? 0);
    p.set(pt.x, 0, pt.y);
    m.compose(p, q, s);
    m.toArray(out, i * 16);
  });
  return out;
}

export function buildAssembly(sel: AssemblySelection): Assembly {
  const resolved = resolvePlacements(sel);
  const { evaluation, centers, width, depth } = resolved;
  const pcbPl = resolved.pcb;
  const platePl = resolved.plate;
  const dbPl = resolved.daughterboard;
  const warnings: string[] = [];
  const stack = computeStack(sel);
  const parts: AssemblyPart[] = [];

  const place = (g: THREE.BufferGeometry, dx: number, dy: number) => {
    g.translate(dx, 0, dy);
    return g;
  };

  /* ------------------------------------------------------------------ case */
  if (sel.case) {
    const cg = generateCase(sel.case, stack);
    warnings.push(...cg.warnings);
    parts.push({ id: 'case-bottom', layer: 'bottomCase', role: 'case', component: 'case', geometry: cg.bottom, centerZ: (-stack.floorThickness + stack.split) / 2 });
    if (cg.top.getAttribute('position')) {
      parts.push({ id: 'case-top', layer: 'topCase', role: 'case', component: 'case', geometry: cg.top, centerZ: (stack.split + stack.rim) / 2 });
    }
    // foam
    if (sel.foam && sel.foam.location === 'case') {
      const t = Math.min(sel.foam.thickness, Math.max(stack.pcbBottom - 0.2, 0.5));
      const holes = sel.case.mountingPoints.map((m) => holeCircle(m.x, m.y, (m.diameter ?? 4.5) + 0.4, 12));
      parts.push({
        id: 'foam',
        layer: 'foam',
        role: 'foam',
        geometry: extrude(offsetPolygon(cg.cavity, -0.4), t, 0, holes),
        centerZ: t / 2,
      });
    }
  }

  /* ------------------------------------------------------------------- pcb */
  if (sel.pcb) {
    const g = generatePcb(sel.pcb, stack.pcbBottom);
    parts.push({ id: 'pcb', layer: 'pcb', role: 'pcb', component: 'pcb', geometry: place(g.board, pcbPl.dx, pcbPl.dy), centerZ: (stack.pcbBottom + stack.pcbTop) / 2 });
    if (g.connector) {
      parts.push({
        id: 'pcb-usb',
        layer: 'pcb',
        role: 'connector',
        component: 'pcb',
        geometry: place(g.connector, pcbPl.dx, pcbPl.dy),
        centerZ: stack.pcbTop + 1.6,
      });
    }
  }

  /* ------------------------------------------------ interior placeholder */
  // A record that has a case and a key map but no PCB / plate (typically an import from a product page) would show
  // keycaps floating over an empty cavity. Draw a generic plate + switches as a *ghost*, flagged as placeholder.
  const interiorUnknown = !sel.pcb && !sel.plate && !!sel.case && centers.length > 0;
  if (interiorUnknown && sel.layout) {
    const xs = centers.map((c) => c.x);
    const ys = centers.map((c) => c.y);
    const half = 9.525 + 3.5;
    const outline = roundedRectPoints(Math.min(...xs) - half, Math.min(...ys) - half, Math.max(...xs) - Math.min(...xs) + 2 * half, Math.max(...ys) - Math.min(...ys) + 2 * half, 1.5, 4);
    const ghostPlate = {
      id: 'placeholder-plate',
      slug: 'placeholder-plate',
      dimensions: { width: 0, depth: 0 },
      outline: { points: outline, width: 0, depth: 0, closed: true },
      thickness: 1.5,
      switchCutouts: centers.map((c, i) => ({ keyIndex: i, x: c.x, y: c.y, rotation: 0 })),
      mountingPoints: [],
    } as unknown as Plate;
    parts.push({
      id: 'plate-placeholder',
      layer: 'plate',
      role: 'plate',
      placeholder: true,
      geometry: generatePlate(ghostPlate, stack.plateBottom, sel.switch?.cutout),
      centerZ: (stack.plateBottom + stack.plateTop) / 2,
    });
    warnings.push('The record has no PCB or plate: the plate and switches shown are translucent generic placeholders, not data.');
  }

  /* ----------------------------------------------------------------- plate */
  if (sel.plate) {
    const g = generatePlate(sel.plate, stack.plateBottom, sel.switch?.cutout);
    parts.push({ id: 'plate', layer: 'plate', role: 'plate', component: 'plate', geometry: place(g, platePl.dx, platePl.dy), centerZ: (stack.plateBottom + stack.plateTop) / 2 });
  }

  /* --------------------------------------------------------- daughterboard */
  if (sel.daughterboard) {
    const z = 1.5;
    const g = generateDaughterboard(sel.daughterboard, z);
    parts.push({
      id: 'daughterboard',
      layer: 'daughterboard',
      role: 'board',
      component: 'daughterboard',
      geometry: place(g.board, dbPl.dx, dbPl.dy),
      centerZ: z + 0.8,
    });
    if (g.connector) {
      parts.push({ id: 'db-usb', layer: 'daughterboard', role: 'connector', component: 'daughterboard', geometry: place(g.connector, dbPl.dx, dbPl.dy), centerZ: z + 2.4 });
    }
  }

  /* ----------------------------------------------- switches and keycaps */
  if (centers.length > 0 && (sel.pcb || sel.plate || interiorUnknown)) {
    const sw = generateSwitch(sel.switch, stack.pcbTop, stack.plateBottom, stack.plateTop);
    const topExtra = Math.max((sel.switch?.topHeight ?? 6.6) - 3.6, 1.5);
    parts.push({
      id: 'switches',
      layer: 'switches',
      role: 'switch',
      placeholder: interiorUnknown,
      geometry: sw.geometry,
      instances: matrices(centers),
      centerZ: (stack.pcbTop + stack.plateTop + topExtra + 3.6) / 2,
    });
  }
  if (centers.length > 0 && sel.layout && sel.layout.keys.length === centers.length) {
    const groups = generateKeycaps(sel.layout, sel.keycap, centers, stack.keycapBase);
    const avg = sel.keycap ? sel.keycap.rowHeights.reduce((a, b) => a + b, 0) / sel.keycap.rowHeights.length : 9;
    groups.forEach((g, i) =>
      parts.push({
        id: `keycaps-${i}`,
        layer: 'keycaps',
        role: 'keycap',
        geometry: g.geometry,
        instances: matrices(g.instances),
        centerZ: stack.keycapBase + avg / 2,
      }),
    );
  } else if (centers.length > 0 && !sel.layout) {
    warnings.push('Layout unknown for this selection: keycaps are not drawn.');
  } else if (sel.layout && centers.length > 0) {
    warnings.push(`Layout has ${sel.layout.keys.length} keys but the PCB/plate has ${centers.length} switch positions: keycaps are not drawn.`);
  }

  /* -------------------------------------------------------------- hardware */
  const screwSource = sel.plate ? sel.plate.mountingPoints.map((m) => ({ x: m.x + platePl.dx, y: m.y + platePl.dy })) : sel.pcb ? sel.pcb.mountingPoints.map((m) => ({ x: m.x + pcbPl.dx, y: m.y + pcbPl.dy })) : [];
  if (screwSource.length > 0) {
    const headZ = sel.plate ? stack.plateTop : stack.pcbTop;
    const shaftFrom = stack.pcbBottom;
    const geos: THREE.BufferGeometry[] = [];
    for (const s of screwSource) {
      geos.push(cylinder(s.x, s.y, 2, 1.2, headZ, 12));
      geos.push(cylinder(s.x, s.y, 1, Math.max(headZ - shaftFrom, 0.5), shaftFrom, 8));
    }
    parts.push({ id: 'hardware', layer: 'hardware', role: 'hardware', geometry: merge(geos), centerZ: (shaftFrom + headZ) / 2 });
  }

  const layers = LAYER_ORDER.filter((l) => parts.some((p) => p.layer === l));
  const allZ = parts.map((p) => p.centerZ);
  const centerZ = allZ.length ? allZ.reduce((a, b) => a + b, 0) / allZ.length : 0;
  return { parts, stack, width, depth, evaluation, caseColor: sel.case?.appearance?.color, keycapColor: sel.case?.appearance?.keycapColor, layers, centerZ, warnings };
}

/** Frees GPU-bound geometry when an assembly is replaced. */
export function disposeAssembly(a: Assembly): void {
  for (const p of a.parts) p.geometry.dispose();
}

export { box };

/**
 * Matrix that takes the typing-plane frame to world space: the pivot (front-bottom edge of
 * the case) goes to the origin, the back rises by the case angle. World Y = 0 is the desk.
 */
export function tiltMatrix(a: Pick<Assembly, 'stack' | 'depth'>): THREE.Matrix4 {
  const toPivot = new THREE.Matrix4().makeTranslation(0, a.stack.floorThickness, -a.depth);
  const rot = new THREE.Matrix4().makeRotationX((a.stack.tiltDeg * Math.PI) / 180);
  return rot.multiply(toPivot);
}
