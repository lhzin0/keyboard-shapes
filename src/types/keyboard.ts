/**
 * Central domain types for KeyboardShapes.
 *
 * Conventions (apply everywhere):
 *  - Every length is in millimetres. Pixels never appear in the domain model.
 *  - 2D frame of a component: x → right, y → toward the FRONT of the keyboard
 *    (so y grows downward in the top view, exactly like SVG). The origin is the
 *    top-left (back-left) corner of the component's external bounding box.
 *  - Heights are along the vertical axis of the component's own frame
 *    (before the typing angle is applied).
 *  - Components never embed one another: relations are expressed with ids.
 */

export type Millimetres = number;
export type Degrees = number;

export interface Point2D {
  x: Millimetres;
  y: Millimetres;
}

/* ---------------------------------------------------------------- provenance */

/** How trustworthy a number is. Ordered from best to worst. */
export type PrecisionLevel =
  | 'official'
  | 'cad'
  | 'measured'
  | 'reconstructed'
  | 'estimated'
  | 'unknown';

export type SourceType =
  | 'manufacturer'
  | 'cad'
  | 'vendor'
  | 'community'
  | 'user-measurement'
  | 'photo-reconstruction'
  | 'parametric-reference'
  | 'unknown';

export interface SourceInfo {
  sourceUrl?: string;
  sourceName: string;
  sourceType: SourceType;
  /** ISO-8601 timestamp of the retrieval/creation. */
  retrievedAt: string;
  method: string;
  /** 0..1 */
  confidence: number;
}

export interface ConfidenceInfo {
  level: PrecisionLevel;
  /** 0..1 */
  score: number;
  notes?: string;
}

/** A single measured/derived value with its provenance. */
export interface Measurement {
  value: number | null;
  unit: 'mm' | 'deg' | 'g' | 'u';
  source: SourceType;
  confidence: number;
  method?: string;
}

/* ------------------------------------------------------------------ geometry */

/** Spec name alias. */
export type Dimension = Dimensions;

export interface Dimensions {
  width: Millimetres;
  depth: Millimetres;
  /** Overall height (rear/highest point for a keyboard, thickness for a flat part). */
  height?: Millimetres;
}

/**
 * A polygon (closed unless `closed` is false) in the owner's local frame.
 * `width`/`depth` are the bounding-box extents of `points`.
 */
export interface Shape {
  points: Point2D[];
  width: Millimetres;
  depth: Millimetres;
  closed: boolean;
}

/** A point of the side profile: height measured at distance `x` from the front. */
export interface ProfilePoint {
  x: Millimetres;
  height: Millimetres;
}

export interface Profile {
  /** Samples ordered by `x` (front → back). */
  points: ProfilePoint[];
  frontHeight: Millimetres;
  rearHeight: Millimetres;
  angle: Degrees;
}

export type Wall = 'front' | 'back' | 'left' | 'right';

export type MountingKind = 'screw' | 'standoff' | 'gasket' | 'tab' | 'pin';

export interface MountingPoint {
  id: string;
  x: Millimetres;
  y: Millimetres;
  diameter?: Millimetres;
  kind: MountingKind;
}

export interface PortPosition {
  /** Centre of the receptacle in the owner's frame. */
  x: Millimetres;
  y: Millimetres;
  /** Opening width along the wall. */
  width: Millimetres;
  height?: Millimetres;
  /** Wall the port faces. */
  facing: Wall;
  type?: string;
}

export interface Cutout {
  id: string;
  kind: 'usb' | 'cable' | 'reset' | 'knob' | 'other';
  wall: Wall;
  /** Centre along the wall (x for front/back walls, y for left/right walls). */
  center: Millimetres;
  width: Millimetres;
  height?: Millimetres;
}

export interface KeepOutZone {
  id: string;
  label: string;
  rect: { x: Millimetres; y: Millimetres; width: Millimetres; depth: Millimetres };
  /** Which side of the board the obstacle is on. */
  side: 'top' | 'bottom';
  height?: Millimetres;
}

export interface Model3D {
  /** glb = official/community model file, parametric = generated from geometry. */
  kind: 'cad' | 'glb' | 'reconstructed' | 'parametric' | 'estimated';
  url?: string;
  sourceName?: string;
}

/* -------------------------------------------------------------------- layout */

export type LayoutName =
  | '40%'
  | '50%'
  | '60%'
  | '65%'
  | '70%'
  | '75%'
  | '80%'
  | 'TKL'
  | '96%'
  | '1800'
  | 'Full Size'
  | 'Alice'
  | 'Split'
  | 'Ergo'
  | 'Custom';

export interface KeyDef {
  /** Top-left corner in key units (1u = 19.05 mm). */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: Degrees;
  label: string;
  row: number;
  /** e.g. "1u", "2.25u", "6.25u" */
  keycapSize: string;
}

