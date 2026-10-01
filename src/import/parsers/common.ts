import type { Measurement, SourceInfo, SourceType } from '../../types/keyboard';
import { extractDimensions, extractWeight } from '../DimensionExtractor';
import { ORIGIN_RANK, extractImages } from '../ImageExtractor';
import { detectLayoutByVoting, detectLayoutFromText } from '../LayoutDetector';
import {
  extractJsonLd,
  extractMeta,
  extractSpecPairs,
  hasType,
  stripTags,
} from '../html';
import { emptyProduct, type Fetcher, type ProductData, type ProductParser } from '../types';

export interface ParseOptions {
  sourceType: SourceType;
  /** Base confidence of numbers read from this kind of source. */
  baseConfidence: number;
  sourceName?: string;
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export function makeSource(url: string, opts: ParseOptions, method: string): SourceInfo {
  return {
    sourceUrl: url,
    sourceName: opts.sourceName ?? hostOf(url),
    sourceType: opts.sourceType,
    retrievedAt: new Date().toISOString(),
    method,
    confidence: opts.baseConfidence,
  };
}

const str = (v: unknown): string | undefined => {
  // placeholders such as "-" or "N/A" are not data
  if (typeof v === 'string' && /[a-z0-9]{2,}/i.test(v) && !/^(n\/?a|none|null|undefined|unknown)$/i.test(v.trim())) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
};

const nameOf = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.trim() || undefined;
  if (v && typeof v === 'object') return str((v as Record<string, unknown>)['name']);
  return undefined;
};

/** schema.org QuantitativeValue → millimetres/grams. */
function quantity(v: unknown, kind: 'length' | 'mass', opts: ParseOptions, method: string): Measurement | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const raw = Number(String(o['value'] ?? o['maxValue'] ?? '').replace(',', '.'));
  if (!Number.isFinite(raw)) return undefined;
  const unit = String(o['unitCode'] ?? o['unitText'] ?? '').toLowerCase();
  if (kind === 'length') {
    const k = unit === 'mmt' || unit === 'mm' ? 1 : unit === 'cmt' || unit === 'cm' ? 10 : unit === 'inh' || unit.startsWith('in') ? 25.4 : undefined;
    if (k === undefined) return undefined;
    return { value: Math.round(raw * k * 100) / 100, unit: 'mm', source: opts.sourceType, confidence: opts.baseConfidence, method };
  }
  const k = unit === 'grm' || unit === 'g' ? 1 : unit === 'kgm' || unit === 'kg' ? 1000 : unit === 'lbr' || unit.startsWith('lb') ? 453.592 : undefined;
  if (k === undefined) return undefined;
  return { value: Math.round(raw * k), unit: 'g', source: opts.sourceType, confidence: opts.baseConfidence, method };
}

export function fromSchema(html: string, url: string, opts: ParseOptions): ProductData {
  const p = emptyProduct(url);
  const product = extractJsonLd(html).find((n) => hasType(n, 'Product'));
  if (!product) return p;
  const method = 'json-ld';
  p.name = str(product['name']);
  p.brand = nameOf(product['brand']) ?? nameOf(product['manufacturer']);
  p.model = str(product['model']) ?? str(product['mpn']) ?? str(product['sku']);
  p.description = str(product['description']);
  p.material = str(product['material']);

  const offers = Array.isArray(product['offers']) ? product['offers'][0] : product['offers'];
  if (offers && typeof offers === 'object') {
    const o = offers as Record<string, unknown>;
    const amount = Number(String(o['price'] ?? o['lowPrice'] ?? '').replace(',', '.'));
    if (Number.isFinite(amount) && amount > 0) p.price = { amount, currency: str(o['priceCurrency']) ?? '' };
  }

  const w = quantity(product['width'], 'length', opts, method);
  const d = quantity(product['depth'], 'length', opts, method);
  const h = quantity(product['height'], 'length', opts, method);
  if (w || d || h) p.dimensions = { width: w, depth: d, height: h };
  p.weight = quantity(product['weight'], 'mass', opts, method);
  // shops fill schema.org weight with the *shipping* weight (box included); a spec-table weight beats it
  if (p.weight) p.weight = { ...p.weight, confidence: Math.min(p.weight.confidence, 0.35), method: 'json-ld (may be shipping weight)' };

  const props = product['additionalProperty'];
  if (Array.isArray(props)) {
    for (const prop of props) {
      if (prop && typeof prop === 'object') {
        const o = prop as Record<string, unknown>;
        const k = str(o['name']);
        const v = str(o['value']);
        if (k && v) p.specs[k] = v;
      }
    }
  }
  p.images = extractImages(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, url);
  p.sources.push(makeSource(url, opts, method));
  mark(p, 'json-ld');
  return p;
}

export function fromOpenGraph(html: string, url: string, opts: ParseOptions): ProductData {
  const p = emptyProduct(url);
  const { byKey, title } = extractMeta(html);
  const name = byKey['og:title'] ?? byKey['twitter:title'] ?? title;
  p.name = name;
  p.brand = byKey['product:brand'] ?? byKey['og:brand'];
  p.description = byKey['og:description'] ?? byKey['description'] ?? byKey['twitter:description'];
  const amount = Number((byKey['product:price:amount'] ?? byKey['og:price:amount'] ?? '').replace(',', '.'));
  if (Number.isFinite(amount) && amount > 0) {
    p.price = { amount, currency: byKey['product:price:currency'] ?? byKey['og:price:currency'] ?? '' };
  }
  const imgHtml = [byKey['og:image'], byKey['og:image:url'], byKey['twitter:image']]
    .filter(Boolean)
    .map((u) => `<meta property="og:image" content="${u}">`)
    .join('');
  p.images = extractImages(imgHtml, url);
  p.sources.push(makeSource(url, { ...opts, baseConfidence: Math.min(opts.baseConfidence, 0.6) }, 'open-graph'));
  mark(p, 'open-graph');
  return p;
}

