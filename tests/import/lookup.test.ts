import { describe, expect, it } from 'vitest';
import { editionKey, mentionsVariants, reconcile, reconcileEditions, toleranceMm, type Evidence } from '../../src/import/CrossReference';
import { lookup, type LookupDeps } from '../../src/import/lookup';
import { ProductImporter } from '../../src/import/ProductImporter';
import { queryVariants, relevance, searchSite, wooToProduct, type SiteDef } from '../../src/import/siteSearch';
import { ImportFetchError, emptyProduct, type ProductData } from '../../src/import/types';
import type { Measurement } from '../../src/types/keyboard';

const m = (value: number, source: Measurement['source'] = 'vendor', confidence = 0.8): Measurement => ({ value, unit: 'mm', source, confidence });

function ev(siteId: string, role: Evidence['role'], patch: Partial<ProductData>, relevanceScore = 1): Evidence {
  const p = emptyProduct(`https://${siteId}.example/p`);
  Object.assign(p, patch);
  return { siteId, siteName: siteId, role, url: p.url, relevance: relevanceScore, product: p };
}

describe('relevance (query vs. product title)', () => {
  it('matches model numbers across spellings', () => {
    expect(relevance('madlions mad60he', 'Madlions MAD60/ MAD68 HE')).toBe(1);
    expect(relevance('mad60he', 'MAD60HE Magnetic Switch Keyboard')).toBe(1);
    expect(relevance('keychron q1', 'Keychron Q1 QMK Custom Mechanical Keyboard - Version 2')).toBe(1);
  });
  it('does not match a different model number', () => {
    expect(relevance('keychron q1', 'Keychron Q2 QMK Custom Mechanical Keyboard')).toBeLessThan(0.5);
    expect(relevance('mad65he', 'MAD60HE Magnetic Switch Keyboard')).toBeLessThan(0.5);
  });
  it('ignores generic words', () => {
    expect(relevance('mechanical keyboard', 'Anything')).toBe(0);
  });
});

