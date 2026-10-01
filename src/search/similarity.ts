/**
 * "Find similar" — visual / dimensional similarity.
 *
 * This is deliberately separate from the compatibility engine: two parts can look
 * alike (high score) and still not fit (different hole pattern), or the opposite.
 * Nothing in this module may be used as evidence of physical compatibility.
 */
import { area, boundsOf, overlapStats, translatePoints } from '../geometry/shape';
import { getKeyboard, getComponent, db } from '../services/database';
import { shapeEntry, type ShapeEntry } from '../services/shapes';
import type { CompareItem } from '../stores';
import type { Case, Keyboard, Shape } from '../types/keyboard';

export interface SimilarityBreakdown {
  outline: number;
  dimensions: number;
  aspect: number;
  cornerRadius: number;
  layout?: number;
  angle?: number;
  keys?: number;
  total: number;
}

/** Corner radius estimated from the area missing at the corners of the bounding box: A = wh − (4−π)r². */
export function estimateCornerRadius(shape: Shape): number {
  const b = boundsOf(shape.points);
  const bbox = (b.maxX - b.minX) * (b.maxY - b.minY);
  const deficit = Math.max(0, bbox - area(shape.points));
  return Math.sqrt(deficit / (4 - Math.PI));
}

const ratio = (a: number, b: number) => (a === 0 && b === 0 ? 1 : 1 - Math.abs(a - b) / Math.max(a, b, 1e-9));

function keySet(k: Keyboard): Set<string> {
  return new Set(k.layout.keys.map((key) => `${key.x.toFixed(2)},${key.y.toFixed(2)},${key.width}`));
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

interface Extra {
  layout?: string;
  angle?: number;
  keys?: Set<string>;
}

function extraOf(item: CompareItem): Extra {
  if (item.kind === 'keyboard') {
    const k = getKeyboard(item.id);
    if (!k) return {};
    const c = getComponent<Case>('case', k.components.caseId);
    return { layout: k.layout.name, angle: c?.angle ?? k.profile?.angle, keys: keySet(k) };
  }
  if (item.kind === 'case') {
    const c = getComponent<Case>('case', item.id);
    return { angle: c?.angle, layout: c?.tags?.find((t) => /%$|^TKL$|^Full Size$/.test(t)) };
  }
  const c = getComponent(item.kind, item.id) as { tags?: string[] } | undefined;
  return { layout: c?.tags?.find((t) => /%$|^TKL$|^Full Size$/.test(t)) };
}

export function similarity(a: CompareItem, b: CompareItem): { breakdown: SimilarityBreakdown; a: ShapeEntry; b: ShapeEntry } | null {
  const ea = shapeEntry(a);
  const eb = shapeEntry(b);
  if (!ea || !eb) return null;
  const ba = boundsOf(ea.shape.points);
  const bb = boundsOf(eb.shape.points);
  // compare outlines centred on each other
  const dx = (ba.minX + ba.maxX) / 2 - (bb.minX + bb.maxX) / 2;
  const dy = (ba.minY + ba.maxY) / 2 - (bb.minY + bb.maxY) / 2;
  const outline = overlapStats(ea.shape.points, translatePoints(eb.shape.points, dx, dy), 1).iou;
  const dimensions = (ratio(ea.dimensions.width, eb.dimensions.width) + ratio(ea.dimensions.depth, eb.dimensions.depth)) / 2;
  const aspect = ratio(ea.dimensions.width / ea.dimensions.depth, eb.dimensions.width / eb.dimensions.depth);
  const cornerRadius = ratio(estimateCornerRadius(ea.shape), estimateCornerRadius(eb.shape));

  const xa = extraOf(a);
  const xb = extraOf(b);
  const parts: Array<[number, number | undefined]> = [
    [0.35, outline],
    [0.2, dimensions],
    [0.1, aspect],
    [0.05, cornerRadius],
    [0.15, xa.layout && xb.layout ? (xa.layout === xb.layout ? 1 : 0) : undefined],
    [0.05, xa.angle !== undefined && xb.angle !== undefined ? Math.max(0, 1 - Math.abs(xa.angle - xb.angle) / 10) : undefined],
    [0.1, xa.keys && xb.keys ? jaccard(xa.keys, xb.keys) : undefined],
  ];
  const used = parts.filter((p): p is [number, number] => p[1] !== undefined);
  const wSum = used.reduce((s, [w]) => s + w, 0);
  const total = used.reduce((s, [w, v]) => s + w * v, 0) / wSum;
  return {
    a: ea,
    b: eb,
    breakdown: {
      outline,
      dimensions,
      aspect,
      cornerRadius,
      layout: parts[4]?.[1],
      angle: parts[5]?.[1],
      keys: parts[6]?.[1],
      total,
    },
  };
}

export interface SimilarMatch {
  item: CompareItem;
  breakdown: SimilarityBreakdown;
  entry: ShapeEntry;
}

/** Most similar items of the same kind. */
export function findSimilar(target: CompareItem, limit = 6): SimilarMatch[] {
  const lists: Record<string, Array<{ id: string }>> = {
    keyboard: db.keyboards,
    case: db.cases,
    pcb: db.pcbs,
    plate: db.plates,
    daughterboard: db.daughterboards,
  };
  const pool = lists[target.kind] ?? [];
  const out: SimilarMatch[] = [];
  for (const o of pool) {
    if (o.id === target.id) continue;
    const item: CompareItem = { kind: target.kind, id: o.id };
    const s = similarity(target, item);
    if (s) out.push({ item, breakdown: s.breakdown, entry: s.b });
  }
  return out.sort((x, y) => y.breakdown.total - x.breakdown.total).slice(0, limit);
}
