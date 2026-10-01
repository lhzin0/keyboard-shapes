/**
 * npm run optimize
 *
 * Optimises every public/models/*.glb in place with glTF-Transform:
 * dedupe → prune → weld → quantise → (Draco) so models stay small on GitHub Pages and phones.
 * The viewer's GLB loader decodes Draco automatically.
 */
import { readdirSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, draco, prune, quantize, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { c, root } from '../lib/node';

const dir = `${root}public/models/`;
const files = readdirSync(dir).filter((f) => f.endsWith('.glb'));
if (files.length === 0) {
  console.log(c.dim('no models in public/models/ — run npm run generate:models first'));
  process.exit(0);
}

const io = new NodeIO().registerExtensions([KHRDracoMeshCompression, KHRMeshQuantization]).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

for (const f of files) {
  const path = `${dir}${f}`;
  const before = statSync(path).size;
  const doc = await io.read(path);
  await doc.transform(dedup(), prune(), weld(), quantize({ quantizePosition: 14, quantizeNormal: 10 }), draco());
  await io.write(path, doc);
  const after = statSync(path).size;
  console.log(c.ok(`${f}  ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB  ${c.dim(`(${Math.round((1 - after / before) * 100)}% smaller)`)}`));
}