describe('reconcile', () => {
  it('agreement raises confidence but a retailer never makes a value official', () => {
    const one = reconcile([ev('a', 'vendor', { dimensions: { width: m(327.5), depth: m(145) } })]);
    const three = reconcile([
      ev('a', 'vendor', { dimensions: { width: m(327.5), depth: m(145) } }),
      ev('b', 'vendor', { dimensions: { width: m(327), depth: m(145.2) } }),
      ev('c', 'vendor', { dimensions: { width: m(327.4), depth: m(144.8) } }),
    ]);
    expect(three.width!.confidence).toBeGreaterThan(one.width!.confidence);
    expect(three.width!.level).toBe('estimated');
    expect(three.width!.supporters).toHaveLength(3);
    expect(three.width!.value).toBeCloseTo(327.3, 0);
    expect(three.agreement).toBe(1);
  });

  it('two pages of the same shop are one voice, not two', () => {
    const r = reconcile([
      ev('shop', 'vendor', { dimensions: { width: m(292.1) } }),
      { ...ev('shop', 'vendor', { dimensions: { width: m(292.1) } }), url: 'https://shop.example/p-white' },
    ]);
    expect(r.width!.supporters).toHaveLength(1);
    const single = reconcile([ev('shop', 'vendor', { dimensions: { width: m(292.1) } })]);
    expect(r.width!.confidence).toBeCloseTo(single.width!.confidence, 6);
    expect(r.agreement).toBeNull(); // nothing to cross-check
  });

  it('a combined MAD60/MAD68 listing counts half in the layout vote', () => {
    const l = (layout: '60%' | '65%', name: string) => ({ name, layoutHint: { layout, confidence: 0.7, reasons: [] } });
    const r = reconcile([ev('a', 'vendor', l('60%', 'Madlions MAD60HE')), ev('b', 'vendor', l('65%', 'Madlions MAD60/ MAD68 HE'))]);
    expect(r.layout!.value).toBe('60%');
    expect(r.layout!.conflicts[0]!.weight).toBeLessThan(r.layout!.supporters[0]!.weight);
  });

  it('a manufacturer source makes the value official and decides the exact figure', () => {
    const r = reconcile([
      ev('shop', 'vendor', { dimensions: { width: m(328) } }),
      ev('brand', 'manufacturer', { dimensions: { width: m(327.5, 'manufacturer', 0.95) } }),
    ]);
    expect(r.width!.level).toBe('official');
    expect(r.width!.value).toBe(327.5);
  });

  it('reports disagreement instead of averaging it away', () => {
    const r = reconcile([
      ev('a', 'vendor', { dimensions: { width: m(327.5) } }),
      ev('b', 'vendor', { dimensions: { width: m(327) } }),
      ev('c', 'vendor', { dimensions: { width: m(292) } }),
    ]);
    expect(r.width!.value).toBeCloseTo(327.3, 0);
    expect(r.width!.conflicts.map((c) => c.value)).toEqual([292]);
    expect(r.width!.note).toMatch(/disagree/);
    expect(r.warnings.join(' ')).toMatch(/width:/);
    expect(r.agreement).toBeCloseTo(2 / 3, 5);
    // …and confidence is lower than if everyone agreed
    const agree = reconcile([ev('a', 'vendor', { dimensions: { width: m(327.5) } }), ev('b', 'vendor', { dimensions: { width: m(327) } }), ev('c', 'vendor', { dimensions: { width: m(327.2) } })]);
    expect(r.width!.confidence).toBeLessThan(agree.width!.confidence);
  });

  it('a lone manufacturer outweighs two disagreeing marketplaces', () => {
    const r = reconcile([
      ev('brand', 'manufacturer', { dimensions: { width: m(327.5, 'manufacturer', 1) } }),
      ev('m1', 'marketplace', { dimensions: { width: m(292, 'vendor', 0.6) } }),
      ev('m2', 'marketplace', { dimensions: { width: m(292.5, 'vendor', 0.6) } }),
    ]);
    expect(r.width!.value).toBe(327.5);
    expect(r.width!.conflicts).toHaveLength(2);
  });

  it('votes on layout and flags split evidence', () => {
    const l = (layout: '60%' | '65%') => ({ layoutHint: { layout, confidence: 0.7, reasons: [] } });
    const r = reconcile([ev('a', 'vendor', l('65%')), ev('b', 'vendor', l('65%')), ev('c', 'vendor', l('60%'))]);
    expect(r.layout!.value).toBe('65%');
    expect(r.layout!.conflicts).toHaveLength(1);
  });

  it('knows when a listing covers several variants', () => {
    expect(mentionsVariants('Madlions MAD60/ MAD68 HE')).toBe(true);
    expect(mentionsVariants('Keychron Q1 QMK Custom Mechanical Keyboard')).toBe(false);
    const r = reconcile([ev('a', 'vendor', { name: 'Madlions MAD60/ MAD68 HE', dimensions: { width: m(292) } }), ev('b', 'vendor', { name: 'MAD60HE', dimensions: { width: m(292) } })]);
    expect(r.warnings.join(' ')).toMatch(/several variants/);
  });

  it('says so when there is a single source or no data at all', () => {
    expect(reconcile([ev('a', 'vendor', {})]).warnings.join(' ')).toMatch(/Only one source/);
    const none = reconcile([]);
    expect(none.width).toBeUndefined();
    expect(none.agreement).toBeNull();
  });

  it('tolerance scales with size', () => {
    expect(toleranceMm(100)).toBe(1.2);
    expect(toleranceMm(400)).toBeCloseTo(1.6, 6);
    // 302 vs 305 mm (Wooting 60HE+ vs v2) must NOT be treated as the same measurement
    expect(Math.abs(305 - 302)).toBeGreaterThan(toleranceMm(302));
  });
});

/* ------------------------------------------------------------ simulated sites */

const shopify: SiteDef = { id: 'shop', name: 'Shop', host: 'shop.example', platform: 'shopify', role: 'vendor' };
const woo: SiteDef = { id: 'woo', name: 'Woo', host: 'woo.example', platform: 'woocommerce', role: 'vendor' };

function deps(routes: Record<string, unknown>, opts: { disallow?: RegExp } = {}): LookupDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getJson(url) {
      calls.push(url);
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) throw new Error(`404 ${url}`);
      return routes[key];
    },
    async robotsAllows(url) {
      return !(opts.disallow && opts.disallow.test(url));
    },
    async pause() {},
    async importUrl(url) {
      const html = `<script type="application/ld+json">{"@type":"Product","name":"Acme Forge 65","brand":{"name":"Acme"}}</script><table><tr><th>Dimensions</th><td>325 x 115 x 35 mm</td></tr></table>`;
      return new ProductImporter({ fetcher: async () => html }).importHtml(html, url);
    },
  };
}

