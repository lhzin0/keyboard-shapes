/**
 * Compatibility engine.
 *
 * Principles
 *  - "Similar" never means "compatible": every verdict is backed by geometric evidence.
 *  - Missing data yields `unknown`, never `compatible`.
 *  - The result is a pure function of the inputs (deterministic).
 */
import type {
  Case,
  CheckResult,
  CheckStatus,
  CompatibilityResult,
  ComponentRef,
  ComponentType,
  Daughterboard,
  PCB,
  Placement,
  Plate,
  Point2D,
  PrecisionLevel,
  Switch,
  Tolerances,
  Verdict,
} from '../types/keyboard';
import { DEFAULT_TOLERANCES } from '../types/keyboard';
import { checkTopStack, checkLateralClearance, mergeChecks } from './ClearanceCheck';
import { check, conclusionOf, makeResult, verdictOf, worstPrecision } from './common';
import { checkDaughterboard } from './DaughterboardCheck';
import { checkDimensions } from './DimensionsCheck';
import { checkMounting } from './MountingCheck';
import { centerPlacement, checkPcbInCase } from './PCBCaseCheck';
import { checkPlateOnPcb } from './PlateCheck';
import { matchAt } from '../geometry/registration';

const ref = (type: ComponentType, id: string): ComponentRef => ({ type, id });

/* ---------------------------------------------------------------- pair API */

export function evaluatePcbCase(pcb: PCB, c: Case, tol: Tolerances = DEFAULT_TOLERANCES): CompatibilityResult {
  const out = checkPcbInCase(pcb, c, tol);
  return makeResult(ref('pcb', pcb.id), ref('case', c.id), out.checks, worstPrecision([pcb.confidence.level, c.confidence.level]), out.placement);
}

export function evaluatePlatePcb(plate: Plate, pcb: PCB, tol: Tolerances = DEFAULT_TOLERANCES): CompatibilityResult {
  const out = checkPlateOnPcb(plate, pcb, tol);
  return makeResult(ref('plate', plate.id), ref('pcb', pcb.id), out.checks, worstPrecision([plate.confidence.level, pcb.confidence.level]), out.placement);
}

/** Plate directly against a case (no PCB in the picture): mounting posts + cavity clearance. */
export function evaluatePlateCase(
  plate: Plate,
  c: Case,
  tol: Tolerances = DEFAULT_TOLERANCES,
  knownPlacement?: Placement,
): CompatibilityResult {
  const checks: CheckResult[] = [];
  const cavity = c.internalCavity;
  checks.push(checkDimensions(plate.dimensions, cavity ? { width: cavity.width, depth: cavity.depth } : c.dimensions, 'Plate', cavity ? 'the case cavity' : 'the case', tol));

  let placement: Placement | undefined = knownPlacement;
  if (knownPlacement) {
    // placement comes from the PCB chain: verify posts under that placement
    if (plate.mountingPoints.length === 0 || c.mountingPoints.length === 0) {
      checks.push(check('mounting', 'Mounting', 'unknown', 'Plate screw holes or case posts are not recorded.'));
    } else {
      const m = matchAt(plate.mountingPoints, c.mountingPoints, knownPlacement.dx, knownPlacement.dy, tol.mountingMm);
      checks.push(
        m.matched === m.total
          ? check('mounting', 'Mounting', 'ok', `All ${m.total} plate screw holes sit over case posts (worst error ${m.residual.toFixed(2)} mm).`, { valueMm: m.residual })
          : check('mounting', 'Mounting', 'fail', `${m.total - m.matched} of ${m.total} plate screw holes have no case post beneath them.`),
      );
    }
  } else {
    const mount = checkMounting(plate.mountingPoints, c.mountingPoints, 'Plate', 'the case', tol);
    checks.push(mount.result);
    placement = mount.placement && mount.placement.matched === mount.placement.total ? mount.placement : undefined;
  }

  let assumption: string | undefined;
  if (!placement) {
    placement = cavity ? centerPlacement(plate.outline, cavity) : { dx: 0, dy: 0, method: 'center', matched: 0, total: 0, residual: 0 };
    assumption = 'Position assumed (plate centred in the cavity).';
  }
  checks.push(checkLateralClearance(plate.outline, cavity, placement.dx, placement.dy, 'Plate', tol, assumption));
  return makeResult(ref('plate', plate.id), ref('case', c.id), checks, worstPrecision([plate.confidence.level, c.confidence.level]), placement);
}

export function evaluateDaughterboard(
  db: Daughterboard,
  pcb: PCB | undefined,
  c: Case | undefined,
  pcbPlacement?: Placement,
  tol: Tolerances = DEFAULT_TOLERANCES,
): CompatibilityResult {
  const out = checkDaughterboard(db, pcb, pcbPlacement, c, tol);
  const target = pcb ? ref('pcb', pcb.id) : ref('case', c?.id ?? '');
  return makeResult(
    ref('daughterboard', db.id),
    target,
    out.checks,
    worstPrecision([db.confidence.level, pcb?.confidence.level, c?.confidence.level]),
    out.placement,
  );
}

