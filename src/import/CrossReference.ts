/**
 * CrossReference — reconcile what several independent sites say about the same keyboard.
 *
 * Principles
 *  - Agreement raises *confidence*; it never raises *precision level*. Ten retailers repeating
 *    the same number are still retailers: only a manufacturer source can make a value "official".
 *  - Disagreement is reported, never averaged away. The winning value is the weighted cluster
 *    of agreeing sources; everything else is listed as a conflict.
 *  - Sources are weighted by role (manufacturer > vendor > community > marketplace), by the
 *    measurement's own confidence and by how well the page matches the query.
 */
import type { LayoutName, Measurement, PrecisionLevel, SourceInfo, SourceType } from '../types/keyboard';
import type { ImageCandidate, ProductData } from './types';

export type SourceRole = 'manufacturer' | 'vendor' | 'community' | 'marketplace';

export const ROLE_WEIGHT: Record<SourceRole, number> = { manufacturer: 1, vendor: 0.6, community: 0.5, marketplace: 0.4 };

export interface Evidence {
  siteId: string;
  siteName: string;
  role: SourceRole;
  url: string;
  /** How well the page title matches the query, 0..1. */
  relevance: number;
  product: ProductData;
}

export interface Vote<T> {
  siteId: string;
  siteName: string;
  role: SourceRole;
  url: string;
  value: T;
  weight: number;
}

export interface Reconciled<T> {
  value: T;
  /** 0..1 — grows with independent agreement, shrinks with conflict. */
  confidence: number;
  /** `official` only with a manufacturer among the supporters. */
  level: PrecisionLevel;
  supporters: Vote<T>[];
  conflicts: Vote<T>[];
  note?: string;
}

export interface ReconciledProduct {
  query?: string;
  name?: string;
  brand?: string;
  width?: Reconciled<number>;
  depth?: Reconciled<number>;
  height?: Reconciled<number>;
  /** Typing-surface height at the front / back edge. Compared like with like — never against a bare "height". */
  frontHeight?: Reconciled<number>;
  rearHeight?: Reconciled<number>;
  /** Typing angle in degrees, derived from front/rear height and depth (not copied from a page). */
  angleDeg?: number;
  weightG?: Reconciled<number>;
  layout?: Reconciled<LayoutName>;
  keyCount?: Reconciled<number>;
  material?: Reconciled<string>;
  images: ImageCandidate[];
  sources: SourceInfo[];
  /** Sites that contributed at least one value. */
  contributors: number;
  /** Overall agreement over the fields that had ≥ 2 votes (1 = everyone agrees). */
  agreement: number | null;
  warnings: string[];
}

/** Values closer than this are the same measurement (rounding, "327.5" vs "328"). */
export function toleranceMm(v: number): number {
  // rounding between shops is ≤ 1 mm; editions of one product typically differ by 3 mm or more
  return Math.max(1.2, v * 0.004);
}

/** Does the title advertise several variants (e.g. "MAD60/MAD68")? Their specs legitimately differ. */
export function mentionsVariants(name: string | undefined): boolean {
  if (!name) return false;
  const models = name.match(/\b[a-z]{2,}[-\s]?\d{2,3}\b/gi) ?? [];
  const distinct = new Set(models.map((m) => m.toLowerCase().replace(/[-\s]/g, '')));
  return distinct.size >= 2 && /[\/&,+]|\bor\b|\band\b/i.test(name);
}

/**
 * Independent confirmation means independent *sites*: two colour variants of the same product on
 * one shop are one voice, not two. Per site only the heaviest vote counts (the others are dropped,
 * not turned into conflicts: a shop contradicting itself between variants is not evidence).
 */
function onePerSite<T>(votes: Vote<T>[]): Vote<T>[] {
  const best = new Map<string, Vote<T>>();
  for (const v of votes) {
    const cur = best.get(v.siteId);
    if (!cur || v.weight > cur.weight) best.set(v.siteId, v);
  }
  return [...best.values()];
}