describe('searchSite', () => {
  it('Shopify: uses predictive search when robots.txt allows it', async () => {
    const d = deps({ '/search/suggest.json': { resources: { results: { products: [{ title: 'Acme Forge 65', handle: 'forge-65', url: '/products/forge-65?_pos=1', vendor: 'Acme' }, { title: 'Acme Mouse', handle: 'mouse', url: '/products/mouse' }] } } } });
    const r = await searchSite(shopify, 'acme forge65', d);
    expect(r.status).toBe('ok');
    expect(r.via).toBe('shopify predictive search');
    expect(r.hits[0]?.url).toBe('https://shop.example/products/forge-65'); // tracking query dropped
    expect(r.hits[0]!.relevance).toBeGreaterThan(r.hits[1]!.relevance);
  });

  it('Shopify: falls back to products.json when /search is disallowed — and never calls the disallowed URL', async () => {
    const d = deps({ '/products.json': { products: [{ title: 'Forge 65', handle: 'forge-65', vendor: 'Acme', images: [{ src: 'https://cdn/x.png' }] }, { title: 'Unrelated Cable', handle: 'cable' }] } }, { disallow: /\/search/ });
    const r = await searchSite(shopify, 'acme forge65', d);
    expect(r.via).toBe('shopify products.json');
    expect(r.hits.map((h) => h.url)).toEqual(['https://shop.example/products/forge-65']);
    expect(d.calls.some((u) => u.includes('/search'))).toBe(false);
  });

  it('is reported as denied when robots.txt disallows everything', async () => {
    const r = await searchSite(shopify, 'acme', deps({}, { disallow: /./ }));
    expect(r.status).toBe('denied');
    expect(r.hits).toEqual([]);
  });

  it('WooCommerce: builds the product straight from the Store API (no HTML page needed)', async () => {
    const d = deps({ '/wp-json/wc/store/v1/products': [{ name: 'Acme Forge 65 Keyboard', permalink: 'https://woo.example/product/forge-65/', description: '<p>65% layout, 68 keys. Dimensions: 325 x 115 x 35 mm. Weight: 1.8 kg</p>', short_description: '', images: [{ src: 'https://cdn/forge-top-view.png', alt: 'top view' }], attributes: [{ name: 'Material', terms: [{ name: 'Aluminium' }] }] }] });
    const r = await searchSite(woo, 'acme forge65', d);
    const p = r.hits[0]!.product!;
    expect(p.dimensions?.width?.value).toBe(325);
    expect(p.weight?.value).toBe(1800);
    expect(p.layoutHint?.layout).toBe('65%');
    expect(p.material).toBe('Aluminium');
    expect(p.images[0]?.origin).toBe('structured');
  });

  it('retries with the model number when the full query finds nothing (AND-style shop search)', async () => {
    const calls: string[] = [];
    const d = deps({});
    d.getJson = async (url) => {
      calls.push(decodeURIComponent(url));
      // the shop only matches the model number, like WooCommerce's AND search on a title without the brand
      if (url.includes('search=mad60he')) return [{ name: 'MAD60HE Custom Keyboard', permalink: 'https://woo.example/p/mad60he', description: '', images: [], attributes: [] }];
      return [];
    };
    const r = await searchSite({ ...woo, name: 'Madlions Store' }, 'madlions mad60he', d);
    expect(r.status).toBe('ok');
    expect(calls.length).toBe(2);
    expect(calls[0]).toMatch(/search=madlions mad60he/);
    expect(calls[1]).toMatch(/search=mad60he/);
    expect(r.hits[0]!.relevance).toBeGreaterThanOrEqual(0.6); // ranked against the original query
  });

  it('never sends more than three requests per site', () => {
    expect(queryVariants('madlions mad60he magnetic switch keyboard').length).toBeLessThanOrEqual(3);
    expect(queryVariants('madlions mad60he')[0]).toBe('madlions mad60he');
    expect(queryVariants('madlions mad60he')[1]).toBe('mad60he');
  });

  it('turns a failing endpoint into an error report instead of throwing', async () => {
    const r = await searchSite(shopify, 'x', deps({}));
    expect(r.status).toBe('error');
  });

  it('wooToProduct ignores shipping boxes: only text dimensions are used', () => {
    const p = wooToProduct({ name: 'K', permalink: 'https://woo.example/p', description: 'nice', dimensions: { length: '40', width: '20', height: '10' } }, woo);
    expect(p.dimensions).toBeUndefined();
  });
});

