/**
 * npm run import -- --url="https://example.com/product" [options]
 *
 * Pipeline: URL → robots.txt → fetch → parsers → metadata → images → dimensions → layout →
 *           (optional) shape/profile reconstruction → draft records → validation → data/*.json
 *
 *   --url=…              product page (required unless --html)
 *   --html=file.html     parse a saved page instead of fetching (use with --url for relative links)
 *   --brand= --model=    override
 *   --layout="65%"       override the detected layout
 *   --width= --depth= --height=   override/provide dimensions in mm
 *   --top=path|url       image used for the outline (otherwise the best TOP/BLUEPRINT candidate is tried)
 *   --side=path|url      image used for the side profile
 *   --front=left|right   which edge of the side image is the front (default left)
 *   --dry-run            print the report, write nothing
 *
 * Nothing here bypasses protections: challenge pages, CAPTCHAs, logins, rate limits and
 * robots.txt are reported and the import stops.
 */
import { existsSync, readFileSync } from 'node:fs';
import { LAYOUT_BUILDERS } from '../../src/geometry/layouts';
import { isAutoPickable, tokenize } from '../../src/import/ImageExtractor';
import { deriveBrandModel } from '../../src/import/naming';
import { buildDraft } from '../../src/import/DraftBuilder';
import { detectLayoutFromText } from '../../src/import/LayoutDetector';
import { ProductImporter } from '../../src/import/ProductImporter';
import { ReconstructionRejected, holesToMountingPoints, reconstructProfile, reconstructShape, type ProfileResult, type ReconstructResult } from '../../src/import/ShapeReconstructor';
import { ImportFetchError, type ImageType } from '../../src/import/types';
import type { Case, Keyboard, LayoutName, SourceInfo } from '../../src/types/keyboard';
import { c, dataDir, decodeImageAsync, downloadImage, nodeFetcher, parseArgs, readJsonArray, robotsAllows, USER_AGENT, writeCache, writeJsonArray } from '../lib/node';
import { validateDatabase } from '../validate-data/validate';

const args = parseArgs(process.argv.slice(2));
const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined);
const num = (k: string) => (str(k) !== undefined ? Number(str(k)?.replace(',', '.')) : undefined);

async function loadImage(src: string) {
  if (/^https?:/i.test(src)) return decodeImageAsync((await downloadImage(src)).buf);
  return decodeImageAsync(readFileSync(src));
}

