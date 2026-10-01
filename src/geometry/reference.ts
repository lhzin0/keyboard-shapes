/**
 * Parametric reference parts.
 *
 * KeyboardShapes ships with an *illustrative* dataset generated from the ANSI
 * layouts and nominal, commonly published dimensions (19.05 mm pitch, 14 mm MX
 * cutouts, 5 mm plate-to-PCB gap ...). These parts are NOT measurements of any
 * commercial product: every record is tagged `parametric-reference` /
 * `estimated`, and the UI says so. Real products enter the database through the
 * import pipeline with their own provenance.
 *
 * The same builders power the unit-test fixtures, so the compatibility engine
 * is exercised against deterministic geometry.
 */
import type {
  Case,
  Cutout,
  Daughterboard,
  Foam,
  Keyboard,
  KeyboardLayout,
  Keycap,
  MountingPoint,
  PCB,
  Plate,
  Point2D,
  Profile,
  SourceInfo,
  Stabilizer,
  StabilizerPosition,
  Switch,
  SwitchPosition,
  Wall,
} from '../types/keyboard';
import {
  KEY_PITCH_MM,
  buildLayout,
  stabilizerSpacing,
} from './layouts';
import { makeShape, offsetPolygon, round, roundedRectPoints } from './shape';

export const REFERENCE_TIMESTAMP = '2026-10-01T00:00:00.000Z';

export const REFERENCE_SOURCE: SourceInfo = {
  sourceName: 'KeyboardShapes parametric reference',
  sourceType: 'parametric-reference',
  method: 'generated from ANSI layout and nominal published dimensions',
  retrievedAt: REFERENCE_TIMESTAMP,
  confidence: 0.4,
};

const confidence = (notes: string) => ({ level: 'estimated' as const, score: 0.4, notes });

/* ------------------------------------------------------------------- specs */

export type HolePattern = 'a' | 'b';

export interface RefCaseSpec {
  id: string;
  model: string;
  bezel: { left: number; right: number; top: number; bottom: number };
  wall: number;
  radius: number;
  floorThickness: number;
  floorToPcb: number;
  angle: number;
  holePattern: HolePattern;
  /** Shift of the USB cutout (mm) from the ideal centre — non-zero creates a misaligned case. */
  usbCutoutOffset?: number;
  withDaughterboardArea?: boolean;
  material: string;
  tags?: string[];
}

export interface RefPcbSpec {
  id: string;
  model: string;
  margin: number;
  holePattern: HolePattern;
  /** If set, the PCB has no USB port of its own and expects a daughterboard. */
  daughterboardConnector?: string;
  undersideHeight: number;
  tags?: string[];
}

export interface RefPlateSpec {
  id: string;
  model: string;
  margin: number;
  holePattern: HolePattern;
  thickness: number;
  material: string;
  tags?: string[];
}

export interface RefDaughterboardSpec {
  id: string;
  model: string;
  connectorType: string;
}

export const DEFAULT_CASE: Omit<RefCaseSpec, 'id' | 'model'> = {
  bezel: { left: 8, right: 8, top: 8, bottom: 10 },
  wall: 3,
  radius: 4,
  floorThickness: 4,
  floorToPcb: 5,
  angle: 6,
  holePattern: 'a',
  material: 'aluminium',
};

export const SWITCH_PLATE_TO_PCB = 5;
export const PCB_THICKNESS = 1.6;
export const SWITCH_TOP_HEIGHT = 6.6;

/* ------------------------------------------------------------- key helpers */

export interface KeyAreaMetrics {
  widthMm: number;
  depthMm: number;
}

export function keyArea(layout: KeyboardLayout): KeyAreaMetrics {
  return { widthMm: layout.widthU * KEY_PITCH_MM, depthMm: layout.heightU * KEY_PITCH_MM };
}

/** Screw / post positions in the key-area frame (origin = top-left corner of the key area). */
export function holePattern(layout: KeyboardLayout, pattern: HolePattern): Point2D[] {
  const { widthMm: W, depthMm: D } = keyArea(layout);
  const nx = Math.max(3, Math.round(W / 75));
  const inset = pattern === 'a' ? 8 : 14;
  const ys = pattern === 'a' ? [0.2 * D, 0.8 * D] : [0.3 * D, 0.7 * D];
  const pts: Point2D[] = [];
  for (const y of ys) {
    for (let i = 0; i < nx; i++) {
      pts.push({ x: round(inset + ((W - 2 * inset) * i) / (nx - 1), 2), y: round(y, 2) });
    }
  }
  return pts;
}

