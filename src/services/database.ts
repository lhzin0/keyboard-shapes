/**
 * Static, versioned JSON database (see /data).
 *
 * Records never embed one another: a Keyboard references its parts by id and
 * `resolveKeyboard` joins them on demand. The compatibility graph is derived
 * from those references plus the explicit relations in compatibility.json.
 */
import keyboardsJson from '../../data/keyboards.json';
import casesJson from '../../data/cases.json';
import pcbsJson from '../../data/pcbs.json';
import platesJson from '../../data/plates.json';
import switchesJson from '../../data/switches.json';
import keycapsJson from '../../data/keycaps.json';
import daughterboardsJson from '../../data/daughterboards.json';
import stabilizersJson from '../../data/stabilizers.json';
import foamsJson from '../../data/foams.json';
import compatibilityJson from '../../data/compatibility.json';
import type {
  Case,
  CompatibilityRelation,
  ComponentRef,
  ComponentType,
  Daughterboard,
  Foam,
  Keyboard,
  Keycap,
  PCB,
  Plate,
  Stabilizer,
  Switch,
} from '../types/keyboard';

export interface Database {
  keyboards: Keyboard[];
  cases: Case[];
  pcbs: PCB[];
  plates: Plate[];
  switches: Switch[];
  keycaps: Keycap[];
  daughterboards: Daughterboard[];
  stabilizers: Stabilizer[];
  foams: Foam[];
  relations: CompatibilityRelation[];
}

// JSON modules are validated by `npm run validate` (CI); here they are trusted.
export const db: Database = {
  keyboards: keyboardsJson as unknown as Keyboard[],
  cases: casesJson as unknown as Case[],
  pcbs: pcbsJson as unknown as PCB[],
  plates: platesJson as unknown as Plate[],
  switches: switchesJson as unknown as Switch[],
  keycaps: keycapsJson as unknown as Keycap[],
  daughterboards: daughterboardsJson as unknown as Daughterboard[],
  stabilizers: stabilizersJson as unknown as Stabilizer[],
  foams: foamsJson as unknown as Foam[],
  relations: compatibilityJson as unknown as CompatibilityRelation[],
};

export type AnyComponent = Case | PCB | Plate | Daughterboard | Switch | Keycap | Stabilizer | Foam;

export const COMPONENT_LISTS: Record<ComponentType, () => AnyComponent[]> = {
  case: () => db.cases,
  pcb: () => db.pcbs,
  plate: () => db.plates,
  daughterboard: () => db.daughterboards,
  switch: () => db.switches,
  keycap: () => db.keycaps,
  stabilizer: () => db.stabilizers,
  foam: () => db.foams,
};

export const COMPONENT_LABEL: Record<ComponentType, string> = {
  case: 'Case',
  pcb: 'PCB',
  plate: 'Plate',
  daughterboard: 'Daughterboard',
  switch: 'Switch',
  keycap: 'Keycaps',
  stabilizer: 'Stabilizer',
  foam: 'Foam',
};

export function isComponentType(v: string): v is ComponentType {
  return v in COMPONENT_LISTS;
}

export function getComponent<T extends AnyComponent = AnyComponent>(type: ComponentType, idOrSlug: string | undefined): T | undefined {
  if (!idOrSlug) return undefined;
  return COMPONENT_LISTS[type]().find((c) => c.id === idOrSlug || c.slug === idOrSlug) as T | undefined;
}

export function getKeyboard(slugOrId: string | undefined): Keyboard | undefined {
  return db.keyboards.find((k) => k.slug === slugOrId || k.id === slugOrId);
}

export interface ResolvedKeyboard {
  keyboard: Keyboard;
  case?: Case;
  pcb?: PCB;
  plate?: Plate;
  daughterboard?: Daughterboard;
  switch?: Switch;
  keycap?: Keycap;
  stabilizer?: Stabilizer;
  foam?: Foam;
}

