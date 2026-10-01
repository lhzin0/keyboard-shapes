/**
 * npm run reconstruct:shape -- --image=top.png --width=327 [--depth=145] [--perspective=auto] [--svg=out.svg] [--json=out.json]
 * npm run reconstruct:shape -- --side=side.png --depth=145 [--front=right]
 *
 * Image → millimetre outline (PNG/JPEG). The calibration is mandatory: an image alone has no scale.
 * --depth in outline mode only *verifies* the result (rejects it if it contradicts the published depth).
 * --remove-thin=8        drops attachments thinner than 8 mm (cable tabs) before measuring.
 * --trim-protrusions=2    cuts back short stretches sticking out of the body's straight edge by more than 2 mm
 *                         (strap mounts, hooks) — what a thin-feature filter cannot remove.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ReconstructionRejected, holesToMountingPoints, reconstructProfile, reconstructShape } from '../../src/import/ShapeReconstructor';
import { c, decodeImageAsync, parseArgs } from '../lib/node';

const args = parseArgs(process.argv.slice(2));
const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined);
const num = (k: string) => (str(k) ? Number(str(k)?.replace(',', '.')) : undefined);

try {
  if (str('side')) {
    const depth = num('depth');
    if (!depth) throw new Error('--depth=<mm> is required to calibrate a side image');
    const r = reconstructProfile(await decodeImageAsync(readFileSync(str('side') as string)), { knownDepthMm: depth, frontSide: str('front') === 'right' ? 'right' : 'left' });
    r.steps.forEach((s) => console.log(c.ok(s)));
    r.warnings.forEach((w) => console.log(c.warn(w)));
    console.log(JSON.stringify(r.profile, null, 1));
    if (str('json')) writeFileSync(str('json') as string, JSON.stringify(r.profile, null, 1));
  } else if (str('image')) {
    const width = num('width');
    if (!width) throw new Error('--width=<mm> is required to calibrate the image');
    const r = reconstructShape(await decodeImageAsync(readFileSync(str('image') as string)), {
      removeThinFeaturesMm: num('remove-thin'),
      trimProtrusionsMm: num('trim-protrusions'),
      knownWidthMm: width,
      expectedDepthMm: num('depth'),
      perspective: str('perspective') === 'auto' ? 'auto' : 'none',
    });
    r.steps.forEach((s) => console.log(c.ok(s)));
    r.warnings.forEach((w) => console.log(c.warn(w)));
    console.log(`\n${r.shape.width} × ${r.shape.depth} mm · ${r.shape.points.length} points · ${r.confidence.level} ${Math.round(r.confidence.score * 100)}% · ${r.holes.length} hole(s) → ${holesToMountingPoints(r.holes).length} mounting-point candidate(s)`);
    if (str('json')) writeFileSync(str('json') as string, JSON.stringify({ shape: r.shape, holes: r.holes, confidence: r.confidence }, null, 1));
    if (str('svg')) {
      const d = `M${r.shape.points.map((p) => `${p.x} ${p.y}`).join('L')}Z`;
      writeFileSync(str('svg') as string, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 ${r.shape.width + 10} ${r.shape.depth + 10}" width="${r.shape.width}mm" height="${r.shape.depth}mm"><path d="${d}" fill="#cbd5e1" stroke="#475569" stroke-width=".6"/>${r.holes.map((h) => `<circle cx="${h.x}" cy="${h.y}" r="${h.diameter / 2}" fill="#fff" stroke="#f59e0b" stroke-width=".4"/>`).join('')}</svg>`);
    }
  } else {
    console.error('Usage: reconstruct:shape --image=top.png --width=<mm> | --side=side.png --depth=<mm>');
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof ReconstructionRejected ? c.fail(e.message) : c.fail(e instanceof Error ? e.message : String(e)));
  process.exit(1);
}