function clusterNumbers(votes: Vote<number>[]): { winner: Vote<number>[]; rest: Vote<number>[] } {
  const sorted = [...votes].sort((a, b) => a.value - b.value);
  const clusters: Vote<number>[][] = [];
  for (const v of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(v.value - (last[0] as Vote<number>).value) <= toleranceMm((last[0] as Vote<number>).value)) last.push(v);
    else clusters.push([v]);
  }
  const mass = (c: Vote<number>[]) => c.reduce((s, v) => s + v.weight, 0);
  clusters.sort((a, b) => mass(b) - mass(a) || b.length - a.length);
  const winner = clusters[0] ?? [];
  return { winner, rest: clusters.slice(1).flat() };
}

/** Noisy-or: independent supporters each remove part of the doubt. Conflicts subtract. */
function confidenceOf<T>(supporters: Vote<T>[], conflicts: Vote<T>[]): number {
  const doubt = supporters.reduce((p, v) => p * (1 - Math.min(0.92, v.weight)), 1);
  const support = 1 - doubt;
  const against = conflicts.reduce((s, v) => s + v.weight, 0);
  const total = supporters.reduce((s, v) => s + v.weight, 0) + against;
  return Math.max(0.05, Math.min(0.99, support * (total === 0 ? 1 : (total - against * 0.7) / total)));
}

function levelOf<T>(supporters: Vote<T>[]): PrecisionLevel {
  return supporters.some((s) => s.role === 'manufacturer') ? 'official' : 'estimated';
}

function weightOf(ev: Evidence, measurementConfidence = 1): number {
  return ROLE_WEIGHT[ev.role] * Math.max(0.2, Math.min(1, measurementConfidence)) * (0.5 + 0.5 * ev.relevance);
}

function voteBase(ev: Evidence) {
  return { siteId: ev.siteId, siteName: ev.siteName, role: ev.role, url: ev.url };
}

function reconcileNumber(votes: Vote<number>[], digits = 1): Reconciled<number> | undefined {
  votes = onePerSite(votes);
  if (votes.length === 0) return undefined;
  const { winner, rest } = clusterNumbers(votes);
  const wsum = winner.reduce((s, v) => s + v.weight, 0);
  // the heaviest member decides the exact figure when a manufacturer is present, else the weighted mean
  const lead = winner.find((v) => v.role === 'manufacturer');
  const value = lead ? lead.value : winner.reduce((s, v) => s + v.value * v.weight, 0) / wsum;
  const k = 10 ** digits;
  return {
    value: Math.round(value * k) / k,
    confidence: confidenceOf(winner, rest),
    level: levelOf(winner),
    supporters: winner,
    conflicts: rest,
    note: rest.length ? `${rest.length} source(s) disagree: ${rest.map((r) => `${r.siteName} ${r.value}`).join(', ')}` : undefined,
  };
}

function reconcileLabel<T extends string>(votes: Vote<T>[]): Reconciled<T> | undefined {
  votes = onePerSite(votes);
  if (votes.length === 0) return undefined;
  const groups = new Map<T, Vote<T>[]>();
  for (const v of votes) groups.set(v.value, [...(groups.get(v.value) ?? []), v]);
  const ranked = [...groups.entries()].sort((a, b) => b[1].reduce((s, v) => s + v.weight, 0) - a[1].reduce((s, v) => s + v.weight, 0));
  const [value, supporters] = ranked[0] as [T, Vote<T>[]];
  const conflicts = ranked.slice(1).flatMap(([, v]) => v);
  return {
    value,
    confidence: confidenceOf(supporters, conflicts),
    level: levelOf(supporters),
    supporters,
    conflicts,
    note: conflicts.length ? `${conflicts.length} source(s) say otherwise: ${[...new Set(conflicts.map((c) => `${c.value} (${c.siteName})`))].join(', ')}` : undefined,
  };
}