describe('lookup (end to end, offline)', () => {
  it('searches several sites, skips low-relevance hits, survives a blocked page, and reconciles', async () => {
    const d = deps({
      'shop.example/search/suggest.json': { resources: { results: { products: [{ title: 'Acme Forge 65', url: '/products/forge-65' }, { title: 'Acme Forge 75', url: '/products/forge-75' }] } } },
      'woo.example/wp-json': [{ name: 'Acme Forge 65', permalink: 'https://woo.example/p', description: 'Dimensions: 325 x 115 x 35 mm. 65% layout.', images: [], attributes: [] }],
    });
    const imp = d.importUrl;
    d.importUrl = async (url) => {
      if (url.includes('forge-75')) throw new ImportFetchError('blocked', 'challenge');
      return imp(url);
    };
    const res = await lookup('acme forge65', [shopify, woo], d, { maxPerSite: 3, now: () => '2026-10-01T00:00:00Z' });
    expect(res.at).toBe('2026-10-01T00:00:00Z');
    const shopReport = res.sites.find((s) => s.site.id === 'shop')!;
    expect(shopReport.imports.find((i) => i.url.includes('forge-75'))?.status).toBe('skipped-low-relevance');
    expect(res.evidence).toHaveLength(2);
    expect(res.reconciled.width?.supporters).toHaveLength(2);
    expect(res.reconciled.width?.value).toBeCloseTo(325, 0);
    expect(res.reconciled.contributors).toBe(2);
  });

  it('includes pages the user points at, weighting a marketplace below a manufacturer', async () => {
    const d = deps({});
    d.importUrl = async (url) => {
      const w = url.includes('brand') ? '327.5' : '292';
      const html = `<h1>Acme Forge 65</h1><table><tr><th>Width</th><td>${w} mm</td></tr><tr><th>Depth</th><td>110 mm</td></tr></table>`;
      return new ProductImporter({ fetcher: async () => html }).importHtml(html, url);
    };
    const res = await lookup('acme forge65', [], d, {
      extraUrls: [
        { url: 'https://brand.example/forge', name: 'Brand', role: 'manufacturer' },
        { url: 'https://www.amazon.example/dp/1', name: 'amazon.example', role: 'marketplace' },
      ],
    });
    expect(res.sites.map((s) => s.via)).toEqual(['given URL', 'given URL']);
    expect(res.evidence).toHaveLength(2);
    expect(res.reconciled.width!.conflicts.map((c) => c.siteName)).toEqual(['amazon.example']);
  });

  it('reports blocked pages per site and still returns what other sites said', async () => {
    const d = deps({ 'shop.example/search/suggest.json': { resources: { results: { products: [{ title: 'Acme Forge 65', url: '/products/forge-65' }] } } } });
    d.importUrl = async () => {
      throw new ImportFetchError('blocked', 'challenge');
    };
    const res = await lookup('acme forge65', [shopify], d);
    expect(res.sites[0]?.imports[0]?.status).toBe('blocked');
    expect(res.evidence).toEqual([]);
    expect(res.reconciled.width).toBeUndefined();
  });
});

