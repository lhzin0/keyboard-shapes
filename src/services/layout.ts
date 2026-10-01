import { buildLayout } from '../geometry/layouts';
import type { Case, KeyboardLayout, LayoutName, PCB, Plate } from '../types/keyboard';
import { db } from './database';

const NAMES: LayoutName[] = ['40%', '50%', '60%', '65%', '70%', '75%', '80%', 'TKL', '96%', '1800', 'Full Size', 'Alice', 'Split', 'Ergo'];

/**
 * Which key map belongs to these parts? Tries (1) a layout recorded in the tags that matches the
 * switch count, then (2) the layout of a keyboard that ships with the part. Returns null if unknown —
 * the caller must then skip keycaps rather than guess.
 */
export function inferLayout(parts: { pcb?: PCB; plate?: Plate; case?: Case }, preferred?: LayoutName): KeyboardLayout | null {
  const switches = parts.pcb?.switchPositions.length ?? parts.plate?.switchCutouts.length;
  const candidates: LayoutName[] = [];
  if (preferred) candidates.push(preferred);
  for (const p of [parts.pcb, parts.plate, parts.case]) {
    for (const t of p?.tags ?? []) if ((NAMES as string[]).includes(t)) candidates.push(t as LayoutName);
  }
  for (const name of candidates) {
    const l = buildLayout(name);
    if (l && (switches === undefined || l.keyCount === switches)) return l;
  }
  for (const kb of db.keyboards) {
    const c = kb.components;
    if ((parts.pcb && c.pcbId === parts.pcb.id) || (parts.plate && c.plateId === parts.plate.id) || (parts.case && c.caseId === parts.case.id)) {
      if (switches === undefined || kb.layout.keyCount === switches) return kb.layout;
    }
  }
  return null;
}
