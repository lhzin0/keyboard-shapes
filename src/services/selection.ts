import type { AssemblySelection } from '../geometry/3d/KeyboardAssembly';
import type { CompareItem } from '../stores';
import type { Case, Daughterboard, PCB, Plate } from '../types/keyboard';
import { db, getComponent, getKeyboard, resolveKeyboard } from './database';
import { inferLayout } from './layout';

/** Viewer selection for any comparable item (a keyboard or a single component). */
export function selectionOfItem(item: CompareItem): AssemblySelection | null {
  if (item.kind === 'keyboard') {
    const kb = getKeyboard(item.id);
    if (!kb) return null;
    const p = resolveKeyboard(kb);
    return {
      case: p.case,
      pcb: p.pcb,
      plate: p.plate,
      daughterboard: p.daughterboard,
      switch: p.switch,
      keycap: p.keycap,
      stabilizer: p.stabilizer,
      foam: p.foam,
      layout: kb.layout,
      profile: kb.profile,
    };
  }
  const sw = db.switches[0];
  const kc = db.keycaps[0];
  switch (item.kind) {
    case 'case': {
      const c = getComponent<Case>('case', item.id);
      return c ? { case: c } : null;
    }
    case 'pcb': {
      const pcb = getComponent<PCB>('pcb', item.id);
      return pcb ? { pcb, switch: sw, keycap: kc, layout: inferLayout({ pcb }) } : null;
    }
    case 'plate': {
      const plate = getComponent<Plate>('plate', item.id);
      return plate ? { plate, switch: sw, keycap: kc, layout: inferLayout({ plate }) } : null;
    }
    case 'daughterboard': {
      const d = getComponent<Daughterboard>('daughterboard', item.id);
      return d ? { daughterboard: d } : null;
    }
    default:
      return null;
  }
}

export const selectionKey = (item: CompareItem) => `${item.kind}:${item.id}`;