/* ------------------------------------------------------------------ builds */

export interface BuildSelection {
  case?: Case;
  pcb?: PCB;
  plate?: Plate;
  daughterboard?: Daughterboard;
  switch?: Switch;
}

export interface Collision {
  between: [ComponentType, ComponentType];
  /** Approximate location in the case frame (mm). */
  at: Point2D;
  /** Penetration (positive, mm) when known. */
  depthMm?: number;
  description: string;
}

export interface BuildEvaluation {
  pairs: CompatibilityResult[];
  /** One merged row per category, in the order the UI shows them. */
  summary: CheckResult[];
  verdict: Verdict;
  conclusion: string;
  placements: { pcb?: Placement; plate?: Placement; daughterboard?: Placement };
  componentStatus: Partial<Record<ComponentType, CheckStatus>>;
  collisions: Collision[];
  dataQuality: PrecisionLevel;
}

const SUMMARY_ORDER: Array<[CheckResult['id'], string]> = [
  ['dimensions', 'Dimensions'],
  ['mounting', 'Mounting'],
  ['usb', 'USB'],
  ['plate', 'Plate'],
  ['clearance', 'Clearance'],
  ['daughterboard', 'Daughterboard'],
  ['collision', 'Collision'],
];

const RANK: Record<CheckStatus, number> = { ok: 0, warn: 1, unknown: 2, fail: 3 };

export function evaluateBuild(sel: BuildSelection, tol: Tolerances = DEFAULT_TOLERANCES): BuildEvaluation {
  const pairs: CompatibilityResult[] = [];
  const placements: BuildEvaluation['placements'] = {};
  const extra: CheckResult[] = [];

  let pcbCase: CompatibilityResult | undefined;
  if (sel.pcb && sel.case) {
    pcbCase = evaluatePcbCase(sel.pcb, sel.case, tol);
    pairs.push(pcbCase);
    placements.pcb = pcbCase.placement;
  }

  let platePcb: CompatibilityResult | undefined;
  if (sel.plate && sel.pcb) {
    platePcb = evaluatePlatePcb(sel.plate, sel.pcb, tol);
    pairs.push(platePcb);
  }

  if (sel.plate && sel.case) {
    let known: Placement | undefined;
    if (placements.pcb && platePcb?.placement && platePcb.placement.matched === platePcb.placement.total) {
      // plate → pcb → case
      known = {
        dx: placements.pcb.dx + platePcb.placement.dx,
        dy: placements.pcb.dy + platePcb.placement.dy,
        method: 'switches',
        matched: platePcb.placement.matched,
        total: platePcb.placement.total,
        residual: platePcb.placement.residual,
      };
    }
    const pc = evaluatePlateCase(sel.plate, sel.case, tol, known);
    pairs.push(pc);
    placements.plate = pc.placement;
  }

  if (sel.daughterboard) {
    const dbRes = evaluateDaughterboard(sel.daughterboard, sel.pcb, sel.case, placements.pcb, tol);
    pairs.push(dbRes);
    placements.daughterboard = dbRes.placement;
  }

  if (sel.case && sel.pcb && sel.plate && sel.switch) {
    extra.push(checkTopStack(sel.case, sel.pcb, sel.plate, sel.switch));
  }

  if (sel.pcb?.daughterboard && !sel.daughterboard && sel.case) {
    extra.push(check('usb', 'USB', 'unknown', 'This PCB relies on a daughterboard for USB — pick one to verify alignment.'));
  }

  const all = [...pairs.flatMap((p) => p.checks), ...extra];

  // Only one USB owner matters: a daughterboard replaces the PCB's own port.
  const effective = sel.daughterboard ? all.filter((c) => !(c.id === 'usb' && isPcbUsb(c, pairs))) : all;

  const summary: CheckResult[] = [];
  for (const [id, label] of SUMMARY_ORDER) {
    const parts = effective.filter((c) => c.id === id);
    if (parts.length) summary.push(mergeChecks(id, label, parts));
  }

  const verdict = verdictOf(summary);
  const componentStatus = componentStatuses(pairs);
  return {
    pairs,
    summary,
    verdict,
    conclusion: conclusionOf(verdict, summary),
    placements,
    componentStatus,
    collisions: collectCollisions(pairs, sel),
    dataQuality: worstPrecision(
      [sel.case, sel.pcb, sel.plate, sel.daughterboard, sel.switch].map((c) => c?.confidence.level),
    ),
  };
}

function isPcbUsb(c: CheckResult, pairs: CompatibilityResult[]): boolean {
  const pcbCase = pairs.find((p) => p.a.type === 'pcb' && p.b.type === 'case');
  return !!pcbCase && pcbCase.checks.includes(c);
}

