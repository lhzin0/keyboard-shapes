/**
 * npm run extract:images -- page.html [--url=https://…] [--all]
 *
 * Lists the images of a saved product page with their classification, origin (structured data / og:image /
 * markup) and whether the importer would use them automatically.
 */
import { readFileSync } from 'node:fs';
import { extractImages, isAutoPickable, tokenize } from '../../src/import/ImageExtractor';
import { ProductImporter } from '../../src/import/ProductImporter';
import { c, parseArgs } from '../lib/node';

const args = parseArgs(process.argv.slice(2));
const file = typeof args['_'] === 'string' ? (args['_'] as string) : undefined;
if (!file) {
  console.error('Usage: npm run extract:images -- page.html [--url=https://…] [--all]');
  process.exit(2);
}
const url = typeof args['url'] === 'string' ? (args['url'] as string) : 'https://local.invalid/page';
const html = readFileSync(file as string, 'utf8');
const product = new ProductImporter({ fetcher: async () => '' }).importHtml(html, url).product;
const tokens = tokenize(`${product.brand ?? ''} ${product.name ?? ''}`);
const images = extractImages(html, url);
const shown = args['all'] ? images : images.slice(0, 25);
for (const i of shown) {
  const auto = isAutoPickable(i, ['TOP', 'BLUEPRINT', 'SIDE'], tokens);
  console.log(`${auto ? c.ok('auto ') : '      '}${i.type.padEnd(9)} ${String(Math.round(i.typeConfidence * 100)).padStart(3)}%  ${i.origin.padEnd(10)} ${c.dim(i.url.slice(0, 100))}`);
}
console.log(c.dim(`\n${images.length} image(s)${args['all'] ? '' : ` (first ${shown.length}; --all for the rest)`} — "auto" = would be used without being chosen`));
