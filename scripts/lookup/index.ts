/**
 * npm run lookup -- --q="madlions mad60he" [options]
 *
 * Searches many shops (data/sources.json) through their public, robots.txt-permitted
 * endpoints, imports each matching product page, and cross-checks the numbers.
 *
 *   --q="…"            what to look for (required)
 *   --edition=v2       show this edition when the sources describe several (default: the best supported)
 *   --sites=a,b        only these registry ids (default: all)
 *   --urls=u1,u2       extra product pages to include (Amazon, brand pages …); marketplaces weigh less
 *   --max=2            product pages imported per site (default 2)
 *   --min=0.6          minimum title relevance 0..1 (default 0.6)
 *   --json=file.json   write the full result (consumed by the web app: Import → Cross-check)
 *   --add              create a keyboard record from the reconciled values (needs width and depth)
 *   --layout="65%"     override the layout when adding
 *   --keycaps-photo=img|url  with --add: measure the keycap colour on a photo that shows the keycaps
 *   --top=img|url      with --add: reconstruct the REAL outline from a top-view photo (png/jpg/webp), calibrated by the
 *                      reconciled width and checked against the depth; --calibrate-both uses width AND depth,
 *                      --trim-protrusions=2 drops strap mounts/hooks, --remove-thin=8 drops thin tabs
 *
 * Politeness: honest User-Agent, robots.txt checked before every URL, ~1 request/second per site,
 * no retries on blocks. Blocked pages are reported, never worked around.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildDraft } from '../../src/import/DraftBuilder';
import { ReconstructionRejected, reconstructShape, type ReconstructResult } from '../../src/import/ShapeReconstructor';
import { lookup, type LookupDeps } from '../../src/import/lookup';
import { deriveBrandModel } from '../../src/import/naming';
import { ProductImporter } from '../../src/import/ProductImporter';
import { isAllowed, parseRobots } from '../../src/import/robots';
import type { SiteDef } from '../../src/import/siteSearch';
import { ImportFetchError } from '../../src/import/types';
import type { Case, Keyboard, LayoutName } from '../../src/types/keyboard';
import { c, dataDir, decodeImageAsync, downloadImage, nodeFetcher, parseArgs, readJsonArray, USER_AGENT, writeJsonArray } from '../lib/node';
import { validateDatabase } from '../validate-data/validate';

const args = parseArgs(process.argv.slice(2));
const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined);
const query = str('q') ?? (typeof args['_'] === 'string' ? (args['_'] as string) : undefined);
if (!query) {
  console.error('Usage: npm run lookup -- --q="madlions mad60he" [--sites=keychron,mkb] [--json=out.json] [--add]');
  process.exit(2);
}

const registry = JSON.parse(readFileSync(dataDir('sources.json'), 'utf8')) as SiteDef[];
const wanted = str('sites')?.split(',').map((s) => s.trim());
const sites = (wanted ? registry.filter((s) => wanted.includes(s.id)) : registry).filter((s) => s.platform !== 'none');

/* ---- polite network layer ------------------------------------------------ */
const lastHit = new Map<string, number>();
async function throttle(url: string, gapMs = 1000): Promise<void> {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + gapMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

const robotsCache = new Map<string, ReturnType<typeof parseRobots> | null>();
async function robotsFor(origin: string) {
  if (robotsCache.has(origin)) return robotsCache.get(origin) ?? null;
  let rules: ReturnType<typeof parseRobots> | null = null;
  try {
    await throttle(origin);
    const r = await fetch(`${origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    rules = r.status === 200 ? parseRobots(await r.text(), 'KeyboardShapesBot') : [];
  } catch {
    rules = null; // unreadable → treated as "not allowed" for anything but the product page itself? no: be conservative
  }
  robotsCache.set(origin, rules);
  return rules;
}

const deps: LookupDeps = {
  async getJson(url) {
    await throttle(url);
    const r = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (r.status !== 200) throw new Error(`HTTP ${r.status} for ${new URL(url).pathname}`);
    if (!/json/i.test(r.headers.get('content-type') ?? '')) throw new Error('answer is not JSON');
    return r.json();
  },
  async robotsAllows(url) {
    const rules = await robotsFor(new URL(url).origin);
    return rules !== null && isAllowed(rules, url);
  },
  async pause() {
    await new Promise((r) => setTimeout(r, 1000));
  },
  async importUrl(url) {
    const importer = new ProductImporter({
      fetcher: async (u) => {
        await throttle(u);
        return nodeFetcher(u);
      },
      robotsFetch: async (u) => {
        const r = await fetch(u, { headers: { 'user-agent': USER_AGENT } });
        return { status: r.status, text: await r.text() };
      },
      userAgent: 'KeyboardShapesBot',
    });
    return importer.import(url);
  },
};

/* ---- run ------------------------------------------------------------------ */
console.log(c.bold(`\nLookup: “${query}”`) + c.dim(`  (${sites.length} site${sites.length === 1 ? '' : 's'}, ≤ ${str('max') ?? 2} page(s) each)\n`));

const MARKETPLACES = ['amazon.', 'aliexpress.', 'ebay.', 'mercadolivre.', 'shopee.', 'walmart.'];
const extraUrls = (str('urls')?.split(',') ?? [])
  .map((u) => u.trim())
  .filter(Boolean)
  .map((url) => {
    const host = new URL(url).host.replace(/^www\./, '');
    const known = registry.find((r) => host === r.host || host.endsWith('.' + r.host));
    const role = known?.role ?? (MARKETPLACES.some((m) => host.includes(m)) ? 'marketplace' : 'vendor');
    return { url, name: known?.name ?? host, role: role as 'manufacturer' | 'vendor' | 'marketplace' };
  });

const result = await lookup(query, sites, deps, {
  extraUrls,
  maxPerSite: Number(str('max') ?? 2),
  edition: str('edition') === undefined ? undefined : (str('edition') as string).toLowerCase() === 'standard' ? '' : (str('edition') as string).toLowerCase(),
  minRelevance: Number(str('min') ?? 0.6),
  concurrency: 4,
});

for (const s of result.sites) {
  const head = `${s.site.name.padEnd(24)} ${c.dim(s.via)}`;
  if (s.status === 'denied') console.log(c.unk(`${head} — robots.txt disallows search`));
  else if (s.status === 'error') console.log(c.fail(`${head} — ${s.message}`));
  else if (s.status === 'no-match') console.log(c.unk(`${head} — no product matches`));
  else console.log(c.ok(`${head} — ${s.considered} hit(s)`));
  let skipped = 0;
  for (const i of s.imports) {
    if (i.status === 'skipped-low-relevance') {
      skipped++;
      continue;
    }
    const tag = `${Math.round(i.relevance * 100)}%`.padStart(4);
    if (i.status === 'ok') {
      const d = i.product?.dimensions;
      const dims = d?.width?.value ? `${d.width.value} × ${d.depth?.value ?? '?'}${d.height?.value ? ` × ${d.height.value}` : ''} mm` : 'no dimensions';
      console.log(`    ${c.ok(`${tag} ${i.title.slice(0, 54)}`)} ${c.dim(dims)}`);
    } else if (i.status === 'blocked') console.log(`    ${c.fail(`${tag} ${i.title.slice(0, 54)}`)} ${c.dim('blocked — not bypassed')}`);
    else console.log(`    ${c.warn(`${tag} ${i.title.slice(0, 54)} — ${i.error}`)}`);
  }
  if (skipped) console.log(c.dim(`    (${skipped} other result(s) skipped: title does not match the query)`));
}

const r = result.reconciled;
console.log('\n' + c.bold(`Reconciled${r.edition ? ` — edition “${r.edition}”` : ''}`));
if (r.editions.length > 1) {
  console.log(c.dim('editions found:'));
  for (const e of r.editions) {
    console.log(c.dim(`  ${e.key === r.edition ? '▸' : ' '} ${e.label.padEnd(10)} ${e.width ? `${e.width} × ${e.depth ?? '?'} mm` : 'no dimensions'}  ${e.official ? '(official)' : ''}  ${e.sites.join(', ')}`));
  }
}
const line = (label: string, x?: { value: number | string; confidence: number; level: string; supporters: unknown[]; conflicts: unknown[]; note?: string }, unit = '') => {
  if (!x) return console.log(c.unk(`${label.padEnd(8)} unknown`));
  const txt = `${label.padEnd(8)} ${String(x.value)}${unit}  ${c.dim(`${x.level} · confidence ${Math.round(x.confidence * 100)}% · ${x.supporters.length} source(s) agree${x.conflicts.length ? `, ${x.conflicts.length} disagree` : ''}`)}`;
  console.log(x.conflicts.length ? c.warn(txt) : c.ok(txt));
  if (x.note) console.log(c.dim(`           ${x.note}`));
};
line('width', r.width, ' mm');
line('depth', r.depth, ' mm');
line('height', r.height, ' mm');
line('front h.', r.frontHeight, ' mm');
line('rear h.', r.rearHeight, ' mm');
if (r.angleDeg !== undefined) console.log(c.ok(`angle    ${r.angleDeg}°  ${c.dim('derived from front/rear height and depth')}`));
line('layout', r.layout);
line('weight', r.weightG, ' g');
console.log(c.dim(`contributors: ${r.contributors} · overall agreement: ${r.agreement === null ? 'n/a (single source per field)' : `${Math.round(r.agreement * 100)}%`}`));
for (const w of r.warnings) console.log(c.warn(w));

if (str('json')) {
  writeFileSync(str('json') as string, JSON.stringify(result, null, 1));
  console.log(c.dim(`\nfull result → ${str('json')}`));
}

if (args['add']) {
  const layout = (str('layout') ?? r.layout?.value) as LayoutName | undefined;
  if (!r.width || !r.depth || !layout) {
    console.log('\n' + c.warn('--add needs a reconciled width, depth and a layout (use --layout=…). Nothing written.'));
    process.exit(0);
  }
  const { brand, model } = deriveBrandModel({ name: r.name, brand: r.brand, url: r.sources[0]?.sourceUrl ?? '' });
  const keyboards = readJsonArray<Keyboard>(dataDir('keyboards.json'));
  const cases = readJsonArray<Case>(dataDir('cases.json'));
  // optional: reconstruct the real outline from a product photo (top view), calibrated and cross-checked with the reconciled size
  let shape: ReconstructResult | undefined;
  if (str('top')) {
    const src = str('top') as string;
    try {
      const data = await decodeImageAsync(/^https?:/i.test(src) ? (await downloadImage(src)).buf : readFileSync(src));
      const both = !!args['calibrate-both'];
      shape = reconstructShape(data, {
        knownWidthMm: r.width.value,
        knownDepthMm: both ? r.depth.value : undefined,
        expectedDepthMm: both ? undefined : r.depth.value,
        removeThinFeaturesMm: str('remove-thin') ? Number(str('remove-thin')) : undefined,
        trimProtrusionsMm: str('trim-protrusions') ? Number(str('trim-protrusions')) : undefined,
      });
      console.log('\n' + c.bold('Outline from photo') + c.dim(` (${src.slice(0, 80)})`));
      shape.steps.forEach((s) => console.log(c.ok(s)));
      shape.warnings.forEach((s) => console.log(c.warn(s)));
    } catch (e) {
      console.log('\n' + (e instanceof ReconstructionRejected ? c.fail(e.message) : c.warn(`outline not reconstructed: ${e instanceof Error ? e.message : String(e)}`)));
    }
  }
  // optional: keycap colour from a photo that shows the keycaps (same calibration; only the colour is used)
  let keycapColor: string | undefined;
  if (str('keycaps-photo')) {
    const src = str('keycaps-photo') as string;
    try {
      const data = await decodeImageAsync(/^https?:/i.test(src) ? (await downloadImage(src)).buf : readFileSync(src));
      const k = reconstructShape(data, { knownWidthMm: r.width.value, trimProtrusionsMm: str('trim-protrusions') ? Number(str('trim-protrusions')) : undefined });
      keycapColor = k.interiorColor ?? undefined;
      console.log('\n' + c.ok(`keycap colour measured on ${src.slice(0, 70)}…: ${keycapColor ?? 'not measurable'}`));
    } catch (e) {
      console.log('\n' + c.warn(`keycap colour not measured: ${e instanceof Error ? e.message : String(e)}`));
    }
  }
  const draft = buildDraft({
    brand,
    model,
    layout,
    keycapColor,
    shape: shape?.shape,
    attachments: shape?.attachments,
    shapeConfidence: shape?.confidence,
    caseColor: shape?.rimColor ?? undefined,
    widthMm: r.width.value,
    depthMm: r.depth.value,
    heightMm: r.height?.value,
    frontHeightMm: r.frontHeight?.value,
    rearHeightMm: r.rearHeight?.value,
    sources: [
      ...r.sources,
      ...(shape ? [{ sourceName: 'KeyboardShapes shape reconstructor', sourceUrl: str('top')?.startsWith('http') ? str('top') : undefined, sourceType: 'photo-reconstruction' as const, retrievedAt: new Date().toISOString(), method: shape.steps.join(' → '), confidence: shape.confidence.score }] : []),
    ],
    imageUrls: r.images.slice(0, 8).map((i) => i.url),
    existingSlugs: new Set(keyboards.map((k) => k.slug)),
  });
  // cross-checked, official dimensions earn a higher score for the dimensions — the *outline* stays estimated
  draft.keyboard.confidence.notes = `${draft.keyboard.confidence.notes ?? ''} Overall dimensions cross-checked across ${r.contributors} source(s) (width ${Math.round(r.width.confidence * 100)}% confidence, ${r.width.level}).`.trim();
  draft.case.confidence.notes = draft.keyboard.confidence.notes;
  const problems = validateDatabase({ keyboards: [...keyboards, draft.keyboard], cases: [...cases, draft.case] }).filter((p) => p.level === 'error' && (p.id === draft.keyboard.id || p.id === draft.case.id));
  if (problems.length) {
    problems.forEach((p) => console.log(c.fail(`${p.id}: ${p.message}`)));
    process.exit(1);
  }
  writeJsonArray(dataDir('keyboards.json'), [...keyboards, draft.keyboard]);
  writeJsonArray(dataDir('cases.json'), [...cases, draft.case]);
  console.log('\n' + c.ok(`added ${draft.keyboard.id} (${brand} ${model}, ${layout}) to data/`));
}

void ImportFetchError;
