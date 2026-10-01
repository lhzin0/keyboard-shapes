import { describe, expect, it } from 'vitest';
import { extractDimensions, extractWeight } from '../../src/import/DimensionExtractor';
import { classifyImage, extractImages, isAutoPickable } from '../../src/import/ImageExtractor';
import { buildChecklist, ProductImporter } from '../../src/import/ProductImporter';
import { normalizeUrl, looksLikeChallenge } from '../../src/import/fetcher';
import { checkRobots, isAllowed, parseRobots } from '../../src/import/robots';
import { extractJsonLd, extractMeta, extractSpecPairs } from '../../src/import/html';
import { ImportFetchError } from '../../src/import/types';
import { detectLayoutByVoting, detectLayoutFromText } from '../../src/import/LayoutDetector';

const PAGE = `<!doctype html><html><head>
<title>Acme Forge 65 – Custom Keyboard | Shop</title>
<meta property="og:title" content="Acme Forge 65" />
<meta property="og:image" content="https://cdn.example.com/forge65-top-view.png" />
<meta name="description" content="Gasket-mounted 65% aluminium keyboard kit.">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Acme Forge 65","brand":{"@type":"Brand","name":"Acme"},
 "sku":"FORGE-65","description":"65% layout, 68 keys.",
 "image":["https://cdn.example.com/forge65-side-view.jpg","https://cdn.example.com/logo.png"],
 "offers":{"@type":"Offer","price":"189.00","priceCurrency":"USD"},
 "weight":{"@type":"QuantitativeValue","value":"2.1","unitCode":"KGM"}}
</script></head>
<body><h1>Acme Forge 65</h1>
<table><tr><th>Dimensions</th><td>325 x 115 x 35 mm</td></tr>
<tr><th>Layout</th><td>65%</td></tr><tr><th>Material</th><td>CNC aluminium</td></tr></table>
<img src="/img/forge65-blueprint.png" alt="technical drawing" width="900" height="400">
<img src="/img/sprite-icons.svg"><img src="/img/tiny.png" width="20" height="20">
</body></html>`;

describe('html helpers', () => {
  it('reads meta tags, title and JSON-LD', () => {
    const m = extractMeta(PAGE);
    expect(m.byKey['og:title']).toBe('Acme Forge 65');
    expect(m.title).toMatch(/Forge 65/);
    expect(extractJsonLd(PAGE).some((n) => n['@type'] === 'Product')).toBe(true);
  });
  it('tolerates malformed JSON-LD', () => {
    expect(extractJsonLd('<script type="application/ld+json">{oops</script>')).toEqual([]);
  });
  it('extracts spec table pairs', () => {
    const s = extractSpecPairs(PAGE);
    expect(s['Dimensions']).toBe('325 x 115 x 35 mm');
    expect(s['Material']).toBe('CNC aluminium');
  });
});

describe('DimensionExtractor', () => {
  it.each([
    ['325 x 115 x 35 mm', 325, 115, 35],
    ['325×115×35mm', 325, 115, 35],
    ['32.5 x 11.5 x 3.5 cm', 325, 115, 35],
    ['12.8 x 4.5 x 1.4 in', 325.12, 114.3, 35.56],
  ])('parses "%s"', (text, w, d, h) => {
    const r = extractDimensions(text, 'vendor', 0.8);
    expect(r.width?.value).toBeCloseTo(w, 1);
    expect(r.depth?.value).toBeCloseTo(d, 1);
    expect(r.height?.value).toBeCloseTo(h, 1);
    expect(r.width?.unit).toBe('mm');
  });

  it('prefers labelled values and treats "length" as the long side', () => {
    const r = extractDimensions('Length: 327 mm, Width: 115 mm, Height: 33 mm', 'manufacturer', 1);
    expect(r.width?.value).toBe(327);
    expect(r.depth?.value).toBe(115);
    expect(r.width?.confidence).toBe(1);
    expect(r.width?.method).toBe('labelled-text');
  });

  it('gives sequences a lower confidence than labels', () => {
    const r = extractDimensions('325 x 115 x 35 mm', 'vendor', 1);
    expect(r.width?.confidence).toBeLessThan(1);
    expect(r.warnings.join(' ')).toMatch(/assumed/);
  });

  it('rejects implausible values and numbers without a unit', () => {
    expect(extractDimensions('5 x 3 x 2', 'vendor', 1).width).toBeUndefined();
    expect(extractDimensions('12 x 6 x 3 mm', 'vendor', 1).width).toBeUndefined();
  });

  it('parses weights', () => {
    expect(extractWeight('Weight: 2.1 kg', 'vendor', 0.8)?.value).toBe(2100);
    expect(extractWeight('Net weight 850 g', 'vendor', 0.8)?.value).toBe(850);
    expect(extractWeight('Weight: 3 lbs', 'vendor', 0.8)?.value).toBe(1361);
  });
});