export interface KeyboardLayout {
  name: LayoutName;
  /** Marketing label, e.g. "ANSI 65%". */
  description?: string;
  keys: KeyDef[];
  widthU: number;
  heightU: number;
  keyCount: number;
}

/* ---------------------------------------------------------------- components */

export interface SwitchPosition {
  keyIndex: number;
  /** Centre of the switch in the owner's frame. */
  x: Millimetres;
  y: Millimetres;
  rotation: Degrees;
}

export interface StabilizerPosition {
  keyIndex: number;
  /** Centre of the stabilizer bar between both wire holes. */
  x: Millimetres;
  y: Millimetres;
  /** Distance between stabilizer centres. */
  spacing: Millimetres;
  rotation: Degrees;
}

export interface DaughterboardInterface {
  connectorType: string;
  /** Where the connector header sits on the PCB. */
  position: Point2D;
}

export interface ClearanceData {
  /** Free space between the case floor and the underside of the PCB (mm). */
  floorToPcb?: Millimetres;
  /** Plate top surface → rim of the case (positive: the rim is higher). */
  plateTopToRim?: Millimetres;
}

export interface Case {
  id: string;
  slug: string;
  brand?: string;
  model?: string;
  dimensions: Dimensions;
  externalShape: Shape;
  internalCavity?: Shape;
  profile?: Profile;
  /** Angle between the typing surface and the desk. */
  angle?: Degrees;
  frontHeight?: Millimetres;
  rearHeight?: Millimetres;
  wallThickness?: Millimetres;
  floorThickness?: Millimetres;
  /** Posts/bosses the PCB or plate screws into (case frame). */
  mountingPoints: MountingPoint[];
  /** Screws that hold the top case to the bottom case. */
  screwHoles?: MountingPoint[];
  cutouts: Cutout[];
  /** Rectangular area reserved for a daughterboard (case frame). */
  daughterboardArea?: { x: Millimetres; y: Millimetres; width: Millimetres; depth: Millimetres };
  clearance?: ClearanceData;
  material?: string;
  weight?: Measurement;
  model3d?: Model3D;
  images?: string[];
  tags?: string[];
  sources: SourceInfo[];
  confidence: ConfidenceInfo;
}

export interface PCB {
  id: string;
  slug: string;
  brand?: string;
  model?: string;
  dimensions: Dimensions;
  outline: Shape;
  thickness?: Millimetres;
  /** Tallest component on the underside — limits the room needed below the PCB. */
  undersideHeight?: Millimetres;
  mountingPoints: MountingPoint[];
  switchPositions: SwitchPosition[];
  stabilizerPositions?: StabilizerPosition[];
  usbPort?: PortPosition;
  daughterboard?: DaughterboardInterface;
  keepOutZones?: KeepOutZone[];
  features?: { wireless?: boolean; hotswap?: boolean; knob?: boolean; battery?: boolean };
  batteryArea?: { x: Millimetres; y: Millimetres; width: Millimetres; depth: Millimetres; height?: Millimetres };
  model3d?: Model3D;
  images?: string[];
  tags?: string[];
  sources: SourceInfo[];
  confidence: ConfidenceInfo;
}

export interface Plate {
  id: string;
  slug: string;
  brand?: string;
  model?: string;
  dimensions: Dimensions;
  outline: Shape;
  thickness: Millimetres;
  material?: string;
  /** Centres of the switch cutouts (plate frame). */
  switchCutouts: SwitchPosition[];
  stabilizerCutouts?: StabilizerPosition[];
  mountingPoints: MountingPoint[];
  model3d?: Model3D;
  images?: string[];
  tags?: string[];
  sources: SourceInfo[];
  confidence: ConfidenceInfo;
}

export interface Daughterboard {
  id: string;
  slug: string;
  brand?: string;
  model?: string;
  dimensions: Dimensions;
  outline: Shape;
  thickness?: Millimetres;
  mountingPoints: MountingPoint[];
  /** USB receptacle in the daughterboard frame. */
  usbPort: PortPosition;
  connectorType: string;
  connectorPosition: Point2D;
  cableExit?: Wall;
  model3d?: Model3D;
  images?: string[];
  tags?: string[];
  sources: SourceInfo[];
  confidence: ConfidenceInfo;
}

export type SwitchStyle = 'MX' | 'Choc' | 'Alps' | 'Other';

export interface Switch {
  id: string;
  slug: string;
  brand?: string;
  model: string;
  style: SwitchStyle;
  /** Plate surface → PCB top surface. */
  plateToPcb: Millimetres;
  /** Height of the switch above the plate surface. */
  topHeight: Millimetres;
  /** Required square cutout in the plate. */
  cutout: { width: Millimetres; depth: Millimetres };
  type?: 'linear' | 'tactile' | 'clicky';
  sources: SourceInfo[];
  confidence: ConfidenceInfo;
  tags?: string[];
}

