import type { LayoutName, Measurement, SourceInfo } from '../types/keyboard';

export type ImageType = 'TOP' | 'SIDE' | 'FRONT' | 'BACK' | 'BLUEPRINT' | 'DETAIL' | 'UNKNOWN';

/** Where the page declared the image: structured data / og:image are the product's own images; plain markup may be anything. */
export type ImageOrigin = 'structured' | 'meta' | 'markup';

export interface ImageCandidate {
  origin: ImageOrigin;
  url: string;
  alt?: string;
  type: ImageType;
  /** 0..1 — how sure the classifier is. */
  typeConfidence: number;
  /** Heuristic usefulness for reconstruction (clean background, technical drawing …). */
  score: number;
  width?: number;
  height?: number;
  reasons: string[];
}

export interface ProductDimensions {
  width?: Measurement;
  depth?: Measurement;
  /** Overall height (rear / highest point) when the page does not say front or back. */
  height?: Measurement;
  /** Typing-surface height at the front edge, without keycaps ("front height"). */
  frontHeight?: Measurement;
  /** Typing-surface height at the back edge, without keycaps ("back/rear height"). */
  rearHeight?: Measurement;
  /** Raw text the numbers came from. */
  raw?: string;
}

export type ProductField =
  | 'name'
  | 'brand'
  | 'model'
  | 'price'
  | 'dimensions'
  | 'weight'
  | 'layout'
  | 'material'
  | 'images'
  | 'specs';

/** What a parser managed to learn about a product page. Every value is optional. */
export interface ProductData {
  url: string;
  name?: string;
  brand?: string;
  model?: string;
  price?: { amount: number; currency: string };
  dimensions?: ProductDimensions;
  weight?: Measurement;
  layoutHint?: { layout: LayoutName; confidence: number; reasons: string[] };
  keyCount?: number;
  material?: string;
  specs: Record<string, string>;
  images: ImageCandidate[];
  description?: string;
  /** Provenance of this record as a whole (one entry per parser that contributed). */
  sources: SourceInfo[];
  /** Which fields each parser filled (for the preview UI). */
  fieldSources: Partial<Record<ProductField, string>>;
  warnings: string[];
}

export type FetchFailureReason =
  | 'network-or-cors'
  | 'blocked'
  | 'not-found'
  | 'not-html'
  | 'robots-disallowed'
  | 'invalid-url'
  | 'http-error';

export class ImportFetchError extends Error {
  constructor(
    public reason: FetchFailureReason,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ImportFetchError';
  }
}

export interface ProductParser {
  readonly name: string;
  canHandle(url: string): boolean;
  parse(url: string): Promise<ProductData>;
  /** Synchronous parsing of already-fetched HTML (used by tests, the CLI and "paste HTML"). */
  parseHtml(html: string, url: string): ProductData;
}

export type Fetcher = (url: string) => Promise<string>;

export function emptyProduct(url: string): ProductData {
  return { url, specs: {}, images: [], sources: [], fieldSources: {}, warnings: [] };
}
