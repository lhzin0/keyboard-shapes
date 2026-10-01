/**
 * Regenerates data/*.json from the parametric reference builders.
 * Run with: npm run generate
 *
 * Only the reference ("ref-*") records are rewritten; records added through
 * `npm run import`, `keyboard:add` or `component:add` are preserved.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildReferenceDatabase, REFERENCE_SOURCE } from '../../src/geometry/reference';
import type { CompatibilityRelation } from '../../src/types/keyboard';

const dataDir = new URL('../../data/', import.meta.url);
const file = (name: string) => fileURLToPath(new URL(name, dataDir));

function readJson<T>(name: string): T[] {
  const p = file(name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T[]) : [];
}

function merge<T extends { id: string }>(name: string, generated: T[]): void {
  const kept = readJson<T>(name).filter((x) => !x.id.startsWith('ref-'));
  const all = [...generated, ...kept];
  writeFileSync(file(name), JSON.stringify(all, null, 1) + '\n');
  console.log(`  ${name}: ${generated.length} reference + ${kept.length} user records`);
}

const db = buildReferenceDatabase();
console.log('Writing reference data to data/ …');
merge('keyboards.json', db.keyboards);
merge('cases.json', db.cases);
merge('pcbs.json', db.pcbs);
merge('plates.json', db.plates);
merge('switches.json', db.switches);
merge('keycaps.json', db.keycaps);
merge('daughterboards.json', db.daughterboards);
merge('stabilizers.json', db.stabilizers);
merge('foams.json', db.foams);

const relations: CompatibilityRelation[] = [
  {
    from: { type: 'pcb', id: 'ref-65-pcb-b' },
    to: { type: 'case', id: 'ref-65-case-a' },
    kind: 'declared-incompatible',
    source: { ...REFERENCE_SOURCE, method: 'reference dataset: alternate hole pattern by construction', confidence: 1 },
  },
  {
    from: { type: 'plate', id: 'ref-65-plate-b' },
    to: { type: 'pcb', id: 'ref-65-pcb-a' },
    kind: 'declared-incompatible',
    source: { ...REFERENCE_SOURCE, method: 'reference dataset: alternate hole pattern by construction', confidence: 1 },
  },
];
const keptRelations = readJson<CompatibilityRelation>('compatibility.json').filter((r) => !r.from.id.startsWith('ref-'));
writeFileSync(file('compatibility.json'), JSON.stringify([...relations, ...keptRelations], null, 1) + '\n');
console.log(`  compatibility.json: ${relations.length} reference relations`);