describe('ImageExtractor', () => {
  it('classifies by file name and alt text', () => {
    expect(classifyImage('https://x/y/forge65-top-view.png').type).toBe('TOP');
    expect(classifyImage('https://x/y/side.jpg').type).toBe('SIDE');
    expect(classifyImage('https://x/y/img1.jpg', 'technical drawing').type).toBe('BLUEPRINT');
    expect(classifyImage('https://x/y/img1.jpg').type).toBe('UNKNOWN');
  });

  it('collects, resolves, dedupes and filters images', () => {
    const imgs = extractImages(PAGE, 'https://shop.example.com/products/forge-65');
    const urls = imgs.map((i) => i.url);
    expect(urls).toContain('https://cdn.example.com/forge65-top-view.png');
    expect(urls).toContain('https://cdn.example.com/forge65-side-view.jpg');
    expect(urls).toContain('https://shop.example.com/img/forge65-blueprint.png');
    expect(urls.some((u) => /logo|sprite|tiny/.test(u))).toBe(false);
    expect(imgs[0]?.score).toBeGreaterThanOrEqual(imgs[imgs.length - 1]?.score ?? 0);
  });
});

describe('ProductImporter', () => {
  const importer = new ProductImporter({ fetcher: async () => PAGE });

  it('normalises URLs', () => {
    expect(normalizeUrl('Example.com/p/x?utm_source=a&id=3#frag')).toBe('https://example.com/p/x?id=3');
    expect(() => normalizeUrl('ftp://x.com')).toThrow(ImportFetchError);
    expect(() => normalizeUrl('')).toThrow(ImportFetchError);
  });

  it('merges structured data, spec table and images', () => {
    const r = importer.importHtml(PAGE, 'https://shop.example.com/products/forge-65');
    const p = r.product;
    expect(p.name).toBe('Acme Forge 65');
    expect(p.brand).toBe('Acme');
    expect(p.model).toBe('FORGE-65');
    expect(p.price).toEqual({ amount: 189, currency: 'USD' });
    expect(p.weight?.value).toBe(2100);
    expect(p.dimensions?.width?.value).toBe(325);
    expect(p.dimensions?.depth?.value).toBe(115);
    expect(p.layoutHint?.layout).toBe('65%');
    expect(p.material).toMatch(/aluminium/i);
    expect(r.parsersUsed).toContain('SchemaParser');
    expect(p.sources.length).toBeGreaterThan(1);
    // never present a retailer page as an official source
    expect(p.dimensions?.width?.source).toBe('vendor');
  });

  it('builds the preview checklist honestly (internal data is unknown, never "ok")', () => {
    const r = importer.importHtml(PAGE, 'https://shop.example.com/products/forge-65');
    const byLabel = Object.fromEntries(r.checklist.map((c) => [c.label, c.status]));
    expect(byLabel['Name']).toBe('ok');
    expect(byLabel['Dimensions']).toBe('ok');
    expect(byLabel['Top image']).toBe('ok');
    expect(byLabel['Side image']).toBe('ok');
    expect(byLabel['Internal cavity']).toBe('unknown');
    expect(byLabel['Mounting points']).toBe('unknown');
  });

  it('reports an empty page instead of inventing data', () => {
    const r = importer.importHtml('<html><body>hello</body></html>', 'https://x.example.com/');
    expect(r.product.dimensions).toBeUndefined();
    expect(r.product.warnings.join(' ')).toMatch(/No product data/);
    expect(buildChecklist(r.product).find((c) => c.label === 'Dimensions')?.status).toBe('missing');
  });

  it('raises typed errors from the fetcher and respects robots.txt', async () => {
    const blocked = new ProductImporter({
      fetcher: async () => {
        throw new ImportFetchError('blocked', 'challenge');
      },
    });
    await expect(blocked.import('https://x.example.com/p/1')).rejects.toMatchObject({ reason: 'blocked' });

    const robots = new ProductImporter({
      fetcher: async () => PAGE,
      robotsFetch: async () => ({ status: 200, text: 'User-agent: *\nDisallow: /products/' }),
      userAgent: 'KeyboardShapesBot',
    });
    await expect(robots.import('https://x.example.com/products/a')).rejects.toMatchObject({ reason: 'robots-disallowed' });
    await expect(robots.import('https://x.example.com/about')).resolves.toMatchObject({ robots: 'allowed' });
  });
});

