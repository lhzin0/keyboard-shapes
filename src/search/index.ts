import { db, COMPONENT_LABEL, getComponent } from '../services/database';
import type { Case, ComponentType, ConfidenceInfo, Daughterboard, Keyboard, PCB, Plate, Switch, Keycap, Stabilizer, Foam } from '../types/keyboard';

export type ItemKind = 'keyboard' | ComponentType;

/** One searchable/filterable record, flattened from keyboards and components. */
export interface CatalogItem {
  kind: ItemKind;
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  brand?: string;
  layout?: string;
  width?: number;
  depth?: number;
  height?: number;
  angle?: number;
  keys?: number;
  wireless?: boolean;
  knob?: boolean;
  mounting: string[];
  material?: string;
  tags: string[];
  confidence: ConfidenceInfo;
  /** Lower-case haystack used for text matching. */
  text: string;
  href: string;
}

const base = (kind: ItemKind, id: string, slug: string, brand: string | undefined, model: string | undefined): Pick<CatalogItem, 'kind' | 'id' | 'slug' | 'title' | 'brand' | 'href'> => ({
  kind,
  id,
  slug,
  brand,
  title: `${brand ?? ''} ${model ?? id}`.trim(),
  href: kind === 'keyboard' ? `/keyboard/${slug}` : `/component/${kind}/${slug}`,
});

function mountingKinds(points: Array<{ kind: string }> | undefined): string[] {
  return [...new Set((points ?? []).map((p) => p.kind))];
}

function fromKeyboard(k: Keyboard): CatalogItem {
  const parts = [k.brand, k.model, k.layout.name, ...(k.tags ?? []), k.material ?? '', 'keyboard'];
  const c = getComponent<Case>('case', k.components.caseId);
  return {
    ...base('keyboard', k.id, k.slug, k.brand, k.model),
    subtitle: `${k.layout.name} · ${k.dimensions.width.toFixed(0)} × ${k.dimensions.depth.toFixed(0)} mm`,
    layout: k.layout.name,
    width: k.dimensions.width,
    depth: k.dimensions.depth,
    height: k.dimensions.height,
    angle: c?.angle ?? k.profile?.angle,
    keys: k.layout.keyCount,
    wireless: k.features?.wireless,
    knob: k.features?.knob,
    mounting: mountingKinds(c?.mountingPoints),
    material: k.material,
    tags: k.tags ?? [],
    confidence: k.confidence,
    text: parts.join(' ').toLowerCase(),
  };
}

function layoutTag(tags: string[] | undefined): string | undefined {
  return tags?.find((t) => /%$|^TKL$|^Full Size$|^1800$|^Alice$|^Split$|^Ergo$/.test(t));
}

function fromComponent(kind: ComponentType, c: Case | PCB | Plate | Daughterboard | Switch | Keycap | Stabilizer | Foam): CatalogItem {
  const any = c as { brand?: string; model?: string; tags?: string[]; dimensions?: { width: number; depth: number; height?: number }; material?: string };
  const dims = any.dimensions;
  const tags = any.tags ?? [];
  const layout = layoutTag(tags);
  const item: CatalogItem = {
    ...base(kind, c.id, c.slug, any.brand, any.model),
    subtitle: [COMPONENT_LABEL[kind], layout, dims ? `${dims.width.toFixed(0)} × ${dims.depth.toFixed(0)} mm` : ''].filter(Boolean).join(' · '),
    layout,
    width: dims?.width,
    depth: dims?.depth,
    height: dims?.height,
    mounting: [],
    material: any.material,
    tags,
    confidence: c.confidence,
    text: '',
  };
  if (kind === 'case') {
    const cs = c as Case;
    item.angle = cs.angle;
    item.mounting = mountingKinds(cs.mountingPoints);
  } else if (kind === 'pcb') {
    const p = c as PCB;
    item.keys = p.switchPositions.length;
    item.wireless = p.features?.wireless;
    item.knob = p.features?.knob;
    item.mounting = mountingKinds(p.mountingPoints);
  } else if (kind === 'plate') {
    const p = c as Plate;
    item.keys = p.switchCutouts.length;
    item.mounting = mountingKinds(p.mountingPoints);
  }
  item.text = [item.title, kind, COMPONENT_LABEL[kind], layout ?? '', ...tags, item.material ?? ''].join(' ').toLowerCase();
  return item;
}

let cache: CatalogItem[] | null = null;
export function resetCatalog(): void {
  cache = null;
}
export function catalog(): CatalogItem[] {
  if (cache) return cache;
  cache = [
    ...db.keyboards.map(fromKeyboard),
    ...db.cases.map((c) => fromComponent('case', c)),
    ...db.pcbs.map((c) => fromComponent('pcb', c)),
    ...db.plates.map((c) => fromComponent('plate', c)),
    ...db.daughterboards.map((c) => fromComponent('daughterboard', c)),
    ...db.switches.map((c) => fromComponent('switch', c)),
    ...db.keycaps.map((c) => fromComponent('keycap', c)),
    ...db.stabilizers.map((c) => fromComponent('stabilizer', c)),
  ];
  return cache;
}

/* ------------------------------------------------------------------ query */

export interface ParsedQuery {
  raw: string;
  isUrl: boolean;
  tokens: string[];
  /** Millimetre values found in the query, e.g. "327mm" → 327 */
  mm: number[];
}

export function parseQuery(q: string): ParsedQuery {
  const raw = q.trim();
  const isUrl = /^(https?:\/\/|www\.)\S+$/i.test(raw) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(raw);
  const mm: number[] = [];
  const tokens: string[] = [];
  for (const t of raw.toLowerCase().split(/\s+/).filter(Boolean)) {
    const m = /^(\d+(?:[.,]\d+)?)\s*mm$/.exec(t);
    if (m) mm.push(Number((m[1] as string).replace(',', '.')));
    else tokens.push(t);
  }
  return { raw, isUrl, tokens, mm };
}

export interface SearchHit {
  item: CatalogItem;
  score: number;
}

/** Every token must appear (AND); title matches weigh more. A "327mm" token matches width or depth within 1 mm. */
export function search(items: CatalogItem[], query: string): SearchHit[] {
  const q = parseQuery(query);
  if (!q.tokens.length && !q.mm.length) return items.map((item) => ({ item, score: 0 }));
  const hits: SearchHit[] = [];
  for (const item of items) {
    let score = 0;
    let ok = true;
    for (const t of q.tokens) {
      const title = item.title.toLowerCase();
      if (title.startsWith(t)) score += 6;
      else if (title.includes(t)) score += 4;
      else if (item.text.includes(t)) score += 2;
      else {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (const v of q.mm) {
        const near = [item.width, item.depth, item.height].some((d) => d !== undefined && Math.abs(d - v) <= 1);
        if (near) score += 3;
        else {
          ok = false;
          break;
        }
      }
    }
    if (ok) hits.push({ item, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
}
