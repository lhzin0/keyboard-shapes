/**
 * Where does everything sit? One place that turns a component selection into
 * placements in the case frame, shared by the 2D views, the 3D assembly and the
 * compatibility summary — so every view agrees with what was verified.
 */
import { evaluateBuild, type BuildEvaluation, type BuildSelection } from '../compatibility/CompatibilityEngine';
import type { KeyboardLayout, Placement, Point2D } from '../types/keyboard';
import { KEY_PITCH_MM } from './layouts';

export interface ResolvedPlacements {
  /** True when key positions were not taken from a PCB/plate but placed by centring the key map in the case. */
  estimatedKeys: boolean;
  evaluation: BuildEvaluation;
  pcb: Placement;
  plate: Placement;
  daughterboard: Placement;
  /** Key centres in the case frame, indexed like the layout / PCB switch positions. */
  centers: Point2D[];
  /** Footprint of the assembly in the case frame. */
  width: number;
  depth: number;
}

export const ZERO_PLACEMENT: Placement = { dx: 0, dy: 0, method: 'manual', matched: 0, total: 0, residual: 0 };

export function resolvePlacements(sel: BuildSelection & { layout?: KeyboardLayout | null }): ResolvedPlacements {
  const evaluation = evaluateBuild(sel);
  const pcb = evaluation.placements.pcb ?? ZERO_PLACEMENT;
  const platePcb = evaluation.pairs.find((p) => p.a.type === 'plate' && p.b.type === 'pcb')?.placement;
  const plate: Placement =
    evaluation.placements.plate ??
    (platePcb && platePcb.matched === platePcb.total ? { ...platePcb, dx: pcb.dx + platePcb.dx, dy: pcb.dy + platePcb.dy } : ZERO_PLACEMENT);
  const daughterboard = evaluation.placements.daughterboard ?? ZERO_PLACEMENT;

  let centers: Point2D[] = [];
  if (sel.pcb) centers = sel.pcb.switchPositions.map((s) => ({ x: s.x + pcb.dx, y: s.y + pcb.dy }));
  else if (sel.plate) centers = sel.plate.switchCutouts.map((s) => ({ x: s.x + plate.dx, y: s.y + plate.dy }));

  let estimatedKeys = false;
  if (centers.length === 0 && sel.layout && sel.layout.keys.length > 0 && sel.case) {
    // no PCB/plate: use the key area measured on a photo, else centre the reference key map in the case (an estimate, flagged to the UI)
    const ox = sel.case.keyOrigin?.x ?? (sel.case.dimensions.width - sel.layout.widthU * KEY_PITCH_MM) / 2;
    const oy = sel.case.keyOrigin?.y ?? (sel.case.dimensions.depth - sel.layout.heightU * KEY_PITCH_MM) / 2;
    centers = sel.layout.keys.map((k) => ({ x: ox + (k.x + k.width / 2) * KEY_PITCH_MM, y: oy + (k.y + k.height / 2) * KEY_PITCH_MM }));
    estimatedKeys = true;
  }

  const width = sel.case?.dimensions.width ?? Math.max(sel.pcb?.dimensions.width ?? 0, sel.plate?.dimensions.width ?? 0, 100);
  const depth = sel.case?.dimensions.depth ?? Math.max(sel.pcb?.dimensions.depth ?? 0, sel.plate?.dimensions.depth ?? 0, 60);
  return { evaluation, pcb, plate, daughterboard, centers, estimatedKeys, width, depth };
}
