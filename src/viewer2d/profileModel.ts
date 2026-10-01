/**
 * Side and front silhouettes in millimetres, in *world* orientation (desk = 0, up = negative SVG y).
 * The typing-plane frame (see geometry/3d/stack.ts) is tilted by the case angle exactly like the 3D viewer does.
 */
import type { AssemblySelection } from '../geometry/3d/KeyboardAssembly';
import { computeStack, keycapHeight } from '../geometry/3d/stack';
import { resolvePlacements } from '../geometry/placement';
import { KEY_PITCH_MM } from '../geometry/layouts';
import type { Point2D } from '../types/keyboard';

export type ProfileKind = 'case' | 'cavity' | 'foam' | 'pcb' | 'plate' | 'switch' | 'keycap' | 'daughterboard';

export interface ProfilePoly {
  id: string;
  kind: ProfileKind;
  points: Point2D[];
  label?: string;
}

export interface ProfileModel {
  polys: ProfilePoly[];
  frontHeight: number;
  rearHeight: number;
  angle: number;
  /** Horizontal extent along the desk. */
  length: number;
  maxHeight: number;
  /** Dashed outline of the back-wall USB cutout (front view). */
  usbCutout?: Point2D[];
  warnings: string[];
}

function transformer(depth: number, floorT: number, thetaDeg: number) {
  const t = (thetaDeg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  // A-frame (y toward the front, z up from the inner floor) → (s along the desk from the front, h above the desk)
  return (yA: number, zA: number): { s: number; h: number } => {
    const d = depth - yA;
    const zz = zA + floorT;
    return { s: d * cos - zz * sin, h: d * sin + zz * cos };
  };
}

export function buildProfileModel(sel: AssemblySelection, view: 'side' | 'front'): ProfileModel {
  const warnings: string[] = [];
  const resolved = resolvePlacements(sel);
  const stack = computeStack(sel);
  const D = resolved.depth;
  const W = resolved.width;
  const tilt = stack.tiltDeg;
  const w = transformer(D, stack.floorThickness, tilt);
  const tan = Math.tan((tilt * Math.PI) / 180);
  const polys: ProfilePoly[] = [];

  // projection of an A-frame rectangle [y0,y1] × [z0,z1] (side) or [x0,x1] × silhouette (front)
  const sideRect = (id: string, kind: ProfileKind, y0: number, y1: number, z0: number, z1: number, label?: string) => {
    const pts = [w(y1, z0), w(y0, z0), w(y0, z1), w(y1, z1)].map((p) => ({ x: p.s, y: -p.h }));
    polys.push({ id, kind, points: pts, label });
  };

  // front view heights at a given x-range: the highest point over the depth range (rear)
  const frontRect = (id: string, kind: ProfileKind, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const hs = [w(y0, z0).h, w(y1, z0).h, w(y0, z1).h, w(y1, z1).h];
    const hMax = Math.max(...hs);
    const hMin = Math.min(...hs);
    polys.push({
      id,
      kind,
      points: [
        { x: x0, y: -hMin },
        { x: x1, y: -hMin },
        { x: x1, y: -hMax },
        { x: x0, y: -hMax },
      ],
    });
  };

  const add = view === 'side'
    ? (id: string, kind: ProfileKind, _x0: number, _x1: number, y0: number, y1: number, z0: number, z1: number) => sideRect(id, kind, y0, y1, z0, z1)
    : frontRect;

  let frontHeight = 0;
  let rearHeight = 0;
  let usbCutout: Point2D[] | undefined;

  if (sel.case) {
    const c = sel.case;
    const rim = stack.rim;
    const wall = c.wallThickness ?? 3;
    if (view === 'side') {
      const outer = [w(D, -stack.floorThickness), w(0, -stack.floorThickness - D * tan), w(0, rim), w(D, rim)].map((p) => ({ x: p.s, y: -p.h }));
      polys.push({ id: 'case', kind: 'case', points: outer });
      sideRect('cavity', 'cavity', wall, D - wall, 0, rim);
    } else {
      // silhouette: from the desk to the rear top edge; the front face is the lower part
      const front = w(D, rim).h;
      const rear = w(0, rim).h;
      polys.push({ id: 'case', kind: 'case', points: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: -rear }, { x: 0, y: -rear }] });
      polys.push({ id: 'case-front', kind: 'cavity', points: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: -front }, { x: 0, y: -front }] });
      const usb = c.cutouts.find((u) => u.kind === 'usb' && u.wall === 'back');
      if (usb) {
        const z0 = Math.max(0, stack.pcbTop - 0.5);
        const z1 = Math.min(rim, z0 + (usb.height ?? 6.5));
        const h0 = w(0, z0).h;
        const h1 = w(0, z1).h;
        usbCutout = [
          { x: usb.center - usb.width / 2, y: -h0 },
          { x: usb.center + usb.width / 2, y: -h0 },
          { x: usb.center + usb.width / 2, y: -h1 },
          { x: usb.center - usb.width / 2, y: -h1 },
        ];
      }
    }
    frontHeight = w(D, rim).h;
    rearHeight = w(0, rim).h;
    if (sel.foam && sel.foam.location === 'case') add('foam', 'foam', 0, W, wall, D - wall, 0, Math.min(sel.foam.thickness, stack.pcbBottom));
  }

  if (sel.pcb) {
    const p = sel.pcb;
    add('pcb', 'pcb', resolved.pcb.dx, resolved.pcb.dx + p.dimensions.width, resolved.pcb.dy, resolved.pcb.dy + p.dimensions.depth, stack.pcbBottom, stack.pcbTop);
  }
  if (sel.plate) {
    const p = sel.plate;
    add('plate', 'plate', resolved.plate.dx, resolved.plate.dx + p.dimensions.width, resolved.plate.dy, resolved.plate.dy + p.dimensions.depth, stack.plateBottom, stack.plateTop);
  }
  if (sel.daughterboard) {
    const d = sel.daughterboard;
    add('daughterboard', 'daughterboard', resolved.daughterboard.dx, resolved.daughterboard.dx + d.dimensions.width, resolved.daughterboard.dy, resolved.daughterboard.dy + d.dimensions.depth, 1.5, 3.1);
  }

  // switches and keycaps
  if (resolved.centers.length > 0 && (sel.pcb || sel.plate)) {
    const topExtra = Math.max((sel.switch?.topHeight ?? 6.6) - 3.6, 1.5) + 3.6;
    if (view === 'side') {
      const rows = [...new Set(resolved.centers.map((c) => c.y.toFixed(2)))].map(Number);
      rows.forEach((y, i) => sideRect(`sw${i}`, 'switch', y - 7.8, y + 7.8, stack.pcbTop, stack.plateTop + topExtra));
    } else {
      const xs = resolved.centers.map((c) => c.x);
      const ys = resolved.centers.map((c) => c.y);
      frontRect('switches', 'switch', Math.min(...xs) - 7.8, Math.max(...xs) + 7.8, Math.min(...ys) - 7.8, Math.max(...ys) + 7.8, stack.pcbTop, stack.plateTop + topExtra);
    }
  }
  if (resolved.centers.length > 0 && sel.layout && sel.layout.keys.length === resolved.centers.length) {
    if (view === 'side') {
      const seen = new Set<string>();
      sel.layout.keys.forEach((k, i) => {
        const c = resolved.centers[i]!;
        const h = keycapHeight(sel.keycap, sel.layout!, k);
        const half = (k.height * KEY_PITCH_MM - 1) / 2;
        const key = `${c.y.toFixed(1)}|${half}|${h}`;
        if (seen.has(key)) return;
        seen.add(key);
        sideRect(`kc${seen.size}`, 'keycap', c.y - half, c.y + half, stack.keycapBase, stack.keycapBase + h);
      });
    } else {
      const xs = sel.layout.keys.map((k, i) => ({ k, c: resolved.centers[i]! }));
      const x0 = Math.min(...xs.map(({ k, c }) => c.x - (k.width * KEY_PITCH_MM - 1) / 2));
      const x1 = Math.max(...xs.map(({ k, c }) => c.x + (k.width * KEY_PITCH_MM - 1) / 2));
      const y0 = Math.min(...xs.map(({ k, c }) => c.y - (k.height * KEY_PITCH_MM - 1) / 2));
      const y1 = Math.max(...xs.map(({ k, c }) => c.y + (k.height * KEY_PITCH_MM - 1) / 2));
      const hMax = Math.max(...sel.layout.keys.map((k) => keycapHeight(sel.keycap, sel.layout!, k)));
      frontRect('keycaps', 'keycap', x0, x1, y0, y1, stack.keycapBase, stack.keycapBase + hMax);
    }
  } else if (resolved.centers.length > 0) {
    warnings.push('Keycaps are not drawn: layout unknown or inconsistent with the switch positions.');
  }

  if (polys.length === 0 && sel.profile && view === 'side') {
    const pts = sel.profile.points;
    const last = pts[pts.length - 1];
    if (last) {
      polys.push({
        id: 'profile',
        kind: 'case',
        points: [{ x: 0, y: 0 }, ...pts.map((q) => ({ x: q.x, y: -q.height })), { x: last.x, y: 0 }],
      });
      frontHeight = sel.profile.frontHeight;
      rearHeight = sel.profile.rearHeight;
      warnings.push('Drawn from the recorded profile only (no case geometry available).');
    }
  }

  if (!sel.case && polys.length > 0 && frontHeight === 0) {
    // no case: heights of whatever is present
    const tops = polys.map((p) => Math.max(...p.points.map((q) => -q.y)));
    frontHeight = rearHeight = tops.length ? Math.max(...tops) : 0;
  }

  const all = polys.flatMap((p) => p.points);
  const maxHeight = all.length ? Math.max(...all.map((p) => -p.y)) : 0;
  const length = view === 'side' ? Math.max(...all.map((p) => p.x), 0) : W;
  return { polys, frontHeight, rearHeight, angle: tilt, length, maxHeight, usbCutout, warnings };
}