function componentStatuses(pairs: CompatibilityResult[]): Partial<Record<ComponentType, CheckStatus>> {
  const out: Partial<Record<ComponentType, CheckStatus>> = {};
  const bump = (t: ComponentType, s: CheckStatus) => {
    const cur = out[t];
    if (cur === undefined || RANK[s] > RANK[cur]) out[t] = s;
  };
  for (const p of pairs) {
    const worst = p.checks.reduce<CheckStatus>((acc, c) => (RANK[c.status] > RANK[acc] ? c.status : acc), 'ok');
    bump(p.a.type, worst);
    bump(p.b.type, worst);
  }
  return out;
}

function collectCollisions(pairs: CompatibilityResult[], sel: BuildSelection): Collision[] {
  const out: Collision[] = [];
  const cavity = sel.case?.internalCavity;
  const fallback: Point2D = cavity ? { x: cavity.width / 2, y: cavity.depth / 2 } : { x: 0, y: 0 };
  for (const p of pairs) {
    for (const c of p.checks) {
      if (c.status !== 'fail') continue;
      if (c.id !== 'clearance' && c.id !== 'collision' && c.id !== 'daughterboard') continue;
      if (c.id === 'daughterboard' && !c.region) continue;
      out.push({
        between: [p.a.type, p.b.type],
        at: c.region ?? fallback,
        depthMm: c.valueMm !== undefined && c.valueMm < 0 ? -c.valueMm : undefined,
        description: c.summary,
      });
    }
  }
  return out;
}

/* ----------------------------------------------------------- reverse search */

export interface CompatDB {
  cases: Case[];
  pcbs: PCB[];
  plates: Plate[];
  daughterboards: Daughterboard[];
}

export interface CompatibleMatch<T> {
  item: T;
  result: CompatibilityResult;
}

const VERDICT_RANK: Record<Verdict, number> = { compatible: 0, tight: 1, partial: 2, unknown: 3, incompatible: 4 };

function ranked<T>(list: CompatibleMatch<T>[]): CompatibleMatch<T>[] {
  return list.sort((a, b) => VERDICT_RANK[a.result.verdict] - VERDICT_RANK[b.result.verdict]);
}

/** "Find compatible …" for a given component. Returns every candidate, best first. */
export function findCompatible(
  target: ComponentRef,
  db: CompatDB,
  tol: Tolerances = DEFAULT_TOLERANCES,
): { type: ComponentType; matches: CompatibleMatch<Case | PCB | Plate | Daughterboard>[] }[] {
  const find = {
    case: (id: string) => db.cases.find((c) => c.id === id),
    pcb: (id: string) => db.pcbs.find((c) => c.id === id),
    plate: (id: string) => db.plates.find((c) => c.id === id),
    daughterboard: (id: string) => db.daughterboards.find((c) => c.id === id),
  };
  const groups: { type: ComponentType; matches: CompatibleMatch<Case | PCB | Plate | Daughterboard>[] }[] = [];

  if (target.type === 'pcb') {
    const pcb = find.pcb(target.id);
    if (!pcb) return groups;
    groups.push({ type: 'case', matches: ranked(db.cases.map((item) => ({ item, result: evaluatePcbCase(pcb, item, tol) }))) });
    groups.push({ type: 'plate', matches: ranked(db.plates.map((item) => ({ item, result: evaluatePlatePcb(item, pcb, tol) }))) });
    groups.push({
      type: 'daughterboard',
      matches: ranked(db.daughterboards.map((item) => ({ item, result: evaluateDaughterboard(item, pcb, undefined, undefined, tol) }))),
    });
  } else if (target.type === 'case') {
    const c = find.case(target.id);
    if (!c) return groups;
    groups.push({ type: 'pcb', matches: ranked(db.pcbs.map((item) => ({ item, result: evaluatePcbCase(item, c, tol) }))) });
    groups.push({ type: 'plate', matches: ranked(db.plates.map((item) => ({ item, result: evaluatePlateCase(item, c, tol) }))) });
    groups.push({
      type: 'daughterboard',
      matches: ranked(db.daughterboards.map((item) => ({ item, result: evaluateDaughterboard(item, undefined, c, undefined, tol) }))),
    });
  } else if (target.type === 'plate') {
    const plate = find.plate(target.id);
    if (!plate) return groups;
    groups.push({ type: 'pcb', matches: ranked(db.pcbs.map((item) => ({ item, result: evaluatePlatePcb(plate, item, tol) }))) });
    groups.push({ type: 'case', matches: ranked(db.cases.map((item) => ({ item, result: evaluatePlateCase(plate, item, tol) }))) });
  } else if (target.type === 'daughterboard') {
    const db0 = find.daughterboard(target.id);
    if (!db0) return groups;
    groups.push({ type: 'pcb', matches: ranked(db.pcbs.map((item) => ({ item, result: evaluateDaughterboard(db0, item, undefined, undefined, tol) }))) });
    groups.push({ type: 'case', matches: ranked(db.cases.map((item) => ({ item, result: evaluateDaughterboard(db0, undefined, item, undefined, tol) }))) });
  }
  return groups;
}