export interface Keycap {
  id: string;
  slug: string;
  brand?: string;
  model: string;
  profileName: string;
  /** Keycap body height per row, index 0 = bottom (spacebar) row, last = function row. */
  rowHeights: Millimetres[];
  /** Distance from the plate surface to the underside (skirt) of the keycap. */
  seatAbovePlate: Millimetres;
  /** Top face reduction relative to the base (each side). */
  taper: Millimetres;
  material?: string;
  sources: SourceInfo[];
  confidence: ConfidenceInfo;
  tags?: string[];
}

export interface Stabilizer {
  id: string;
  slug: string;
  brand?: string;
  model: string;
  mount: 'plate-mount' | 'screw-in' | 'pcb-snap-in';
  /** Plate cutout needed. */
  cutoutSpacing: Record<string, Millimetres>;
  sources: SourceInfo[];
  confidence: ConfidenceInfo;
  tags?: string[];
}

export interface Foam {
  id: string;
  slug: string;
  model: string;
  thickness: Millimetres;
  location: 'case' | 'plate' | 'pcb';
  sources: SourceInfo[];
  confidence: ConfidenceInfo;
}

/* ------------------------------------------------------------------ keyboard */

export interface KeyboardComponents {
  caseId?: string;
  pcbId?: string;
  plateId?: string;
  daughterboardId?: string;
  switchId?: string;
  keycapId?: string;
  stabilizerId?: string;
  foamId?: string;
}

export interface Keyboard {
  id: string;
  brand: string;
  model: string;
  slug: string;
  layout: KeyboardLayout;
  dimensions: Dimensions;
  components: KeyboardComponents;
  shape?: Shape;
  profile?: Profile;
  tags?: string[];
  features?: { wireless?: boolean; knob?: boolean; hotswap?: boolean };
  material?: string;
  weight?: Measurement;
  sources: SourceInfo[];
  confidence: ConfidenceInfo;
  images: string[];
  model3d?: Model3D;
  addedAt?: string;
}

/* ------------------------------------------------------------- compatibility */

export type ComponentType =
  | 'case'
  | 'pcb'
  | 'plate'
  | 'daughterboard'
  | 'switch'
  | 'keycap'
  | 'stabilizer'
  | 'foam';

export interface ComponentRef {
  type: ComponentType;
  id: string;
}

export type CheckId =
  | 'dimensions'
  | 'mounting'
  | 'clearance'
  | 'usb'
  | 'plate'
  | 'daughterboard'
  | 'collision';

/** ok = verified fine · warn = fits but tight · fail = proven incompatible · unknown = data missing */
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export interface CheckResult {
  id: CheckId;
  label: string;
  status: CheckStatus;
  summary: string;
  /** Numeric evidence in mm when relevant (e.g. smallest clearance). */
  valueMm?: number;
  /** Where the problem is, in the frame of the fixed component (usually the case). */
  region?: Point2D;
  details?: string[];
}

export type Verdict = 'compatible' | 'tight' | 'partial' | 'incompatible' | 'unknown';

export interface Placement {
  /** Translation that maps the moving component's frame into the fixed component's frame. */
  dx: Millimetres;
  dy: Millimetres;
  method: 'mounting' | 'switches' | 'center' | 'manual';
  matched: number;
  total: number;
  /** Largest remaining distance of a matched pair (mm). */
  residual: number;
}

export interface CompatibilityResult {
  a: ComponentRef;
  b: ComponentRef;
  checks: CheckResult[];
  verdict: Verdict;
  conclusion: string;
  placement?: Placement;
  /** Lowest precision among the data that was used. */
  dataQuality: PrecisionLevel;
}

/** Explicit, asserted relations stored in data/compatibility.json. */
export interface CompatibilityRelation {
  from: ComponentRef;
  to: ComponentRef;
  kind: 'fits' | 'ships-with' | 'declared-compatible' | 'declared-incompatible';
  source: SourceInfo;
}

export interface Tolerances {
  /** Max distance for two mounting points to be considered coincident. */
  mountingMm: number;
  /** Lateral clearance below which a fit is "tight". */
  tightClearanceMm: number;
  /** Switch cutout alignment tolerance. */
  cutoutMm: number;
  /** Margin kept between a USB receptacle and the edge of the case cutout. */
  usbMarginMm: number;
}

export const DEFAULT_TOLERANCES: Tolerances = {
  mountingMm: 0.5,
  tightClearanceMm: 1.0,
  cutoutMm: 0.5,
  usbMarginMm: 0.5,
};
