/**
 * Per-site product search, using only *public, documented, robots.txt-permitted* endpoints:
 *
 *   Shopify      /search/suggest.json  (storefront predictive search)   → falls back to /products.json
 *   WooCommerce  /wp-json/wc/store/v1/products?search=                  (public Store API)
 *
 * No HTML result-page scraping, no search-engine scraping, no challenge solving. When robots.txt
 * disallows an endpoint it is not used; when nothing is allowed the site is reported as `denied`.
 */
import { extractDimensions, extractWeight } from './DimensionExtractor';
import { extractImages, tokenize } from './ImageExtractor';
import { detectLayoutFromText } from './LayoutDetector';
import { stripTags } from './html';
import type { SourceRole } from './CrossReference';
import { emptyProduct, type ProductData } from './types';

export interface SiteDef {
  id: string;
  name: string;
  host: string;
  /** `none`: no public search endpoint — the site is only used through product URLs the user provides. */
  platform: 'shopify' | 'woocommerce' | 'none';
  role: SourceRole;
  notes?: string;
  checkedAt?: string;
}

export interface SearchDeps {
  /** GET → parsed JSON. Must throw on any non-200 or non-JSON answer. */
  getJson(url: string): Promise<unknown>;
  /** Is this URL allowed by the site's robots.txt for our user agent? */
  robotsAllows(url: string): Promise<boolean>;
  /** Politeness delay between two requests to the same host. */
  pause(): Promise<void>;
}

export interface SearchHit {
  siteId: string;
  title: string;
  url: string;
  vendor?: string;
  image?: string;
  /** 0..1 — how well the title matches the query. */
  relevance: number;
  /** Present when the API already returned everything needed (the product page is then not fetched). */
  product?: ProductData;
}

export interface SiteSearchResult {
  site: SiteDef;
  status: 'ok' | 'no-match' | 'denied' | 'error';
  /** Which endpoint produced the hits. */
  via: string;
  hits: SearchHit[];
  message?: string;
}

/* ---------------------------------------------------------------- relevance */

/**
 * Words that turn a product into a *different product* ("Q1" vs "Q1 Max" / "Q1 HE" / "Q1 Pro"). A title that carries
 * one of them while the query does not is another model: its dimensions must not be mixed in.
 */
const VARIANT_MARKERS = new Set(['max', 'pro', 'ultra', 'he', 'lite', 'plus', 'se', 'mini', 'air', 'elite', 'turbo', 'nano', 'gt', 'rs']);

/** Accessories and parts sold under the keyboard's name ("Keychron Q1 Plate"): not the keyboard itself. */
const ACCESSORY_MARKERS = new Set(['plate', 'plates', 'pcb', 'keycap', 'keycaps', 'cable', 'cables', 'foam', 'stabilizer', 'stabilizers', 'sticker', 'stickers', 'wrist', 'rest', 'mat', 'pad', 'bag', 'cover', 'module', 'switches', 'tape', 'replacement', 'spare', 'carrying', 'travel', 'sleeve', 'pouch', 'accessories', 'accessory', 'bundle']);

/** Regional layout editions: same product, but a different key map than the ANSI reference maps. */
const REGION_MARKERS = new Set(['iso', 'jis', 'nordic', 'uk', 'de', 'fr', 'es', 'it', 'abnt']);

const STOP = new Set(['keyboard', 'keyboards', 'mechanical', 'the', 'and', 'for', 'with', 'wired', 'wireless', 'gaming', 'kit', 'edition', 'custom', 'rgb', 'black', 'white', 'a', 'of', 'in']);

/** Split "mad60he" → ["mad","60","he"] so model numbers match across spellings ("MAD60/MAD68 HE"). */
function segments(token: string): string[] {
  return token.match(/[a-z]+|\d+/g) ?? [];
}

/**
 * How much of the query does the title cover? Model-like tokens (containing digits) count double,
 * and match as an in-order subsequence of the title's letter/digit segments, so "mad60he" matches
 * "Madlions MAD60/ MAD68 HE" but "mad65" does not.
 */
