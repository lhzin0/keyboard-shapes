import { findCompatible } from '../compatibility/CompatibilityEngine';
import type { CatalogItem, ItemKind } from '../search';
import { compatDb } from '../services/database';
import type { ComponentRef } from '../types/keyboard';

export type Range = [number, number];
export type Tri = 'any' | 'yes' | 'no';

export interface FilterState {
  kinds: ItemKind[];
  brands: string[];
  layouts: string[];
  materials: string[];
  mounting: string[];
  width: Range | null;
  depth: Range | null;
  height: Range | null;
  angle: Range | null;
  keys: Range | null;
  wireless: Tri;
  knob: Tri;
  /** "Compatible with …": hides items that are proven incompatible with this component. */
  compatibleWith: ComponentRef | null;
}

export const emptyFilters = (): FilterState => ({
  kinds: [],
  brands: [],
  layouts: [],
  materials: [],
  mounting: [],
  width: null,
  depth: null,
  height: null,
  angle: null,
  keys: null,
  wireless: 'any',
  knob: 'any',
  compatibleWith: null,
});

export interface Facets {
  brands: string[];
  layouts: string[];
  materials: string[];
  mounting: string[];
  width: Range;
  depth: Range;
  height: Range;
  angle: Range;
  keys: Range;
}

const range = (vals: Array<number | undefined>): Range => {
  const v = vals.filter((x): x is number => x !== undefined && Number.isFinite(x));
  return v.length ? [Math.floor(Math.min(...v)), Math.ceil(Math.max(...v))] : [0, 0];
};
const uniq = (v: Array<string | undefined>) => [...new Set(v.filter((x): x is string => !!x))].sort();

export function facets(items: CatalogItem[]): Facets {
  return {
    brands: uniq(items.map((i) => i.brand)),
    layouts: uniq(items.map((i) => i.layout)),
    materials: uniq(items.map((i) => i.material)),
    mounting: uniq(items.flatMap((i) => i.mounting)),
    width: range(items.map((i) => i.width)),
    depth: range(items.map((i) => i.depth)),
    height: range(items.map((i) => i.height)),
    angle: range(items.map((i) => i.angle)),
    keys: range(items.map((i) => i.keys)),
  };
}

const inRange = (v: number | undefined, r: Range | null) => r === null || (v !== undefined && v >= r[0] && v <= r[1]);
const tri = (v: boolean | undefined, t: Tri) => t === 'any' || (t === 'yes' ? v === true : v === false);

export function activeFilterCount(f: FilterState): number {
  return (
    f.kinds.length +
    f.brands.length +
    f.layouts.length +
    f.materials.length +
    f.mounting.length +
    [f.width, f.depth, f.height, f.angle, f.keys].filter(Boolean).length +
    (f.wireless !== 'any' ? 1 : 0) +
    (f.knob !== 'any' ? 1 : 0) +
    (f.compatibleWith ? 1 : 0)
  );
}

export function applyFilters(items: CatalogItem[], f: FilterState): CatalogItem[] {
  let allowed: Set<string> | null = null;
  if (f.compatibleWith) {
    allowed = new Set();
    for (const g of findCompatible(f.compatibleWith, compatDb)) {
      for (const m of g.matches) if (m.result.verdict !== 'incompatible') allowed.add(`${g.type}:${m.item.id}`);
    }
  }
  return items.filter((i) => {
    if (f.kinds.length && !f.kinds.includes(i.kind)) return false;
    if (f.brands.length && !(i.brand && f.brands.includes(i.brand))) return false;
    if (f.layouts.length && !(i.layout && f.layouts.includes(i.layout))) return false;
    if (f.materials.length && !(i.material && f.materials.includes(i.material))) return false;
    if (f.mounting.length && !i.mounting.some((m) => f.mounting.includes(m))) return false;
    if (!inRange(i.width, f.width) || !inRange(i.depth, f.depth) || !inRange(i.height, f.height) || !inRange(i.angle, f.angle) || !inRange(i.keys, f.keys)) return false;
    if (!tri(i.wireless, f.wireless) || !tri(i.knob, f.knob)) return false;
    if (allowed && !allowed.has(`${i.kind}:${i.id}`)) return false;
    return true;
  });
}