describe('model identity and front/rear height (regressions from the live Keychron test)', () => {
  it('"Q1 Max / HE / Pro / Ultra" are different products from a plain "Q1"', () => {
    const q = 'keychron q1';
    expect(relevance(q, 'Keychron Q1 QMK Custom Mechanical Keyboard - Version 2')).toBe(1);
    for (const other of ['Keychron Q1 Max', 'Keychron Q1 HE 8K Magnetic Switch Keyboard', 'Keychron Q1 Pro Wireless 75% Keyboard', 'Keychron Q1 Ultra 8K']) {
      expect(relevance(q, other)).toBeLessThan(0.6);
    }
    expect(relevance('keychron q1 max', 'Keychron Q1 Max QMK/VIA')).toBe(1);
    // …but a query that already contains the variant word, as part of a model code, is not penalised
    expect(relevance('madlions mad60he', 'Madlions MAD60/ MAD68 HE')).toBe(1);
  });

  it('front and back height are separate measurements and give the typing angle', async () => {
    const { extractDimensions } = await import('../../src/import/DimensionExtractor');
    const d = extractDimensions('Length: 327.5 mm Width: 145 mm Front height: 22.6 mm Back height: 35.8 mm', 'manufacturer', 0.95);
    expect(d.width?.value).toBe(327.5);
    expect(d.depth?.value).toBe(145);
    expect(d.frontHeight?.value).toBe(22.6);
    expect(d.rearHeight?.value).toBe(35.8);
    expect(d.height).toBeUndefined(); // a qualified height is never a bare "height"
    const r = reconcile([ev('brand', 'manufacturer', { dimensions: { width: d.width, depth: d.depth, frontHeight: d.frontHeight, rearHeight: d.rearHeight } })]);
    expect(r.angleDeg).toBeCloseTo(5.2, 1); // the manufacturer states 5.2°
  });

  it('a bare height is never compared with a back height', () => {
    const r = reconcile([
      ev('a', 'vendor', { dimensions: { height: m(22.6) } }),
      ev('b', 'vendor', { dimensions: { rearHeight: m(35.8) } }),
    ]);
    expect(r.height!.supporters).toHaveLength(1);
    expect(r.height!.conflicts).toHaveLength(0);
    expect(r.rearHeight!.conflicts).toHaveLength(0);
  });

  it('the draft record gets its angle from front/rear height', async () => {
    const { buildDraft } = await import('../../src/import/DraftBuilder');
    const draft = buildDraft({ brand: 'Keychron', model: 'Q1', layout: '75%', widthMm: 327.5, depthMm: 145, frontHeightMm: 22.6, rearHeightMm: 35.8, sources: [], imageUrls: [], existingSlugs: new Set() });
    expect(draft.case.angle).toBeCloseTo(5.2, 1);
    expect(draft.case.frontHeight).toBe(22.6);
    expect(draft.case.rearHeight).toBe(35.8);
  });
});

describe('accessories are not the keyboard', () => {
  it('plates, cables and keycap sets under the keyboard name are down-weighted unless asked for', () => {
    expect(relevance('keychron q1', 'Keychron Q1 Plate')).toBeLessThan(0.6);
    expect(relevance('keychron q1', 'Keychron Q1 Knob / No Knob Plate')).toBeLessThan(0.6); // the plate for it
    expect(relevance('keychron q1', 'Keychron Q1 V2 w/ Knob Aluminum 75% Keyboard')).toBe(1); // a keyboard variant, not an accessory
    expect(relevance('keychron q1', 'Keychron Q1 Replacement Keycap Set')).toBeLessThan(0.6);
    expect(relevance('keychron q1 plate', 'Keychron Q1 Plate')).toBe(1);
    expect(relevance('keychron q1', 'Keychron Q1 QMK Custom Mechanical Keyboard')).toBe(1);
  });
});

describe('regional editions and naming', () => {
  it('ISO / JIS editions rank below the plain edition unless asked for', () => {
    expect(relevance('keychron q1', 'Keychron Q1 QMK Custom Mechanical Keyboard ISO Layout Collection')).toBeLessThan(0.8);
    expect(relevance('keychron q1', 'Keychron Q1 QMK Custom Mechanical Keyboard')).toBe(1);
    expect(relevance('keychron q1 iso', 'Keychron Q1 ISO Layout')).toBe(1);
  });
  it('the record name comes from the best page: not a combined listing, then the shortest title', () => {
    const r = reconcile([
      ev('a', 'vendor', { name: 'Madlions MAD60/ MAD68 HE' }),
      ev('b', 'vendor', { name: 'Madlions Mad60 HE E-sports Magnetic Switch Mechanical Keyboard - Black' }),
      ev('c', 'vendor', { name: 'Madlions Mad60 HE Keyboard' }),
    ]);
    expect(r.name).toBe('Madlions Mad60 HE Keyboard');
  });
});