export function resolveKeyboard(keyboard: Keyboard): ResolvedKeyboard {
  const c = keyboard.components;
  return {
    keyboard,
    case: getComponent<Case>('case', c.caseId),
    pcb: getComponent<PCB>('pcb', c.pcbId),
    plate: getComponent<Plate>('plate', c.plateId),
    daughterboard: getComponent<Daughterboard>('daughterboard', c.daughterboardId),
    switch: getComponent<Switch>('switch', c.switchId),
    keycap: getComponent<Keycap>('keycap', c.keycapId),
    stabilizer: getComponent<Stabilizer>('stabilizer', c.stabilizerId),
    foam: getComponent<Foam>('foam', c.foamId),
  };
}

/* ----------------------------------------------------- compatibility graph */

export type EdgeKind = CompatibilityRelation['kind'] | 'uses';

/** A node of the graph: a component or a whole keyboard. */
export interface NodeRef {
  type: ComponentType | 'keyboard';
  id: string;
}

export interface GraphEdge {
  from: NodeRef;
  to: NodeRef;
  kind: EdgeKind;
}

const keyOf = (r: NodeRef) => `${r.type}:${r.id}`;

/**
 * Edges: Keyboard → {PCB, Case, Plate, Daughterboard} (from component ids) plus
 * the asserted relations of compatibility.json. Reverse lookups are O(degree).
 */
export function buildGraph(): { edges: GraphEdge[]; out: Map<string, GraphEdge[]>; into: Map<string, GraphEdge[]> } {
  const edges: GraphEdge[] = [];
  for (const kb of db.keyboards) {
    const c = kb.components;
    const parts: Array<[ComponentType, string | undefined]> = [
      ['case', c.caseId],
      ['pcb', c.pcbId],
      ['plate', c.plateId],
      ['daughterboard', c.daughterboardId],
    ];
    // Keyboard → PCB / Case / Plate / Daughterboard
    for (const [type, id] of parts) {
      if (id) edges.push({ from: { type: 'keyboard', id: kb.id }, to: { type, id }, kind: 'uses' });
    }
    // parts of the same keyboard are known to fit each other
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i];
        const b = parts[j];
        if (a?.[1] && b?.[1]) edges.push({ from: { type: a[0], id: a[1] }, to: { type: b[0], id: b[1] }, kind: 'ships-with' });
      }
    }
  }
  for (const r of db.relations) edges.push({ from: r.from, to: r.to, kind: r.kind });

  const out = new Map<string, GraphEdge[]>();
  const into = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    for (const [map, k] of [
      [out, keyOf(e.from)],
      [into, keyOf(e.to)],
    ] as const) {
      const list = map.get(k);
      if (list) list.push(e);
      else map.set(k, [e]);
    }
  }
  return { edges, out, into };
}

let graphCache: ReturnType<typeof buildGraph> | null = null;
export function resetGraph(): void {
  graphCache = null;
}
export function graph() {
  graphCache ??= buildGraph();
  return graphCache;
}

/** Edges touching a component, in either direction. */
export function relationsOf(ref: NodeRef): GraphEdge[] {
  const g = graph();
  return [...(g.out.get(keyOf(ref)) ?? []), ...(g.into.get(keyOf(ref)) ?? [])];
}

/** Keyboards that ship with a component (reverse query). */
export function keyboardsUsing(ref: ComponentRef): Keyboard[] {
  const field = { case: 'caseId', pcb: 'pcbId', plate: 'plateId', daughterboard: 'daughterboardId', switch: 'switchId', keycap: 'keycapId', stabilizer: 'stabilizerId', foam: 'foamId' } as const;
  const f = field[ref.type];
  return db.keyboards.filter((k) => k.components[f] === ref.id);
}

export const compatDb = {
  get cases() {
    return db.cases;
  },
  get pcbs() {
    return db.pcbs;
  },
  get plates() {
    return db.plates;
  },
  get daughterboards() {
    return db.daughterboards;
  },
};