function mountingPoints(prefix: string, pts: Point2D[], offset: Point2D, d: number, kind: MountingPoint['kind']): MountingPoint[] {
  return pts.map((p, i) => ({
    id: `${prefix}${i + 1}`,
    x: round(p.x + offset.x, 3),
    y: round(p.y + offset.y, 3),
    diameter: d,
    kind,
  }));
}

function switchPositions(layout: KeyboardLayout, offset: Point2D): SwitchPosition[] {
  return layout.keys.map((k, i) => ({
    keyIndex: i,
    x: round((k.x + k.width / 2) * KEY_PITCH_MM + offset.x, 3),
    y: round((k.y + k.height / 2) * KEY_PITCH_MM + offset.y, 3),
    rotation: 0,
  }));
}

function stabilizerPositions(layout: KeyboardLayout, offset: Point2D): StabilizerPosition[] {
  const out: StabilizerPosition[] = [];
  layout.keys.forEach((k, i) => {
    const vertical = k.height > 1;
    const span = vertical ? k.height : k.width;
    const spacing = stabilizerSpacing(span);
    if (spacing === null) return;
    out.push({
      keyIndex: i,
      x: round((k.x + k.width / 2) * KEY_PITCH_MM + offset.x, 3),
      y: round((k.y + k.height / 2) * KEY_PITCH_MM + offset.y, 3),
      spacing,
      rotation: vertical ? 90 : 0,
    });
  });
  return out;
}

/* ------------------------------------------------------------- generators */

export function buildCase(layout: KeyboardLayout, spec: RefCaseSpec): Case {
  const { widthMm, depthMm } = keyArea(layout);
  const { left, right, bottom } = spec.bezel;
  // a daughterboard bay needs room behind the key area
  const top = spec.withDaughterboardArea ? Math.max(spec.bezel.top, 22) : spec.bezel.top;
  const W = round(widthMm + left + right, 3);
  const D = round(depthMm + top + bottom, 3);
  const external = roundedRectPoints(0, 0, W, D, spec.radius, 6);
  const cavity = offsetPolygon(external, -spec.wall).map((p) => ({ x: round(p.x, 3), y: round(p.y, 3) }));

  const posts = mountingPoints('post', holePattern(layout, spec.holePattern), { x: left, y: top }, 4.5, 'standoff');
  const cutouts: Cutout[] = [];
  const usbCenter = W / 2 + (spec.usbCutoutOffset ?? 0);
  cutouts.push({ id: 'usb', kind: 'usb', wall: 'back', center: round(usbCenter, 3), width: 12, height: 6.5 });

  const plateTop = spec.floorToPcb + PCB_THICKNESS + SWITCH_PLATE_TO_PCB + 1.5;
  const heightA = spec.floorThickness + plateTop;
  const rad = (spec.angle * Math.PI) / 180;
  const frontHeight = round(heightA * Math.cos(rad), 2);
  const rearHeight = round(frontHeight + D * Math.sin(rad), 2);

  return {
    id: spec.id,
    slug: spec.id,
    brand: 'KeyboardShapes',
    model: spec.model,
    dimensions: { width: W, depth: D, height: rearHeight },
    externalShape: makeShape(external),
    internalCavity: makeShape(cavity),
    angle: spec.angle,
    frontHeight,
    rearHeight,
    wallThickness: spec.wall,
    floorThickness: spec.floorThickness,
    mountingPoints: posts,
    cutouts,
    daughterboardArea: spec.withDaughterboardArea
      ? { x: round(W / 2 - 15, 3), y: spec.wall, width: 30, depth: 15.5 }
      : undefined,
    clearance: { floorToPcb: spec.floorToPcb, plateTopToRim: 0 },
    material: spec.material,
    model3d: { kind: 'parametric' },
    tags: ['reference', layout.name, ...(spec.tags ?? [])],
    sources: [REFERENCE_SOURCE],
    confidence: confidence('Illustrative parametric case; not a commercial product.'),
  };
}

