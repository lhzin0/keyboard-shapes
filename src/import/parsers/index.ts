import type { Fetcher, ProductData } from '../types';
import sources from '../../../data/sources.json';
import { BaseParser, fromGeneric, fromOpenGraph, fromSchema, hostOf, mergeProducts } from './common';

interface RegistryEntry {
  host: string;
  role: string;
}
const registry = sources as RegistryEntry[];

/**
 * Hosts whose pages we treat as the manufacturer's own specification (role "manufacturer" in data/sources.json).
 * Extend that registry as products are reviewed; being listed here raises the
 * confidence of dimensions found on the page, so only add sites you trust.
 */
export const MANUFACTURER_HOSTS: string[] = [...registry.filter((s) => s.role === 'manufacturer').map((s) => s.host), 'wooting.io'];

/** Retailers / marketplaces: useful, but their specs are copied from somewhere else. */
export const VENDOR_HOSTS: string[] = [...registry.filter((s) => s.role !== 'manufacturer').map((s) => s.host), 'amazon.com', 'aliexpress.com'];

const matchesHost = (url: string, list: string[]) => {
  const h = hostOf(url);
  return list.some((d) => h === d || h.endsWith(`.${d}`));
};

/** JSON-LD (schema.org Product). */
export class SchemaParser extends BaseParser {
  readonly name = 'SchemaParser';
  canHandle(): boolean {
    return true;
  }
  parseHtml(html: string, url: string): ProductData {
    return fromSchema(html, url, { sourceType: 'vendor', baseConfidence: 0.8 });
  }
}

/** OpenGraph / Twitter card meta tags. */
export class OpenGraphParser extends BaseParser {
  readonly name = 'OpenGraphParser';
  canHandle(): boolean {
    return true;
  }
  parseHtml(html: string, url: string): ProductData {
    return fromOpenGraph(html, url, { sourceType: 'vendor', baseConfidence: 0.6 });
  }
}

/** Spec tables, headings and prose — the last resort that works on any page. */
export class GenericParser extends BaseParser {
  readonly name = 'GenericParser';
  canHandle(): boolean {
    return true;
  }
  parseHtml(html: string, url: string): ProductData {
    return fromGeneric(html, url, { sourceType: 'vendor', baseConfidence: 0.6 });
  }
}

/** Known manufacturer sites: structured data + spec table, trusted as the specification. */
export class ManufacturerParser extends BaseParser {
  readonly name = 'ManufacturerParser';
  canHandle(url: string): boolean {
    return matchesHost(url, MANUFACTURER_HOSTS);
  }
  parseHtml(html: string, url: string): ProductData {
    const opts = { sourceType: 'manufacturer' as const, baseConfidence: 0.95 };
    return mergeProducts(url, [fromSchema(html, url, opts), fromGeneric(html, url, opts), fromOpenGraph(html, url, opts)]);
  }
}

/** Retailer pages: same extraction, lower trust. */
export class EcommerceParser extends BaseParser {
  readonly name = 'EcommerceParser';
  canHandle(url: string): boolean {
    return matchesHost(url, VENDOR_HOSTS) || /\/(products?|p|dp|item)\//i.test(new URL(url).pathname);
  }
  parseHtml(html: string, url: string): ProductData {
    const opts = { sourceType: 'vendor' as const, baseConfidence: 0.75 };
    return mergeProducts(url, [fromSchema(html, url, opts), fromGeneric(html, url, opts), fromOpenGraph(html, url, opts)]);
  }
}

export function defaultParsers(fetcher: Fetcher): BaseParser[] {
  // order = priority: specific first, generic last
  return [
    new ManufacturerParser(fetcher),
    new EcommerceParser(fetcher),
    new SchemaParser(fetcher),
    new OpenGraphParser(fetcher),
    new GenericParser(fetcher),
  ];
}