async function main() {
  const url = str('url');
  const htmlFile = str('html');
  if (!url && !htmlFile) {
    console.error('Usage: npm run import -- --url="https://…" [--width=327 --layout="65%" --top=img.png --dry-run]');
    process.exit(2);
  }

  const importer = new ProductImporter({
    fetcher: nodeFetcher,
    robotsFetch: async (u) => {
      const r = await fetch(u, { headers: { 'user-agent': USER_AGENT } });
      return { status: r.status, text: await r.text() };
    },
    userAgent: 'KeyboardShapesBot',
  });

  console.log(c.bold(`\nKeyboardShapes import`));
  let result;
  try {
    if (htmlFile) {
      const html = readFileSync(htmlFile, 'utf8');
      result = importer.importHtml(html, url ? importer.normalizeUrl(url) : 'https://local.invalid/');
      console.log(c.dim(`parsed ${htmlFile}`));
    } else {
      const norm = importer.normalizeUrl(url as string);
      console.log(c.dim(norm));
      const robots = await robotsAllows(norm);
      console.log(robots.checked ? (robots.allowed ? c.ok('robots.txt allows this page') : c.fail('robots.txt disallows this page')) : c.warn(`robots.txt not checked (${robots.reason})`));
      result = await importer.import(norm);
      writeCache(norm, JSON.stringify(result.product, null, 1));
    }
  } catch (e) {
    if (e instanceof ImportFetchError) {
      console.error(c.fail(`${e.reason}: ${e.message}`));
      if (e.reason === 'blocked' || e.reason === 'robots-disallowed') {
        console.error('This site does not want to be read automatically, and we will not try to get around that.');
        console.error('Alternatives: save the page from your browser (“Save as…”, HTML only) and run again with --html=page.html,');
        console.error('or open the web app → Import → “Paste page HTML” / “Manual / images”.');
      }
      process.exit(1);
    }
    throw e;
  }

  const p = result.product;
  console.log('\n' + c.bold('Found'));
  for (const item of result.checklist) {
    const line = `${item.label.padEnd(18)} ${item.detail ? c.dim(item.detail.slice(0, 80)) : ''}`;
    console.log(item.status === 'ok' ? c.ok(line) : item.status === 'missing' ? c.fail(line) : c.unk(line));
  }
  for (const w of p.warnings) console.log(c.warn(w));
  console.log(c.dim(`parsers: ${result.parsersUsed.join(', ')} · images: ${p.images.length}`));

  // ---- details
  const derived = deriveBrandModel(p);
  const brand = str('brand') ?? derived.brand;
  const model = str('model') ?? derived.model;
  derived.notes.forEach((n) => console.log(c.warn(n)));
  const layoutDet = str('layout') ? { layout: str('layout') as LayoutName, confidence: 1, reasons: ['given on the command line'] } : (p.layoutHint ?? detectLayoutFromText(`${p.name ?? ''} ${p.description ?? ''}`));
  const layout: LayoutName = (layoutDet.layout ?? 'Custom') as LayoutName;
  const width = num('width') ?? p.dimensions?.width?.value ?? undefined;
  const depth = num('depth') ?? p.dimensions?.depth?.value ?? undefined;
  const height = num('height') ?? p.dimensions?.height?.value ?? undefined;
  console.log(`\n${c.bold('Details')}\n  brand  ${brand || c.dim('(unknown)')}\n  model  ${model || c.dim('(unknown)')}\n  layout ${layout} ${c.dim(`(${Math.round(layoutDet.confidence * 100)}%: ${layoutDet.reasons.join('; ')})`)}${LAYOUT_BUILDERS[layout] ? '' : c.dim(' — no reference key map')}\n  size   ${width ?? '?'} × ${depth ?? '?'} × ${height ?? '?'} mm`);

  // ---- reconstruction
  let shape: ReconstructResult | undefined;
  let profile: ProfileResult | undefined;
  // Only images the page declares as the product's own, with a confident top/blueprint/side name, are used
  // automatically. Anything else must be chosen with --top / --side: a wrong picture gives a confidently wrong outline.
  const productTokens = tokenize(`${brand} ${model} ${p.name ?? ''}`);
  const auto = (types: ImageType[]) => p.images.find((i) => isAutoPickable(i, types, productTokens))?.url;
  const topCandidate = str('top') ?? auto(['TOP', 'BLUEPRINT']);
  const sideCandidate = str('side') ?? auto(['SIDE']);
  if (!str('top') && !topCandidate && p.images.length) console.log(c.unk(`${p.images.length} images found, none is confidently a top view of this product — pass --top=<url|file> to reconstruct the outline`));
  if (topCandidate && width) {
    try {
      shape = reconstructShape(await loadImage(topCandidate), { knownWidthMm: width, knownDepthMm: undefined, expectedDepthMm: depth, removeThinFeaturesMm: num('remove-thin'), trimProtrusionsMm: num('trim-protrusions') });
      console.log('\n' + c.bold('Outline reconstruction') + c.dim(` (${topCandidate})`));
      shape.steps.forEach((s) => console.log(c.ok(s)));
      shape.warnings.forEach((s) => console.log(c.warn(s)));
      console.log(`  → ${shape.shape.width.toFixed(1)} × ${shape.shape.depth.toFixed(1)} mm, confidence ${Math.round(shape.confidence.score * 100)}% (${shape.confidence.level})`);
    } catch (e) {
      console.log(e instanceof ReconstructionRejected ? c.fail(e.message) : c.warn(`outline not reconstructed: ${e instanceof Error ? e.message : String(e)}`));
    }
  } else if (!topCandidate) {
    console.log(c.unk('no TOP/BLUEPRINT image: outline will be an assumed rounded rectangle'));
  } else {
    console.log(c.unk('no width known: pass --width=<mm> to calibrate the image'));
  }
  const depthForSide = depth ?? shape?.shape.depth;
  if (sideCandidate && depthForSide) {
    try {
      profile = reconstructProfile(await loadImage(sideCandidate), { knownDepthMm: depthForSide, frontSide: str('front') === 'right' ? 'right' : 'left' });
      console.log(c.ok(`side profile: front ${profile.profile.frontHeight} mm, rear ${profile.profile.rearHeight} mm, ${profile.profile.angle}°`));
    } catch (e) {
      console.log(e instanceof ReconstructionRejected ? c.fail(e.message) : c.warn(`side profile not reconstructed: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  if (!brand || !model || (!width && !shape) || (!depth && !shape)) {
    console.log('\n' + c.warn('Not enough information to create records. Provide --brand, --model, --width and --depth (or an image with --width).'));
    process.exit(0);
  }

  const now = new Date().toISOString();
  const sources: SourceInfo[] = [
    ...p.sources,
    ...(shape ? [{ sourceName: 'KeyboardShapes shape reconstructor', sourceType: 'photo-reconstruction' as const, retrievedAt: now, method: shape.steps.join(' → '), confidence: shape.confidence.score }] : []),
  ];
  const keyboards = readJsonArray<Keyboard>(dataDir('keyboards.json'));
  const cases = readJsonArray<Case>(dataDir('cases.json'));
  const draft = buildDraft({
    brand,
    model,
    layout,
    widthMm: width ?? 0,
    depthMm: depth ?? 0,
    heightMm: height,
    frontHeightMm: p.dimensions?.frontHeight?.value ?? undefined,
    rearHeightMm: p.dimensions?.rearHeight?.value ?? undefined,
    shape: shape?.shape,
    shapeConfidence: shape?.confidence,
    holes: shape ? holesToMountingPoints(shape.holes, 'ph') : undefined,
    profile: profile?.profile,
    sources,
    imageUrls: p.images.slice(0, 8).map((i) => i.url),
    existingSlugs: new Set(keyboards.map((k) => k.slug)),
  });
  draft.warnings.forEach((w) => console.log(c.warn(w)));

  const problems = validateDatabase({ keyboards: [...keyboards, draft.keyboard], cases: [...cases, draft.case] });
  const blocking = problems.filter((x) => x.level === 'error' && (x.id === draft.keyboard.id || x.id === draft.case.id));
  if (blocking.length) {
    blocking.forEach((x) => console.log(c.fail(`${x.id}: ${x.message}`)));
    process.exit(1);
  }
  console.log(c.ok('validation passed'));

  if (args['dry-run']) {
    console.log(c.dim('\n--dry-run: nothing written.'));
    return;
  }
  writeJsonArray(dataDir('keyboards.json'), [...keyboards, draft.keyboard]);
  writeJsonArray(dataDir('cases.json'), [...cases, draft.case]);
  console.log(`\n${c.ok(`added ${draft.keyboard.id} to data/keyboards.json and data/cases.json`)}`);
  console.log(c.dim(`precision: ${draft.case.confidence.level} (${Math.round(draft.case.confidence.score * 100)}%) — open /keyboard/${draft.keyboard.slug}`));
}

void existsSync;
main().catch((e) => {
  console.error(c.fail(e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exit(1);
});