export function fromGeneric(html: string, url: string, opts: ParseOptions): ProductData {
  const p = emptyProduct(url);
  const meta = extractMeta(html);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  p.name = (h1 ? stripTags(h1) : undefined) ?? meta.title;
  p.description = meta.byKey['description'];
  p.specs = extractSpecPairs(html);

  const specText = Object.entries(p.specs)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const body = stripTags(html).slice(0, 300_000);

  // spec tables are more reliable than prose → try them first
  let dims = extractDimensions(specText, opts.sourceType, opts.baseConfidence);
  let method = 'spec-table';
  if (!dims.width && !dims.depth) {
    dims = extractDimensions(body, opts.sourceType, opts.baseConfidence * 0.7);
    method = 'page-text';
  }
  if (dims.width || dims.depth || dims.height || dims.frontHeight || dims.rearHeight) {
    p.dimensions = { width: dims.width, depth: dims.depth, height: dims.height, frontHeight: dims.frontHeight, rearHeight: dims.rearHeight, raw: dims.raw };
  }
  p.warnings.push(...dims.warnings);
  p.weight = extractWeight(specText, opts.sourceType, opts.baseConfidence) ?? extractWeight(body, opts.sourceType, opts.baseConfidence * 0.7);

  const layoutSource = `${p.name ?? ''} ${p.specs['Layout'] ?? p.specs['Size'] ?? ''} ${p.description ?? ''}`;
  let layout = detectLayoutFromText(layoutSource);
  if (layout.layout === 'Custom') {
    // marketplaces put the key count in the description paragraph, not in meta tags — noisier, so trusted less
    const fromBody = detectLayoutByVoting(body.slice(0, 80_000));
    if (fromBody.layout !== 'Custom') layout = fromBody;
  }
  if (layout.layout !== 'Custom') p.layoutHint = { layout: layout.layout, confidence: layout.confidence, reasons: layout.reasons };
  const keys = /(\d{2,3})[\s-]?keys?\b/i.exec(layoutSource)?.[1] ?? p.specs['Number of keys'] ?? p.specs['Keys'];
  if (keys && Number.isFinite(Number(keys))) p.keyCount = Number(keys);
  p.material = p.specs['Material'] ?? p.specs['Case material'] ?? p.specs['Case Material'];

  p.images = extractImages(html, url);
  p.sources.push(makeSource(url, opts, method));
  mark(p, method);
  return p;
}

function mark(p: ProductData, method: string): void {
  const set = (field: keyof ProductData['fieldSources'], present: unknown) => {
    if (present !== undefined && present !== null && !(Array.isArray(present) && present.length === 0)) p.fieldSources[field] = method;
  };
  set('name', p.name);
  set('brand', p.brand);
  set('model', p.model);
  set('price', p.price);
  set('dimensions', p.dimensions);
  set('weight', p.weight);
  set('layout', p.layoutHint);
  set('material', p.material);
  set('images', p.images);
  set('specs', Object.keys(p.specs).length ? p.specs : undefined);
}

/**
 * Merge parser outputs by priority: for each field the first parser (in `list` order) that
 * found it wins. Dimensions are merged per axis so a partial structured value does not hide a
 * complete one from the spec table.
 */
export function mergeProducts(url: string, list: ProductData[]): ProductData {
  const out = emptyProduct(url);
  for (const p of list) {
    const take = <K extends keyof ProductData>(key: K, field: keyof ProductData['fieldSources']) => {
      if (out[key] === undefined && p[key] !== undefined) {
        (out as unknown as Record<string, unknown>)[key] = p[key];
        const src = p.fieldSources[field];
        if (src) out.fieldSources[field] = `${src} (${p.sources[0]?.sourceType ?? 'unknown'})`;
      }
    };
    take('name', 'name');
    take('brand', 'brand');
    take('model', 'model');
    take('price', 'price');
    take('weight', 'weight');
    take('layoutHint', 'layout');
    take('keyCount', 'layout');
    take('material', 'material');
    take('description', 'specs');
    if (p.dimensions) {
      out.dimensions ??= {};
      for (const k of ['width', 'depth', 'height', 'frontHeight', 'rearHeight'] as const) {
        if (!out.dimensions[k] && p.dimensions[k]) {
          out.dimensions[k] = p.dimensions[k];
          out.fieldSources.dimensions ??= `${p.fieldSources.dimensions ?? 'text'} (${p.sources[0]?.sourceType ?? 'unknown'})`;
        }
      }
      out.dimensions.raw ??= p.dimensions.raw;
    }
    for (const [k, v] of Object.entries(p.specs)) out.specs[k] ??= v;
    out.sources.push(...p.sources);
    out.warnings.push(...p.warnings);
    for (const img of p.images) {
      const same = out.images.find((i) => i.url === img.url);
      if (!same) out.images.push(img);
      else if (ORIGIN_RANK[img.origin] > ORIGIN_RANK[same.origin]) same.origin = img.origin;
    }
  }
  out.images.sort((a, b) => b.score - a.score);
  if (out.images.length) out.fieldSources.images = 'merged';
  if (Object.keys(out.specs).length) out.fieldSources.specs = 'merged';
  return out;
}

export abstract class BaseParser implements ProductParser {
  abstract readonly name: string;
  constructor(protected readonly fetcher: Fetcher) {}
  abstract canHandle(url: string): boolean;
  abstract parseHtml(html: string, url: string): ProductData;
  async parse(url: string): Promise<ProductData> {
    return this.parseHtml(await this.fetcher(url), url);
  }
}