export function buildPcb(layout: KeyboardLayout, spec: RefPcbSpec): PCB {
  const { widthMm, depthMm } = keyArea(layout);
  const m = spec.margin;
  const W = round(widthMm + 2 * m, 3);
  const D = round(depthMm + 2 * m, 3);
  const off = { x: m, y: m };
  const hasDb = spec.daughterboardConnector !== undefined;
  return {
    id: spec.id,
    slug: spec.id,
    brand: 'KeyboardShapes',
    model: spec.model,
    dimensions: { width: W, depth: D, height: PCB_THICKNESS },
    outline: makeShape(roundedRectPoints(0, 0, W, D, 1.5, 4)),
    thickness: PCB_THICKNESS,
    undersideHeight: spec.undersideHeight,
    mountingPoints: mountingPoints('h', holePattern(layout, spec.holePattern), off, 2.5, 'screw'),
    switchPositions: switchPositions(layout, off),
    stabilizerPositions: stabilizerPositions(layout, off),
    usbPort: hasDb ? undefined : { x: round(W / 2, 3), y: 2, width: 8.94, height: 3.26, facing: 'back', type: 'USB-C' },
    daughterboard: hasDb
      ? { connectorType: spec.daughterboardConnector as string, position: { x: round(W / 2, 3), y: 4 } }
      : undefined,
    features: { hotswap: true },
    model3d: { kind: 'parametric' },
    tags: ['reference', layout.name, ...(spec.tags ?? [])],
    sources: [REFERENCE_SOURCE],
    confidence: confidence('Illustrative parametric PCB; not a commercial product.'),
  };
}

export function buildPlate(layout: KeyboardLayout, spec: RefPlateSpec): Plate {
  const { widthMm, depthMm } = keyArea(layout);
  const m = spec.margin;
  const W = round(widthMm + 2 * m, 3);
  const D = round(depthMm + 2 * m, 3);
  const off = { x: m, y: m };
  return {
    id: spec.id,
    slug: spec.id,
    brand: 'KeyboardShapes',
    model: spec.model,
    dimensions: { width: W, depth: D, height: spec.thickness },
    outline: makeShape(roundedRectPoints(0, 0, W, D, 1.5, 4)),
    thickness: spec.thickness,
    material: spec.material,
    switchCutouts: switchPositions(layout, off),
    stabilizerCutouts: stabilizerPositions(layout, off),
    mountingPoints: mountingPoints('p', holePattern(layout, spec.holePattern), off, 2.5, 'screw'),
    model3d: { kind: 'parametric' },
    tags: ['reference', layout.name, ...(spec.tags ?? [])],
    sources: [REFERENCE_SOURCE],
    confidence: confidence('Illustrative parametric plate; not a commercial product.'),
  };
}

export function buildDaughterboard(spec: RefDaughterboardSpec): Daughterboard {
  const W = 22;
  const D = 14;
  return {
    id: spec.id,
    slug: spec.id,
    brand: 'KeyboardShapes',
    model: spec.model,
    dimensions: { width: W, depth: D, height: 1.6 },
    outline: makeShape(roundedRectPoints(0, 0, W, D, 1, 3)),
    thickness: 1.6,
    mountingPoints: [
      { id: 'd1', x: 3, y: 9, diameter: 2.2, kind: 'screw' },
      { id: 'd2', x: 19, y: 9, diameter: 2.2, kind: 'screw' },
    ],
    usbPort: { x: 11, y: 2.2, width: 8.94, height: 3.26, facing: 'back', type: 'USB-C' },
    connectorType: spec.connectorType,
    connectorPosition: { x: 11, y: 11 },
    cableExit: 'front',
    model3d: { kind: 'parametric' },
    tags: ['reference'],
    sources: [REFERENCE_SOURCE],
    confidence: confidence('Illustrative parametric daughterboard.'),
  };
}

export const REFERENCE_SWITCH: Switch = {
  id: 'ref-mx-linear',
  slug: 'ref-mx-linear',
  brand: 'KeyboardShapes',
  model: 'Reference MX-style switch',
  style: 'MX',
  plateToPcb: SWITCH_PLATE_TO_PCB,
  topHeight: SWITCH_TOP_HEIGHT,
  cutout: { width: 14, depth: 14 },
  type: 'linear',
  tags: ['reference', 'MX'],
  sources: [{ ...REFERENCE_SOURCE, method: 'nominal MX dimensions commonly published (14 mm cutout, 5 mm plate-to-PCB)' }],
  confidence: { level: 'estimated', score: 0.6, notes: 'Nominal MX values; individual switches vary.' },
};