describe('regressions from the live Wooting 60HE test', () => {
  it('a missing brand word is eliminatory: another maker sharing the model number is not the product', () => {
    expect(relevance('wooting 60he', 'Wooting 60HE V2 Magnetic 8K Keyboard')).toBe(1);
    for (const other of ['Aula WIN60/ WIN68 HE', 'Ajazz ALUX60 HE', 'Madlions MAD60/ MAD68 HE', 'Luminkey Magger60 HE Keyboard']) {
      expect(relevance('wooting 60he', other)).toBeLessThan(0.6);
    }
    // …but a single-brand shop that leaves the brand out of its titles is matched through its own name
    expect(relevance('madlions mad60he', 'MadlionsKeyboard MAD60HE Custom Keyboard')).toBeGreaterThanOrEqual(0.6);
  });

  it('carrying cases and accessory bundles are not the keyboard', () => {
    expect(relevance('wooting 60he', 'Wooting 60HE V2 Keyboard Travel Carrying Case')).toBeLessThan(0.6);
    expect(relevance('wooting 60he', 'Tofu60 3.0 HE Accessories')).toBeLessThan(0.6);
  });

  it('editionKey tells 60HE+, v2 and plain apart', () => {
    expect(editionKey('Wooting 60HE+ Magnetic 60% Hotswap')).toBe('plus');
    expect(editionKey('Wooting 60HE v2 - A classic, reinvented')).toBe('v2');
    expect(editionKey('Wooting 60HE V2 Magnetic 8K Keyboard')).toBe('v2');
    expect(editionKey('Wooting 60HE')).toBe('');
    expect(editionKey('Keychron Q1 QMK Custom Mechanical Keyboard - Version 2')).toBe('v2');
    expect(editionKey('Keychron Q1 Max')).toBe('max');
  });

  it('two editions of the same shop are reconciled separately, never fused', () => {
    const plus = ev('wooting', 'manufacturer', { name: 'Wooting 60HE+', dimensions: { width: m(302, 'manufacturer', 0.95), depth: m(116, 'manufacturer', 0.95) } });
    const v2 = { ...ev('wooting', 'manufacturer', { name: 'Wooting 60HE v2', dimensions: { width: m(305, 'manufacturer', 0.95), depth: m(115, 'manufacturer', 0.95) } }), url: 'https://wooting.example/v2' };
    const shop = ev('shop', 'vendor', { name: 'Wooting 60HE V2 Magnetic 8K Keyboard', dimensions: { width: m(305), depth: m(115) } });
    const r = reconcileEditions([plus, v2, shop], 'wooting 60he');
    expect(r.editions.map((e) => e.key).sort()).toEqual(['plus', 'v2']);
    expect(r.byEdition['plus']!.width!.value).toBe(302);
    expect(r.byEdition['v2']!.width!.value).toBe(305);
    expect(r.byEdition['v2']!.width!.supporters).toHaveLength(2); // wooting + the shop agree on v2
    expect(r.warnings[0]).toMatch(/2 editions/);
  });

  it('the edition named in the query wins; otherwise the best supported / official one', () => {
    const plus = ev('wooting', 'manufacturer', { name: 'Wooting 60HE+', dimensions: { width: m(302, 'manufacturer', 0.95) } });
    const v2a = ev('a', 'vendor', { name: 'Wooting 60HE v2', dimensions: { width: m(305) } });
    const v2b = ev('b', 'vendor', { name: 'Wooting 60HE v2 keyboard', dimensions: { width: m(305) } });
    expect(reconcileEditions([plus, v2a, v2b], 'wooting 60he v2').edition).toBe('v2');
    expect(reconcileEditions([plus, v2a, v2b], 'wooting 60he+').edition).toBe('plus');
    expect(reconcileEditions([plus, v2a, v2b], 'wooting 60he').edition).toBe('plus'); // official beats a pair of retailers
    expect(reconcileEditions([plus, v2a, v2b], 'wooting 60he', 'v2').edition).toBe('v2'); // explicit choice
  });

  it('pages without an edition marker count for every edition, at reduced weight', () => {
    const generic = ev('g', 'vendor', { name: 'Wooting 60HE', dimensions: { width: m(305) } });
    const v2 = ev('b', 'vendor', { name: 'Wooting 60HE v2', dimensions: { width: m(305) } });
    const plus = ev('c', 'vendor', { name: 'Wooting 60HE+', dimensions: { width: m(302) } });
    const r = reconcileEditions([generic, v2, plus], 'wooting 60he');
    expect(r.byEdition['v2']!.width!.supporters.map((s) => s.siteId).sort()).toEqual(['b', 'g']);
    expect(r.byEdition['plus']!.width!.conflicts.map((s) => s.siteId)).toEqual(['g']);
  });

  it('weight from JSON-LD is treated as possible shipping weight; "grams" is understood', async () => {
    const { extractWeight } = await import('../../src/import/DimensionExtractor');
    expect(extractWeight('Weight: 605 grams', 'manufacturer', 0.9)?.value).toBe(605);
    const html = '<script type="application/ld+json">{"@type":"Product","name":"X","weight":{"value":"1000","unitCode":"GRM"}}</script>';
    const p = new ProductImporter({ fetcher: async () => html }).importHtml(html, 'https://shop.example.com/p/x').product;
    expect(p.weight?.confidence).toBeLessThanOrEqual(0.35);
  });
});
