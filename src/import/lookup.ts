/**
 * lookup(query) — search many sites, import each matching product page, reconcile.
 *
 * Everything that touches the network is injected, so the whole pipeline is testable offline and
 * runs unchanged in Node (CLI, GitHub Action). Browsers cannot run it against shops (CORS): the web
 * app consumes the JSON result instead (see CrossCheckPanel).
 */
import { reconcileEditions, type Evidence, type ReconciledEditions, type SourceRole } from './CrossReference';
import { relevance } from './siteSearch';
import type { ImportResult } from './ProductImporter';
import { searchSite, type SearchDeps, type SearchHit, type SiteDef, type SiteSearchResult } from './siteSearch';
import { ImportFetchError, type ProductData } from './types';

export interface LookupDeps extends SearchDeps {
  /** Fetch + parse a product page (must honour robots.txt and report blocks as ImportFetchError). */
  importUrl(url: string): Promise<ImportResult>;
}

export interface LookupOptions {
  /** Pages imported per site. */
  maxPerSite?: number;
  /** Hits below this title relevance are ignored. */
  minRelevance?: number;
  concurrency?: number;
  /** Product pages the user points at directly (sites without a public search: marketplaces, brand pages …). */
  /** Show this edition (key from `reconciled.editions`) instead of the best supported one. */
  edition?: string;
  extraUrls?: Array<{ url: string; name: string; role: SourceRole }>;
  now?: () => string;
}

export interface LookupImport {
  url: string;
  title: string;
  relevance: number;
  status: 'ok' | 'blocked' | 'error' | 'skipped-low-relevance';
  error?: string;
  product?: ProductData;
}

export interface LookupSiteReport {
  site: Pick<SiteDef, 'id' | 'name' | 'host' | 'role' | 'platform'>;
  status: SiteSearchResult['status'];
  via: string;
  message?: string;
  considered: number;
  imports: LookupImport[];
}

export interface LookupResult {
  query: string;
  at: string;
  sites: LookupSiteReport[];
  evidence: Evidence[];
  reconciled: ReconciledEditions;
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

async function importHit(hit: SearchHit, deps: LookupDeps): Promise<LookupImport> {
  const base = { url: hit.url, title: hit.title, relevance: hit.relevance };
  if (hit.product) return { ...base, status: 'ok', product: hit.product };
  try {
    const r = await deps.importUrl(hit.url);
    return { ...base, status: 'ok', product: r.product };
  } catch (e) {
    if (e instanceof ImportFetchError) return { ...base, status: e.reason === 'blocked' || e.reason === 'robots-disallowed' ? 'blocked' : 'error', error: e.message };
    return { ...base, status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function lookup(query: string, sites: SiteDef[], deps: LookupDeps, opts: LookupOptions = {}): Promise<LookupResult> {
  const maxPerSite = opts.maxPerSite ?? 2;
  const minRelevance = opts.minRelevance ?? 0.6;

  const searchable = sites.filter((s) => s.platform !== 'none');
  const reports = await pool(searchable, opts.concurrency ?? 4, async (site): Promise<{ report: LookupSiteReport; evidence: Evidence[] }> => {
    const found = await searchSite(site, query, deps);
    const meta = { id: site.id, name: site.name, host: site.host, role: site.role, platform: site.platform };
    const good = found.hits.filter((h) => h.relevance >= minRelevance).slice(0, maxPerSite);
    const imports: LookupImport[] = [];
    for (const hit of found.hits.slice(0, maxPerSite + 2)) {
      if (!good.includes(hit)) {
        imports.push({ url: hit.url, title: hit.title, relevance: hit.relevance, status: 'skipped-low-relevance' });
        continue;
      }
      imports.push(await importHit(hit, deps));
      if (!hit.product) await deps.pause();
    }
    const evidence: Evidence[] = imports
      .filter((i): i is LookupImport & { product: ProductData } => i.status === 'ok' && !!i.product)
      .map((i) => ({ siteId: site.id, siteName: site.name, role: site.role, url: i.url, relevance: i.relevance, product: i.product }));
    return { report: { site: meta, status: found.status, via: found.via, message: found.message, considered: found.hits.length, imports }, evidence };
  });

  const evidence = reports.flatMap((r) => r.evidence);
  const extraReports: LookupSiteReport[] = [];
  for (const x of opts.extraUrls ?? []) {
    const host = new URL(x.url).host.replace(/^www\./, '');
    const imp = await importHit({ siteId: host, title: x.url, url: x.url, relevance: 1 }, deps);
    if (imp.status === 'ok' && imp.product) {
      const rel = relevance(query, imp.product.name ?? '');
      imp.title = imp.product.name ?? x.url;
      imp.relevance = rel;
      // a page the user chose is trusted to be the right product, but a title that does not match is still reported
      evidence.push({ siteId: host, siteName: x.name, role: x.role, url: x.url, relevance: Math.max(rel, 0.6), product: imp.product });
    }
    extraReports.push({ site: { id: host, name: x.name, host, role: x.role, platform: 'shopify' }, status: imp.status === 'ok' ? 'ok' : 'error', via: 'given URL', message: imp.error, considered: 1, imports: [imp] });
    await deps.pause();
  }
  return {
    query,
    at: opts.now?.() ?? new Date().toISOString(),
    sites: [...reports.map((r) => r.report), ...extraReports],
    evidence,
    reconciled: reconcileEditions(evidence, query, opts.edition),
  };
}