export const REFERENCE_KEYCAPS: Keycap[] = [
  {
    id: 'ref-keycap-cherry',
    slug: 'ref-keycap-cherry',
    brand: 'KeyboardShapes',
    model: 'Reference low sculpted set',
    profileName: 'Sculpted (generic)',
    // bottom row → function row. Placeholder heights for visualisation only.
    rowHeights: [8.6, 8.4, 8.8, 9.4, 9.6, 9.6],
    seatAbovePlate: 4.5,
    taper: 3,
    material: 'PBT',
    tags: ['reference'],
    sources: [{ ...REFERENCE_SOURCE, confidence: 0.2 }],
    confidence: { level: 'estimated', score: 0.2, notes: 'Placeholder heights for visualisation; not a real profile.' },
  },
  {
    id: 'ref-keycap-flat',
    slug: 'ref-keycap-flat',
    brand: 'KeyboardShapes',
    model: 'Reference uniform set',
    profileName: 'Uniform (generic)',
    rowHeights: [9, 9, 9, 9, 9, 9],
    seatAbovePlate: 4.5,
    taper: 2.5,
    material: 'ABS',
    tags: ['reference'],
    sources: [{ ...REFERENCE_SOURCE, confidence: 0.2 }],
    confidence: { level: 'estimated', score: 0.2, notes: 'Placeholder heights for visualisation; not a real profile.' },
  },
];

export const REFERENCE_STABILIZER: Stabilizer = {
  id: 'ref-stab-plate',
  slug: 'ref-stab-plate',
  brand: 'KeyboardShapes',
  model: 'Reference plate-mount stabilizer',
  mount: 'plate-mount',
  cutoutSpacing: { '2u': 23.8, '6.25u': 100, '7u': 114.3 },
  tags: ['reference'],
  sources: [{ ...REFERENCE_SOURCE, method: 'Cherry-style wire spacing commonly published' }],
  confidence: { level: 'estimated', score: 0.6 },
};

export const REFERENCE_FOAMS: Foam[] = [
  {
    id: 'ref-foam-case',
    slug: 'ref-foam-case',
    model: 'Reference case foam (3 mm)',
    thickness: 3,
    location: 'case',
    sources: [REFERENCE_SOURCE],
    confidence: confidence('Illustrative foam.'),
  },
];

/* ------------------------------------------------------------- the dataset */

export interface ReferenceDatabase {
  keyboards: Keyboard[];
  cases: Case[];
  pcbs: PCB[];
  plates: Plate[];
  daughterboards: Daughterboard[];
  switches: Switch[];
  keycaps: Keycap[];
  stabilizers: Stabilizer[];
  foams: Foam[];
}

interface KeyboardRecipe {
  key: string;
  layoutName: Parameters<typeof buildLayout>[0];
  label: string;
  withDaughterboard: boolean;
}

const RECIPES: KeyboardRecipe[] = [
  { key: '60', layoutName: '60%', label: '60%', withDaughterboard: false },
  { key: '65', layoutName: '65%', label: '65%', withDaughterboard: true },
  { key: '75', layoutName: '75%', label: '75%', withDaughterboard: true },
  { key: 'tkl', layoutName: 'TKL', label: 'TKL', withDaughterboard: false },
  { key: 'full', layoutName: 'Full Size', label: 'Full Size', withDaughterboard: false },
];

export const DB_CONNECTOR_A = 'reference-4pin';
export const DB_CONNECTOR_B = 'reference-5pin';

/** Side profile (front → back) of the top surface of the case. */
export function caseProfile(c: Case): Profile {
  const D = c.dimensions.depth;
  const angle = c.angle ?? 0;
  const front = c.frontHeight ?? 0;
  const rear = c.rearHeight ?? front;
  return {
    angle,
    frontHeight: front,
    rearHeight: rear,
    points: [0, 0.25, 0.5, 0.75, 1].map((t) => ({ x: round(t * D, 2), height: round(front + (rear - front) * t, 2) })),
  };
}