describe('robots.txt and block detection', () => {
  const txt = `User-agent: *\nDisallow: /cart\nDisallow: /search$\nAllow: /cart/public\n\nUser-agent: KeyboardShapesBot\nDisallow: /private\n`;
  it('picks the most specific group and the longest match', () => {
    const generic = parseRobots(txt, 'SomeOtherBot');
    expect(isAllowed(generic, 'https://x.com/cart')).toBe(false);
    expect(isAllowed(generic, 'https://x.com/cart/public')).toBe(true);
    expect(isAllowed(generic, 'https://x.com/search')).toBe(false);
    expect(isAllowed(generic, 'https://x.com/search?q=1')).toBe(true);
    const ours = parseRobots(txt, 'KeyboardShapesBot/0.1');
    expect(isAllowed(ours, 'https://x.com/private')).toBe(false);
    expect(isAllowed(ours, 'https://x.com/cart')).toBe(true);
  });

  it('is unchecked (not "allowed") when robots.txt is unreachable', async () => {
    const v = await checkRobots('https://x.com/a', 'bot', async () => {
      throw new TypeError('cors');
    });
    expect(v.checked).toBe(false);
  });

  it('recognises challenge pages and never treats them as products', () => {
    expect(looksLikeChallenge(200, '<title>Just a moment...</title>')).toBe(true);
    expect(looksLikeChallenge(403, '')).toBe(true);
    expect(looksLikeChallenge(200, PAGE)).toBe(false);
  });
});

describe('Portuguese marketplace listing (text taken from a real AliExpress product page)', () => {
  const html = `<html><head><title>Madlions mad 60he interruptor magnético teclado mecânico mad68</title></head><body>
    <h1>Madlions mad 60he interruptor magnético teclado mecânico mad68 teclado com fio</h1>
    <p>O teclado wired mad60he oferece um design minimalista de 61 teclas, perfeito para uso em desktop.</p>
    <ul><li><strong>Material da chave:</strong> Plástico PBT</li></ul></body></html>`;
  const importer = new ProductImporter({ fetcher: async () => html });

  it('finds the layout from the Portuguese description, with reduced confidence', () => {
    const r = importer.importHtml(html, 'https://pt.aliexpress.com/item/1005010494742288.html');
    expect(r.product.layoutHint?.layout).toBe('60%');
    expect(r.product.layoutHint?.confidence).toBeLessThanOrEqual(0.4);
    expect(r.product.layoutHint?.reasons.join(' ')).toMatch(/page text/);
  });

  it('does not invent dimensions that the page does not publish', () => {
    const r = importer.importHtml(html, 'https://pt.aliexpress.com/item/1005010494742288.html');
    expect(r.product.dimensions).toBeUndefined();
    expect(r.checklist.find((c) => c.label === 'Dimensions')?.status).toBe('missing');
  });

  it('is treated as a vendor listing, never as the manufacturer', () => {
    const r = importer.importHtml(html, 'https://pt.aliexpress.com/item/1005010494742288.html');
    expect(r.parsersUsed).toContain('EcommerceParser');
    expect(r.parsersUsed).not.toContain('ManufacturerParser');
    expect(r.product.sources.every((s) => s.sourceType === 'vendor')).toBe(true);
  });

  it('reads Portuguese dimension and weight labels', () => {
    const d = extractDimensions('Comprimento: 315 mm, Largura: 110 mm, Altura: 38 mm', 'vendor', 0.7);
    expect([d.width?.value, d.depth?.value, d.height?.value]).toEqual([315, 110, 38]);
    expect(extractWeight('Peso: 780 g', 'vendor', 0.7)?.value).toBe(780);
  });

  it('detects Portuguese / Spanish layout words', () => {
    expect(detectLayoutFromText('teclado com 68 teclas').layout).toBe('65%');
    expect(detectLayoutFromText('teclado sem teclado numérico').layout).toBe('TKL');
    expect(detectLayoutFromText('teclado de tamanho normal').layout).toBe('Full Size');
  });
});