export function relevance(query: string, title: string): number {
  const q = tokenize(query).filter((t) => !STOP.has(t));
  if (q.length === 0) return 0;
  const titleTokens = tokenize(title);
  const flat = titleTokens.flatMap(segments);
  const flatJoined = titleTokens.join('');
  let got = 0;
  let total = 0;
  for (const t of q) {
    const w = /\d/.test(t) ? 2 : 1;
    total += w;
    const exact = titleTokens.includes(t) || (t.length >= 4 && flatJoined.includes(t));
    let sub = false;
    if (!exact) {
      const seg = segments(t);
      let i = 0;
      for (const s of flat) if (i < seg.length && s === seg[i]) i++;
      sub = seg.length >= 2 && i === seg.length;
    }
    if (exact || sub) got += w;
  }
  let score = got / total;
  // A purely alphabetic query word (the brand: "wooting") that the title lacks means another maker's product,
  // whatever model number it shares ("Aula WIN60 HE" is not a "Wooting 60HE"). Cap below any sane threshold.
  const brandish = q.filter((t) => /^[a-z]{4,}$/.test(t) && !VARIANT_MARKERS.has(t) && !ACCESSORY_MARKERS.has(t));
  if (brandish.some((t) => !titleTokens.includes(t) && !flatJoined.includes(t))) score = Math.min(score, 0.5);
  // a model-variant word in the title that the query never asked for → a different product
  const asked = new Set(tokenize(query).flatMap((t) => [t, ...segments(t)]));
  if (titleTokens.some((t) => VARIANT_MARKERS.has(t) && !asked.has(t))) score *= 0.5;
  // a regional edition (ISO / JIS …) unless asked for: its key map differs from the ANSI reference
  if (titleTokens.some((t) => REGION_MARKERS.has(t) && !asked.has(t))) score *= 0.7;
  // a part or accessory unless the query itself asks for one ("keychron q1 plate")
  if (titleTokens.some((t) => ACCESSORY_MARKERS.has(t) && !asked.has(t))) score *= 0.5;
  // "<keyboard> Keyboard Case" / "case for <keyboard>" is a carrying case, not a case kit
  if (/\bkeyboard\s+(?:case|cover|sleeve)\b|\b(?:case|cover|sleeve)\s+for\b/i.test(title) && !/\bcase\b/i.test(query)) score *= 0.5;
  return score;
}

/* ------------------------------------------------------------------ helpers */

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function origin(site: SiteDef): string {
  return `https://${site.host}`;
}

function rank(hits: SearchHit[], limit = 8): SearchHit[] {
  return hits.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
}

/* ------------------------------------------------------------------ Shopify */

async function shopifySuggest(site: SiteDef, query: string, deps: SearchDeps): Promise<SearchHit[] | 'denied'> {
  const url = `${origin(site)}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=10`;
  if (!(await deps.robotsAllows(url))) return 'denied';
  const json = obj(await deps.getJson(url));
  const products = arr(obj(obj(json['resources'])['results'])['products']);
  return products.map((p) => {
    const o = obj(p);
    const title = str(o['title']) ?? '';
    const path = str(o['url']) ?? `/products/${str(o['handle']) ?? ''}`;
    return {
      siteId: site.id,
      title,
      url: new URL(path.split('?')[0] ?? path, origin(site)).toString(),
      vendor: str(o['vendor']),
      image: str(o['image']),
      relevance: relevance(query, `${str(o['vendor']) ?? ''} ${title}`),
    };
  });
}