export function buildReferenceDatabase(): ReferenceDatabase {
  const db: ReferenceDatabase = {
    keyboards: [],
    cases: [],
    pcbs: [],
    plates: [],
    daughterboards: [],
    switches: [REFERENCE_SWITCH],
    keycaps: REFERENCE_KEYCAPS,
    stabilizers: [REFERENCE_STABILIZER],
    foams: REFERENCE_FOAMS,
  };

  const dbA = buildDaughterboard({ id: 'ref-daughterboard-a', model: 'Reference daughterboard A (4-pin)', connectorType: DB_CONNECTOR_A });
  const dbB = buildDaughterboard({ id: 'ref-daughterboard-b', model: 'Reference daughterboard B (5-pin)', connectorType: DB_CONNECTOR_B });
  db.daughterboards.push(dbA, dbB);

  for (const r of RECIPES) {
    const layout = buildLayout(r.layoutName);
    if (!layout) continue;
    const base = `ref-${r.key}`;
    const caseA = buildCase(layout, {
      ...DEFAULT_CASE,
      id: `${base}-case-a`,
      model: `Reference ${r.label} case A`,
      withDaughterboardArea: r.withDaughterboard,
    });
    const pcbA = buildPcb(layout, {
      id: `${base}-pcb-a`,
      model: `Reference ${r.label} PCB A`,
      margin: 2.5,
      holePattern: 'a',
      daughterboardConnector: r.withDaughterboard ? DB_CONNECTOR_A : undefined,
      undersideHeight: 3,
    });
    const plateA = buildPlate(layout, {
      id: `${base}-plate-a`,
      model: `Reference ${r.label} plate A`,
      margin: 3.5,
      holePattern: 'a',
      thickness: 1.5,
      material: 'aluminium',
    });
    db.cases.push(caseA);
    db.pcbs.push(pcbA);
    db.plates.push(plateA);

    // The 65% family carries the variants that exercise every compatibility outcome.
    if (r.key === '65') {
      db.cases.push(
        // thick walls + shallow floor: lateral clearance is tight and the PCB underside collides with the floor
        buildCase(layout, {
          ...DEFAULT_CASE,
          id: `${base}-case-b`,
          model: `Reference ${r.label} case B (low profile)`,
          wall: 5,
          floorToPcb: 2,
          withDaughterboardArea: true,
          tags: ['low-profile'],
        }),
        // USB cutout shifted 40 mm off-centre
        buildCase(layout, {
          ...DEFAULT_CASE,
          id: `${base}-case-c`,
          model: `Reference ${r.label} case C (offset USB cutout)`,
          usbCutoutOffset: 40,
          withDaughterboardArea: true,
          tags: ['offset-usb'],
        }),
      );
      db.pcbs.push(
        buildPcb(layout, {
          id: `${base}-pcb-b`,
          model: `Reference ${r.label} PCB B (alternate hole pattern)`,
          margin: 2.5,
          holePattern: 'b',
          daughterboardConnector: DB_CONNECTOR_A,
          undersideHeight: 3,
        }),
      );
      db.plates.push(
        buildPlate(layout, {
          id: `${base}-plate-b`,
          model: `Reference ${r.label} plate B (alternate hole pattern)`,
          margin: 3.5,
          holePattern: 'b',
          thickness: 1.5,
          material: 'brass',
        }),
      );
    }

    const caseOut = db.cases.find((c) => c.id === caseA.id) as Case;
    const profile = caseProfile(caseOut);
    const rows = new Set(layout.keys.map((k) => k.row)).size;
    const keycap = REFERENCE_KEYCAPS[0] as Keycap;
    const topRowHeight = keycap.rowHeights[Math.min(rows, keycap.rowHeights.length) - 1] ?? 9;
    const kb: Keyboard = {
      id: `${base}`,
      brand: 'KeyboardShapes',
      model: `Reference ${r.label} ANSI`,
      slug: `reference-${r.key}`,
      layout,
      dimensions: {
        width: caseOut.dimensions.width,
        depth: caseOut.dimensions.depth,
        height: round((caseOut.rearHeight ?? 0) + keycap.seatAbovePlate + topRowHeight, 1),
      },
      components: {
        caseId: caseA.id,
        pcbId: pcbA.id,
        plateId: plateA.id,
        daughterboardId: r.withDaughterboard ? dbA.id : undefined,
        switchId: REFERENCE_SWITCH.id,
        keycapId: keycap.id,
        stabilizerId: REFERENCE_STABILIZER.id,
        foamId: REFERENCE_FOAMS[0]?.id,
      },
      profile,
      tags: ['reference', r.label, 'illustrative'],
      features: { hotswap: true, wireless: false, knob: false },
      material: 'aluminium',
      sources: [REFERENCE_SOURCE],
      confidence: confidence('Illustrative parametric keyboard. Dimensions are generated, not measured.'),
      images: [],
      // pre-generated copy for download / other viewers; the app itself rebuilds the model from the geometry
      model3d: { kind: 'parametric', url: `models/${`reference-${r.key}`}.glb`, sourceName: 'generated by npm run generate:models' },
      addedAt: REFERENCE_TIMESTAMP,
    };
    db.keyboards.push(kb);
  }
  return db;
}

export const WALL_NORMALS: Record<Wall, Point2D> = {
  back: { x: 0, y: -1 },
  front: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function switchPositionsFor(layout: KeyboardLayout, offset: Point2D): SwitchPosition[] {
  return switchPositions(layout, offset);
}
