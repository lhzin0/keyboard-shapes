/**
 * npm run keyboard:add -- --brand=Acme --model="Forge 65" --layout="65%" --width=325 --depth=115 [--height=35] [--angle=6]
 * npm run component:add -- --type=pcb --file=my-pcb.json
 *
 * keyboard:add  creates a keyboard + case record from numbers you measured or read, marked with the source you give
 *               (--source=measured|manufacturer|estimated, --source-url=…).
 * component:add appends a component JSON (case | pcb | plate | daughterboard | switch | keycap | stabilizer | foam) to the
 *               matching data file after validating it. The file must be a complete record following src/types/keyboard.ts.
 */
import { readFileSync } from 'node:fs';
import { buildDraft } from '../../src/import/DraftBuilder';
import type { LayoutName, PrecisionLevel, SourceInfo, SourceType } from '../../src/types/keyboard';
import { c, dataDir, parseArgs, readJsonArray, writeJsonArray } from '../lib/node';
import { validateDatabase, type DatabaseLike } from '../validate-data/validate';

const [mode, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined);
const num = (k: string) => (str(k) !== undefined ? Number(str(k)?.replace(',', '.')) : undefined);

const FILES: Record<string, string> = {
  case: 'cases.json',
  pcb: 'pcbs.json',
  plate: 'plates.json',
  daughterboard: 'daughterboards.json',
  switch: 'switches.json',
  keycap: 'keycaps.json',
  stabilizer: 'stabilizers.json',
  foam: 'foams.json',
};
const KEY_OF: Record<string, keyof DatabaseLike> = { case: 'cases', pcb: 'pcbs', plate: 'plates', daughterboard: 'daughterboards', switch: 'switches', keycap: 'keycaps', stabilizer: 'stabilizers', foam: 'foams' };

function fail(msg: string): never {
  console.error(c.fail(msg));
  process.exit(1);
}

if (mode === 'keyboard') {
  const brand = str('brand');
  const model = str('model');
  const layout = str('layout') as LayoutName | undefined;
  const width = num('width');
  const depth = num('depth');
  if (!brand || !model || !layout || !width || !depth) fail('Required: --brand --model --layout --width --depth (mm)');
  const sourceType = (str('source') ?? 'user-measurement') as SourceType;
  const source: SourceInfo = {
    sourceName: str('source-name') ?? 'Entered with keyboard:add',
    sourceUrl: str('source-url'),
    sourceType: sourceType === ('measured' as string) ? 'user-measurement' : sourceType,
    retrievedAt: new Date().toISOString(),
    method: str('method') ?? 'entered manually',
    confidence: num('confidence') ?? (sourceType === 'manufacturer' ? 0.95 : 0.6),
  };
  const keyboards = readJsonArray<import('../../src/types/keyboard').Keyboard>(dataDir('keyboards.json'));
  const cases = readJsonArray<import('../../src/types/keyboard').Case>(dataDir('cases.json'));
  const angle = num('angle');
  const height = num('height');
  const draft = buildDraft({
    brand: brand as string,
    model: model as string,
    layout: layout as LayoutName,
    widthMm: width as number,
    depthMm: depth as number,
    heightMm: height,
    frontHeightMm: num('front-height'),
    rearHeightMm: num('rear-height'),
    sources: [source],
    imageUrls: [],
    existingSlugs: new Set(keyboards.map((k) => k.slug)),
  });
  if (angle !== undefined && draft.case.angle === undefined) draft.case.angle = angle;
  const level: PrecisionLevel = draft.case.confidence.level;
  const problems = validateDatabase({ keyboards: [...keyboards, draft.keyboard], cases: [...cases, draft.case] }).filter((p) => p.level === 'error' && [draft.keyboard.id, draft.case.id].includes(p.id));
  if (problems.length) {
    problems.forEach((p) => console.error(c.fail(`${p.id}: ${p.message}`)));
    process.exit(1);
  }
  writeJsonArray(dataDir('keyboards.json'), [...keyboards, draft.keyboard]);
  writeJsonArray(dataDir('cases.json'), [...cases, draft.case]);
  draft.warnings.forEach((w) => console.log(c.warn(w)));
  console.log(c.ok(`added ${draft.keyboard.id} (outline precision: ${level})`));
} else if (mode === 'component') {
  const type = str('type');
  const file = str('file');
  if (!type || !FILES[type] || !file) fail(`Usage: component:add --type=${Object.keys(FILES).join('|')} --file=record.json`);
  const record = JSON.parse(readFileSync(file as string, 'utf8')) as { id?: string; slug?: string };
  if (!record.id) fail('The record needs an "id".');
  const target = dataDir(FILES[type as string] as string);
  const list = readJsonArray<{ id: string; slug?: string }>(target);
  if (list.some((x) => x.id === record.id)) fail(`${record.id} already exists in ${FILES[type as string]}`);
  const db: DatabaseLike = {};
  (db as Record<string, unknown>)[KEY_OF[type as string] as string] = [...list, record];
  const problems = validateDatabase(db).filter((p) => p.level === 'error' && p.id === record.id);
  if (problems.length) {
    problems.forEach((p) => console.error(c.fail(`${p.id}: ${p.message}`)));
    process.exit(1);
  }
  writeJsonArray(target, [...list, record]);
  console.log(c.ok(`added ${record.id} to ${FILES[type as string]}`));
} else {
  fail('Usage: keyboard:add | component:add (see the header of scripts/add-entity/index.ts)');
}