/** Catalog paging: used when the predictive-search endpoint is disallowed. Capped and polite. */
async function shopifyCatalog(site: SiteDef, query: string, deps: SearchDeps, maxPages = 3): Promise<SearchHit[] | 'denied'> {
  const hits: SearchHit[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${origin(site)}/products.json?limit=250&page=${page}`;
    if (!(await deps.robotsAllows(url))) return page === 1 ? 'denied' : hits;
    const json = obj(await deps.getJson(url));
    const products = arr(json['products']);
    for (const p of products) {
      const o = obj(p);
      const title = str(o['title']) ?? '';
      const handle = str(o['handle']);
      if (!handle) continue;
      const r = relevance(query, `${str(o['vendor']) ?? ''} ${title}`);
      if (r < 0.5) continue;
      const image = str(obj(arr(o['images'])[0])['src']);
      hits.push({ siteId: site.id, title, url: `${origin(site)}/products/${handle}`, vendor: str(o['vendor']), image, relevance: r });
    }
    if (products.length < 250) break;
    await deps.pause();
  }
  return hits;
}

/* -------------------------------------------------------------- WooCommerce */

export function wooToProduct(p: Record<string, unknown>, site: SiteDef): ProductData {
  const url = str(p['permalink']) ?? origin(site);
  const out = emptyProduct(url);
  out.name = stripTags(str(p['name']) ?? '');
  const desc = stripTags(`${str(p['short_description']) ?? ''}\n${str(p['description']) ?? ''}`);
  out.description = desc.slice(0, 600);
  const attrs = arr(p['attributes']).map((a) => {
    const o = obj(a);
    return [str(o['name']) ?? '', arr(o['terms']).map((t) => str(obj(t)['name']) ?? '').filter(Boolean).join(', ')] as const;
  });
  for (const [k, v] of attrs) if (k && v) out.specs[k] = v;
  const specText = attrs.map(([k, v]) => `${k}: ${v}`).join('\n');
  const text = `${specText}\n${desc}`;
  const sourceType = site.role === 'manufacturer' ? 'manufacturer' : 'vendor';
  const base = site.role === 'manufacturer' ? 0.9 : 0.6;

  const dims = extractDimensions(text, sourceType, base);
  // WooCommerce also has dedicated fields; shipping dimensions describe the box, so they are NOT used for the product
  if (dims.width || dims.depth || dims.height || dims.frontHeight || dims.rearHeight) {
    out.dimensions = { width: dims.width, depth: dims.depth, height: dims.height, frontHeight: dims.frontHeight, rearHeight: dims.rearHeight, raw: dims.raw };
  }
  out.warnings.push(...dims.warnings);
  out.weight = extractWeight(text, sourceType, base);

  const layout = detectLayoutFromText(`${out.name} ${out.specs['Layout'] ?? out.specs['Size'] ?? ''} ${desc.slice(0, 300)}`);
  if (layout.layout !== 'Custom') out.layoutHint = { layout: layout.layout, confidence: layout.confidence, reasons: layout.reasons };
  const keys = /(\d{2,3})[\s-]?(?:keys?|teclas?)\b/i.exec(`${out.name} ${desc}`)?.[1];
  if (keys) out.keyCount = Number(keys);
  out.material = out.specs['Material'] ?? out.specs['Case Material'];

  const imgHtml = arr(p['images'])
    .map((i) => `<img src="${str(obj(i)['src']) ?? ''}" alt="${str(obj(i)['alt']) ?? ''}">`)
    .join('');
  out.images = extractImages(imgHtml, url).map((i) => ({ ...i, origin: 'structured' as const }));
  out.sources.push({ sourceUrl: url, sourceName: site.name, sourceType, retrievedAt: new Date().toISOString(), method: 'woocommerce-store-api', confidence: base });
  out.fieldSources = { name: 'woocommerce-store-api', ...(out.dimensions ? { dimensions: 'woocommerce-store-api' } : {}), ...(out.layoutHint ? { layout: 'woocommerce-store-api' } : {}) };
  return out;
}

async function wooSearch(site: SiteDef, query: string, deps: SearchDeps): Promise<SearchHit[] | 'denied'> {
  const url = `${origin(site)}/wp-json/wc/store/v1/products?search=${encodeURIComponent(query)}&per_page=10`;
  if (!(await deps.robotsAllows(url))) return 'denied';
  const list = arr(await deps.getJson(url));
  return list.map((p) => {
    const o = obj(p);
    const product = wooToProduct(o, site);
    return {
      siteId: site.id,
      title: product.name ?? '',
      url: product.url,
      image: str(obj(arr(o['images'])[0])['src']),
      // single-brand shops (madlionskeyboard.com) often leave the brand out of titles: their name counts
      relevance: relevance(query, `${site.name} ${product.name ?? ''}`),
      product,
    };
  });
}

/* ------------------------------------------------------------------- driver */

/**
 * Shop searches are usually AND-queries over title/description ("madlions mad60he" finds nothing
 * when the title only says "MAD60HE"). So: the full query first, then the model number alone,
 * then single words — at most 3 requests per site. Hits are always ranked against the ORIGINAL query.
 */
export function queryVariants(query: string): string[] {
  const words = tokenize(query).filter((t) => !STOP.has(t));
  const models = words.filter((t) => /\d/.test(t));
  const rest = words.filter((t) => !/\d/.test(t)).sort((a, b) => b.length - a.length);
  return [...new Set([query.trim(), ...models, ...rest])].slice(0, 3);
}

async function runStrategies(site: SiteDef, q: string, deps: SearchDeps): Promise<{ hits: SearchHit[] | 'denied'; via: string }> {
  if (site.platform === 'woocommerce') return { via: 'woocommerce store api', hits: await wooSearch(site, q, deps) };
  const suggest = await shopifySuggest(site, q, deps);
  if (suggest !== 'denied') return { via: 'shopify predictive search', hits: suggest };
  await deps.pause();
  return { via: 'shopify products.json', hits: await shopifyCatalog(site, q, deps) };
}

export async function searchSite(site: SiteDef, query: string, deps: SearchDeps): Promise<SiteSearchResult> {
  try {
    const collected = new Map<string, SearchHit>();
    let via = site.platform === 'woocommerce' ? 'woocommerce store api' : 'shopify predictive search';
    let denied = false;
    let lastVia = via;
    for (const q of queryVariants(query)) {
      const r = await runStrategies(site, q, deps);
      lastVia = r.via;
      if (r.hits === 'denied') {
        denied = true;
        break;
      }
      via = r.via;
      for (const h of r.hits) {
        // rank against the ORIGINAL query, whatever variant found it
        const rel = relevance(query, site.platform === 'woocommerce' ? `${site.name} ${h.title}` : `${h.vendor ?? ''} ${h.title}`);
        const prev = collected.get(h.url);
        if (!prev || rel > prev.relevance) collected.set(h.url, { ...h, relevance: rel });
      }
      if ([...collected.values()].some((h) => h.relevance >= 0.6)) break;
      await deps.pause();
    }
    if (denied && collected.size === 0) return { site, status: 'denied', via: lastVia, hits: [], message: 'robots.txt disallows every search endpoint we use' };
    const ranked = rank([...collected.values()]);
    return { site, status: ranked.length ? 'ok' : 'no-match', via, hits: ranked };
  } catch (e) {
    return { site, status: 'error', via: site.platform, hits: [], message: e instanceof Error ? e.message : String(e) };
  }
}
