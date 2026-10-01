import { normalizeUrl } from './fetcher';
import { checkRobots } from './robots';
import { defaultParsers } from './parsers';
import { mergeProducts } from './parsers/common';
import { ImportFetchError, type Fetcher, type ProductData, type ProductParser } from './types';
import { isAutoPickable, tokenize } from './ImageExtractor';

export interface ChecklistItem {
  label: string;
  status: 'ok' | 'missing' | 'unknown';
  detail?: string;
}

export interface ImportResult {
  url: string;
  product: ProductData;
  parsersUsed: string[];
  robots: 'allowed' | 'unchecked';
  checklist: ChecklistItem[];
}

export interface ImporterOptions {
  fetcher: Fetcher;
  parsers?: Array<ProductParser & { canHandle(url: string): boolean }>;
  /** When provided, robots.txt is consulted before fetching. */
  robotsFetch?: (url: string) => Promise<{ status: number; text: string }>;
  userAgent?: string;
}

/**
 * ProductImporter: URL → ProductData.
 *
 * 1. normalise the URL, 2. consult robots.txt when possible, 3. fetch the page once,
 * 4. run every parser that can handle the URL on the same HTML, 5. merge by priority.
 * The importer assumes nothing about page structure: parsers that find nothing simply
 * contribute nothing.
 */
export class ProductImporter {
  private readonly parsers: ProductParser[];
  constructor(private readonly opts: ImporterOptions) {
    this.parsers = opts.parsers ?? defaultParsers(opts.fetcher);
  }

  normalizeUrl = normalizeUrl;

  selectParsers(url: string): ProductParser[] {
    return this.parsers.filter((p) => p.canHandle(url));
  }

  async import(input: string): Promise<ImportResult> {
    const url = normalizeUrl(input);
    let robots: ImportResult['robots'] = 'unchecked';
    if (this.opts.robotsFetch) {
      const verdict = await checkRobots(url, this.opts.userAgent ?? 'KeyboardShapesBot', this.opts.robotsFetch);
      if (verdict.checked) {
        if (!verdict.allowed) throw new ImportFetchError('robots-disallowed', 'robots.txt disallows fetching this page for our user agent.');
        robots = 'allowed';
      }
    }
    const html = await this.opts.fetcher(url);
    return { ...this.importHtml(html, url), robots };
  }

  /** Parse HTML that was obtained elsewhere (pasted by the user, saved file, GitHub Action). */
  importHtml(html: string, url: string): ImportResult {
    const used = this.selectParsers(url);
    const results = used.map((p) => p.parseHtml(html, url));
    const product = mergeProducts(url, results);
    if (!product.name && !product.dimensions && product.images.length === 0) {
      product.warnings.push('No product data could be read from this page.');
    }
    return { url, product, parsersUsed: used.map((p) => p.name), robots: 'unchecked', checklist: buildChecklist(product) };
  }
}

export function buildChecklist(p: ProductData): ChecklistItem[] {
  const tokens = tokenize(`${p.brand ?? ''} ${p.model ?? ''} ${p.name ?? ''}`);
  // an image only counts when it is confidently named AND belongs to this product (see isAutoPickable)
  const best = (types: Parameters<typeof isAutoPickable>[1]) => p.images.find((i) => isAutoPickable(i, types, tokens));
  const top = best(['TOP', 'BLUEPRINT']);
  const side = best(['SIDE']);
  const noneDetail = p.images.length ? `${p.images.length} images found, none confidently a view of this product` : undefined;
  const dims = p.dimensions;
  const item = (label: string, ok: unknown, detail?: string, unknownIfMissing = false): ChecklistItem => ({
    label,
    status: ok ? 'ok' : unknownIfMissing ? 'unknown' : 'missing',
    detail,
  });
  return [
    item('Name', p.name, p.name),
    item('Dimensions', dims?.width?.value && dims?.depth?.value, dims?.raw),
    item('Height', dims?.height?.value, undefined, true),
    item('Layout', p.layoutHint, p.layoutHint ? `${p.layoutHint.layout} (${Math.round(p.layoutHint.confidence * 100)}%)` : undefined),
    item('Top image', top, top?.url ?? noneDetail),
    item('Side image', side, side?.url ?? noneDetail),
    item('Internal cavity', undefined, 'Not available from product pages', true),
    item('Mounting points', undefined, 'Not available from product pages', true),
  ];
}
