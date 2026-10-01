/**
 * npm run generate:models [-- --check] [-- --only=reference-65]
 *
 * Builds the parametric 3D model of every keyboard that has a case and writes public/models/<slug>.glb.
 * `--check` regenerates in memory and only verifies that every model file referenced by the data exists
 * and is a valid GLB (used by CI).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { buildAssembly } from '../../src/geometry/3d/KeyboardAssembly';
import { assemblyToGlb } from '../../src/geometry/3d/export';
import { inferLayout } from '../../src/services/layout';
import { db, resolveKeyboard } from '../../src/services/database';
import { c, parseArgs, root } from '../lib/node';

// Node has no FileReader; GLTFExporter uses it to turn Blobs into ArrayBuffers.
class FileReaderShim {
  result: ArrayBuffer | string | null = null;
  onloadend: null | (() => void) = null;
  onerror: null | ((e: unknown) => void) = null;
  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
    }, (e) => this.onerror?.(e));
  }
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
      this.onloadend?.();
    }, (e) => this.onerror?.(e));
  }
}
(globalThis as unknown as { FileReader: unknown }).FileReader ??= FileReaderShim;

const args = parseArgs(process.argv.slice(2));
const outDir = `${root}public/models/`;
mkdirSync(outDir, { recursive: true });

function isGlb(buf: Buffer): boolean {
  return buf.length > 20 && buf.readUInt32LE(0) === 0x46546c67 && buf.readUInt32LE(4) === 2;
}

if (args['check']) {
  let bad = 0;
  for (const kb of db.keyboards) {
    const url = kb.model3d?.url;
    if (!url || /^https?:/.test(url)) continue;
    const p = `${root}public/${url.replace(/^\//, '')}`;
    if (!existsSync(p)) {
      console.log(c.fail(`${kb.id}: ${url} is missing`));
      bad++;
    } else if (!isGlb(readFileSync(p))) {
      console.log(c.fail(`${kb.id}: ${url} is not a valid GLB`));
      bad++;
    }
  }
  console.log(bad ? c.fail(`${bad} model problem(s)`) : c.ok('all referenced models exist and are valid GLB files'));
  process.exit(bad ? 1 : 0);
}

let n = 0;
for (const kb of db.keyboards) {
  if (typeof args['only'] === 'string' && kb.slug !== args['only']) continue;
  const p = resolveKeyboard(kb);
  if (!p.case) continue;
  const layout = kb.layout.keyCount ? kb.layout : inferLayout({ pcb: p.pcb, plate: p.plate, case: p.case });
  const assembly = buildAssembly({ case: p.case, pcb: p.pcb, plate: p.plate, daughterboard: p.daughterboard, switch: p.switch, keycap: p.keycap, foam: p.foam, layout });
  const glb = await assemblyToGlb(assembly, kb.slug);
  const file = `${outDir}${kb.slug}.glb`;
  writeFileSync(file, Buffer.from(glb));
  console.log(c.ok(`${kb.slug}.glb  ${(statSync(file).size / 1024).toFixed(0)} KB  ${c.dim(`${assembly.parts.length} parts, layers: ${assembly.layers.join(', ')}`)}`));
  n++;
}
console.log(c.dim(`${n} model(s) written to public/models/`));