export function reconcile(evidence: Evidence[], query?: string): ReconciledProduct {
  const warnings: string[] = [];
  const numberVotes = (pick: (p: ProductData) => Measurement | undefined) =>
    evidence.flatMap((ev) => {
      const m = pick(ev.product);
      return m?.value ? [{ ...voteBase(ev), value: m.value, weight: weightOf(ev, m.confidence) }] : [];
    });

  const width = reconcileNumber(numberVotes((p) => p.dimensions?.width));
  const depth = reconcileNumber(numberVotes((p) => p.dimensions?.depth));
  const height = reconcileNumber(numberVotes((p) => p.dimensions?.height));
  const frontHeight = reconcileNumber(numberVotes((p) => p.dimensions?.frontHeight));
  const rearHeight = reconcileNumber(numberVotes((p) => p.dimensions?.rearHeight));
  const weightG = reconcileNumber(numberVotes((p) => p.weight), 0);

  const layoutVotes: Vote<LayoutName>[] = evidence.flatMap((ev) =>
    ev.product.layoutHint
      ? [{ ...voteBase(ev), value: ev.product.layoutHint.layout, weight: weightOf(ev, ev.product.layoutHint.confidence) * (mentionsVariants(ev.product.name) ? 0.5 : 1) }]
      : [],
  );
  const layout = reconcileLabel(layoutVotes);
  const keyCount = reconcileNumber(
    evidence.flatMap((ev) => (ev.product.keyCount ? [{ ...voteBase(ev), value: ev.product.keyCount, weight: weightOf(ev, 0.7) }] : [])),
    0,
  );
  const material = reconcileLabel(
    evidence.flatMap((ev) => (ev.product.material ? [{ ...voteBase(ev), value: ev.product.material.trim().toLowerCase(), weight: weightOf(ev, 0.7) }] : [])),
  );

  // name / brand: the most relevant manufacturer or vendor title
  // title of the best-matching page: prefer exact matches, penalise combined variant listings, then the shortest title
  const titleScore = (e: Evidence) => ROLE_WEIGHT[e.role] * e.relevance * (mentionsVariants(e.product.name) ? 0.5 : 1);
  const best = [...evidence].sort((a, b) => titleScore(b) - titleScore(a) || (a.product.name?.length ?? 1e9) - (b.product.name?.length ?? 1e9))[0];
  const variantListings = evidence.filter((ev) => mentionsVariants(ev.product.name));
  if (variantListings.length) {
    warnings.push(`${variantListings.map((v) => v.siteName).join(', ')} list several variants in one product (e.g. “${variantListings[0]?.product.name}”): their dimensions can legitimately differ.`);
  }
  for (const [label, r] of [['width', width], ['depth', depth], ['height', height], ['front height', frontHeight], ['rear height', rearHeight], ['layout', layout]] as const) {
    if (r && r.conflicts.length) warnings.push(`${label}: ${r.note}`);
  }
  if (evidence.length === 1) warnings.push('Only one source: nothing to cross-check against.');
  if (width && depth && width.value < depth.value) warnings.push('Width is smaller than depth — the sources may use "width" for the short side.');

  const images: ImageCandidate[] = [];
  for (const ev of evidence) {
    for (const img of ev.product.images) if (!images.some((i) => i.url === img.url)) images.push(img);
  }
  images.sort((a, b) => b.score - a.score);

  const sources: SourceInfo[] = evidence.flatMap((ev) =>
    ev.product.sources.slice(0, 1).map((s) => ({
      ...s,
      sourceName: ev.siteName,
      sourceType: (ev.role === 'manufacturer' ? 'manufacturer' : ev.role === 'community' ? 'community' : 'vendor') as SourceType,
      sourceUrl: ev.url,
    })),
  );

  const ratios: number[] = [];
  for (const r of [width, depth, height, frontHeight, rearHeight, layout]) {
    if (r && r.supporters.length + r.conflicts.length >= 2) ratios.push(r.supporters.length / (r.supporters.length + r.conflicts.length));
  }
  const agreement = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;

  return {
    query,
    name: best?.product.name,
    brand: best?.product.brand,
    width,
    depth,
    height,
    frontHeight,
    rearHeight,
    angleDeg: frontHeight && rearHeight && depth ? Math.round(((Math.asin(Math.max(-1, Math.min(1, (rearHeight.value - frontHeight.value) / depth.value))) * 180) / Math.PI) * 10) / 10 : undefined,
    weightG,
    layout,
    keyCount,
    material,
    images,
    sources,
    contributors: new Set(evidence.filter((ev) => ev.product.dimensions || ev.product.layoutHint || ev.product.weight).map((ev) => ev.siteId)).size,
    agreement,
    warnings,
  };
}

