/**
 * npm run extract:metadata -- page.html [--url=https://…]
 *
 * Parses a saved product page (no network) and prints what each parser found. Useful to debug a page
 * that imports badly, and for the "Save as… → HTML only" route when a site blocks automated access.
 */
import { readFileSync } from 'node:fs';
import { ProductImporter } from '../../src/import/ProductImporter';
import { c, parseArgs } from '../lib/node';

const args = parseArgs(process.argv.slice(2));
const file = typeof args['_'] === 'string' ? (args['_'] as string) : undefined;
if (!file) {
  console.error('Usage: npm run extract:metadata -- page.html [--url=https://…]');
  process.exit(2);
}
const url = typeof args['url'] === 'string' ? (args['url'] as string) : 'https://local.invalid/page';
const r = new ProductImporter({ fetcher: async () => '' }).importHtml(readFileSync(file as string, 'utf8'), url);
const p = r.product;
console.log(JSON.stringify({ parsers: r.parsersUsed, name: p.name, brand: p.brand, model: p.model, price: p.price, dimensions: p.dimensions, weight: p.weight, layout: p.layoutHint, keyCount: p.keyCount, material: p.material, specs: p.specs, warnings: p.warnings, fieldSources: p.fieldSources }, null, 2));
console.log('\n' + r.checklist.map((i) => (i.status === 'ok' ? c.ok(i.label) : i.status === 'missing' ? c.fail(i.label) : c.unk(i.label))).join('\n'));
