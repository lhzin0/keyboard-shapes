/**
 * npm run generate (second half)
 *
 * Derives, from data/*.json, the files other tools consume:
 *   geometry/outlines/<id>.json    outline (+ cavity) of every case, PCB, plate, daughterboard
 *   geometry/mounting/<id>.json    mounting points
 *   geometry/profiles/<slug>.json  side profile of every keyboard / case
 *   geometry/generated/<slug>.svg  top-view preview in millimetres (1 SVG unit = 1 mm)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { caseProfile } from '../../src/geometry/reference';
import { boundsOf } from '../../src/geometry/shape';
import { KEY_PITCH_MM } from '../../src/geometry/layouts';
import { resolvePlacements } from '../../src/geometry/placement';
import { db, resolveKeyboard } from '../../src/services/database';
import type { Point2D } from '../../src/types/keyboard';
import { c, root } from '../lib/node';

const dirs = ['outlines', 'mounting', 'profiles', 'generated'].map((d) => {
  mkdirSync(`${root}geometry/${d}`, { recursive: true });
  return `${root}geometry/${d}/`;
}) as [string, string, string, string];
const [outlines, mounting, profiles, generated] = dirs;

const json = (path: string, v: unknown) => writeFileSync(path, JSON.stringify(v, null, 1) + '\n');
let files = 0;

for (const x of db.cases) {
  json(`${outlines}${x.id}.json`, { id: x.id, unit: 'mm', external: x.externalShape, cavity: x.internalCavity ?? null });
  json(`${mounting}${x.id}.json`, { id: x.id, unit: 'mm', posts: x.mountingPoints, cutouts: x.cutouts, daughterboardArea: x.daughterboardArea ?? null });
  json(`${profiles}${x.slug}.json`, caseProfile(x));
  files += 3;
}
for (const x of [...db.pcbs, ...db.plates, ...db.daughterboards]) {
  json(`${outlines}${x.id}.json`, { id: x.id, unit: 'mm', outline: x.outline });
  json(`${mounting}${x.id}.json`, { id: x.id, unit: 'mm', points: x.mountingPoints });
  files += 2;
}

const path = (pts: Point2D[]) => `M${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}Z`;

for (const kb of db.keyboards) {
  const p = resolveKeyboard(kb);
  if (!p.case) continue;
  const sel = { case: p.case, pcb: p.pcb, plate: p.plate, daughterboard: p.daughterboard, layout: kb.layout };
  const r = resolvePlacements(sel);
  const b = boundsOf(p.case.externalShape.points);
  const pad = 6;
  const keys = kb.layout.keys
    .map((k, i) => {
      const ctr = r.centers[i];
      if (!ctr) return '';
      const w = k.width * KEY_PITCH_MM - 1;
      const h = k.height * KEY_PITCH_MM - 1;
      return `<rect x="${(ctr.x - w / 2).toFixed(2)}" y="${(ctr.y - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="1.6" fill="#e2e8f0" stroke="#94a3b8" stroke-width=".4"/>`;
    })
    .join('');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}" width="${(b.maxX - b.minX + 2 * pad).toFixed(1)}mm" height="${(b.maxY - b.minY + 2 * pad).toFixed(1)}mm">`,
    `<title>${kb.brand} ${kb.model} — top view, 1 unit = 1 mm (${kb.confidence.level})</title>`,
    `<path d="${path(p.case.externalShape.points)}" fill="#cbd5e1" stroke="#475569" stroke-width=".8"/>`,
    p.case.internalCavity ? `<path d="${path(p.case.internalCavity.points)}" fill="#f8fafc" stroke="#94a3b8" stroke-width=".4" stroke-dasharray="2 1"/>` : '',
    keys,
    `</svg>`,
  ].join('\n');
  writeFileSync(`${generated}${kb.slug}.svg`, svg);
  json(`${profiles}${kb.slug}.json`, kb.profile ?? caseProfile(p.case));
  files += 2;
}
console.log(c.ok(`geometry/: ${files} file(s) written`));