/* ------------------------------------------------------------------ editions */

const EDITION_WORDS = ['max', 'pro', 'ultra', 'lite', 'se', 'mini', 'air', 'elite', 'turbo', 'nano', 'iso', 'jis'];

/**
 * Which edition of the product does this title describe? "Wooting 60HE+" and "Wooting 60HE v2" share a name and a
 * shop, but they are different products with different dimensions — they must never be merged into one number.
 * Returns "" for a plain title with no edition marker.
 */
export function editionKey(name?: string): string {
  if (!name) return '';
  const t = name.toLowerCase();
  const keys = new Set<string>();
  const edge = (re: string) => new RegExp('(?<![a-z0-9])' + re + '(?![a-z0-9])', 'g');
  for (const m of t.matchAll(edge(String.raw`v(\d)`))) keys.add('v' + m[1]);
  for (const m of t.matchAll(edge(String.raw`version\s*(\d)`))) keys.add('v' + m[1]);
  if (/[a-z0-9]\+(?![a-z0-9])/.test(t) || edge('plus').test(t)) keys.add('plus');
  for (const w of EDITION_WORDS) if (edge(w).test(t)) keys.add(w);
  return [...keys].sort().join('+');
}

export interface EditionSummary {
  key: string;
  label: string;
  sites: string[];
  /** Total evidence weight: how well supported this edition is. */
  weight: number;
  width?: number;
  depth?: number;
  official: boolean;
}

export interface ReconciledEditions extends ReconciledProduct {
  /** Edition whose values are shown above ("" = plain). */
  edition: string;
  editions: EditionSummary[];
  /** Full reconciliation of every edition, for UIs that let the user switch. */
  byEdition: Record<string, ReconciledProduct>;
}

const labelOfEdition = (k: string) => (k ? k.replace(/\+/g, ' + ') : 'standard');

/**
 * Reconcile per edition. Pages without an edition marker are ambiguous, so they count (at reduced weight) for every
 * edition instead of silently choosing one. The edition shown first is the one the query names, else the best supported.
 */
export function reconcileEditions(evidence: Evidence[], query?: string, prefer?: string): ReconciledEditions {
  const keys = [...new Set(evidence.map((e) => editionKey(e.product.name)).filter(Boolean))];
  const plain = evidence.filter((e) => !editionKey(e.product.name));
  const groups: Array<{ key: string; evidence: Evidence[] }> =
    keys.length === 0
      ? [{ key: '', evidence }]
      : keys.map((key) => ({
          key,
          evidence: [
            ...evidence.filter((e) => editionKey(e.product.name) === key),
            ...plain.map((e) => ({ ...e, relevance: e.relevance * 0.7 })),
          ],
        }));

  const byEdition: Record<string, ReconciledProduct> = {};
  const summaries: EditionSummary[] = groups.map((g) => {
    const r = reconcile(g.evidence, query);
    byEdition[g.key] = r;
    return {
      key: g.key,
      label: labelOfEdition(g.key),
      sites: [...new Set(g.evidence.map((e) => e.siteName))],
      weight: g.evidence.reduce((s, e) => s + ROLE_WEIGHT[e.role] * e.relevance, 0),
      width: r.width?.value,
      depth: r.depth?.value,
      official: !!r.width?.supporters.some((s) => s.role === 'manufacturer'),
    };
  });

  const asked = editionKey(query);
  const pick =
    summaries.find((s) => prefer !== undefined && s.key === prefer) ??
    (asked ? summaries.find((s) => s.key === asked) : undefined) ??
    [...summaries].sort((a, b) => Number(b.official) - Number(a.official) || b.weight - a.weight)[0];
  const chosen = pick?.key ?? '';
  const base = byEdition[chosen] ?? reconcile(evidence, query);
  const warnings = [...base.warnings];
  if (summaries.length > 1) {
    warnings.unshift(
      `The sources describe ${summaries.length} editions (${summaries.map((s) => s.label).join(', ')}) with different specifications. Each was reconciled separately; showing "${labelOfEdition(chosen)}". Name the edition in the query to choose.`,
    );
  }
  return { ...base, warnings, edition: chosen, editions: summaries, byEdition };
}