describe('image classification regressions (found on a real Shopify page)', () => {
  it('a hex hash containing "cad" is not a CAD drawing', () => {
    expect(classifyImage('https://x/Keychron-Pre-Cut-Universal-Mouse-Grip-Tape-Image-3_82d14d31-cc57-4ed0-a4ee-20b09cad405d.jpg').type).not.toBe('BLUEPRINT');
  });
  it('"Low Profile" / "Cherry Profile" are keycap profiles, not side views', () => {
    expect(classifyImage('https://x/ISO_Cherry_Profile_Hacker_Miint.png', 'Keycaps').type).not.toBe('SIDE');
    expect(classifyImage('https://x/Low_profile_Optical_Switch_Set.png').type).not.toBe('SIDE');
  });
  it('real view names still classify, with explicit names trusted more than bare words', () => {
    expect(classifyImage('https://x/q1-side-view.png').type).toBe('SIDE');
    expect(classifyImage('https://x/q1-side-view.png').typeConfidence).toBeGreaterThanOrEqual(0.8);
    expect(classifyImage('https://x/q1-side.png').typeConfidence).toBeLessThan(0.8);
    expect(classifyImage('https://x/q1-technical-drawing.png').type).toBe('BLUEPRINT');
  });
  it('only product-declared, confidently named images are auto-picked', () => {
    const html = `<meta property="og:image" content="https://cdn.x/q1-top-view.png"><img src="https://cdn.x/other-top-view.png"><img src="https://cdn.x/q1-side.png">`;
    const imgs = extractImages(html, 'https://shop.example.com/p/q1');
    const og = imgs.find((i) => i.url.includes('q1-top-view'))!;
    const other = imgs.find((i) => i.url.includes('other-top-view'))!;
    const weak = imgs.find((i) => i.url.includes('q1-side'))!;
    expect(og.origin).toBe('meta');
    expect(isAutoPickable(og, ['TOP'])).toBe(true);
    expect(isAutoPickable(other, ['TOP'], ['q1'])).toBe(false); // plain markup, name does not mention the product
    expect(isAutoPickable(weak, ['SIDE'], ['q1'])).toBe(false); // weak hint ("side" only)
  });
  it('page text: the most frequent layout wins, and split evidence is reported as such', () => {
    const noisy = '75% 75% 75% layout. Compatible with full-size keycaps.';
    expect(detectLayoutByVoting(noisy).layout).toBe('75%');
    const split = detectLayoutByVoting('65% or 75% layout');
    expect(split.confidence).toBeLessThan(0.3);
    expect(split.reasons[0]).toMatch(/several layouts/);
  });
});

describe('brand / model derivation (shop name is not the brand)', () => {
  it('treats a brand that matches the shop host as the retailer', async () => {
    const { deriveBrandModel } = await import('../../src/import/naming');
    const r = deriveBrandModel({ name: 'Madlions MAD60/ MAD68 HE', brand: 'MKB.MY', url: 'https://mkb.gg/products/madlions-mad60-mad68-he' });
    expect(r.brand).toBe('Madlions');
    expect(r.model).toBe('MAD60/ MAD68 HE');
    expect(r.notes.join(' ')).toMatch(/looks like the shop/);
  });
  it('keeps a genuine brand and strips it from the model', async () => {
    const { deriveBrandModel } = await import('../../src/import/naming');
    const r = deriveBrandModel({ name: 'Keychron Q1 QMK Custom Mechanical Keyboard', brand: 'Keychron', url: 'https://www.keychron.com/products/keychron-q1' });
    expect(r.brand).toBe('Keychron');
    expect(r.model).toBe('Q1 QMK Custom Mechanical Keyboard');
    expect(r.notes).toEqual([]);
  });
  it('placeholder SKUs are not models', () => {
    const html = '<script type="application/ld+json">{"@type":"Product","name":"X","sku":"-","mpn":"N/A"}</script>';
    const r = new ProductImporter({ fetcher: async () => html }).importHtml(html, 'https://x.example.com/p/1');
    expect(r.product.model).toBeUndefined();
  });
});
