/**
 * npm run validate [-- --links]
 *
 * Checks data/*.json: JSON validity, references, geometry, provenance rules, 3D model files.
 * `--links` additionally HEAD-checks every source URL (network; used by the scheduled workflow).
 */
import { existsSync } from 'node:fs';
import { c, dataDir, parseArgs, root, USER_AGENT } from '../lib/node';
import { validateDatabase, type DatabaseLike, type Problem } from './validate';
import { readFileSync } from 'node:fs';

const args = parseArgs(process.argv.slice(2));

function load<T>(name: string, problems: Problem[]): T[] {
  const p = dataDir(name);
  if (!existsSync(p)) {
    problems.push({ level: 'error', id: name, message: 'file is missing' });
    return [];
  }
  try {
    const v = JSON.parse(readFileSync(p, 'utf8')) as unknown;
    if (!Array.isArray(v)) {
      problems.push({ level: 'error', id: name, message: 'top-level value must be an array' });
      return [];
    }
    return v as T[];
  } catch (e) {
    problems.push({ level: 'error', id: name, message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` });
    return [];
  }
}

async function main() {
  const problems: Problem[] = [];
  const db: DatabaseLike = {
    keyboards: load('keyboards.json', problems),
    cases: load('cases.json', problems),
    pcbs: load('pcbs.json', problems),
    plates: load('plates.json', problems),
    daughterboards: load('daughterboards.json', problems),
    switches: load('switches.json', problems),
    keycaps: load('keycaps.json', problems),
    stabilizers: load('stabilizers.json', problems),
    foams: load('foams.json', problems),
    relations: load('compatibility.json', problems),
  };
  problems.push(...validateDatabase(db));

  // 3D model files must exist
  for (const rec of [...(db.keyboards ?? []), ...(db.cases ?? []), ...(db.pcbs ?? []), ...(db.plates ?? [])]) {
    const m = (rec as { model3d?: { kind: string; url?: string } }).model3d;
    if (m?.url && !/^https?:/.test(m.url) && !existsSync(`${root}public/${m.url.replace(/^\//, '')}`)) {
      problems.push({ level: 'error', id: rec.id, message: `model file "${m.url}" not found under public/` });
    }
  }

  if (args['links']) {
    const urls = new Set<string>();
    for (const rec of [...(db.keyboards ?? []), ...(db.cases ?? [])]) for (const s of rec.sources) if (s.sourceUrl) urls.add(s.sourceUrl);
    for (const u of urls) {
      try {
        const r = await fetch(u, { method: 'HEAD', headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
        if (r.status >= 400 && r.status !== 403 && r.status !== 405 && r.status !== 429) problems.push({ level: 'warning', id: u, message: `link answered HTTP ${r.status}` });
      } catch (e) {
        problems.push({ level: 'warning', id: u, message: `link unreachable: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    console.log(c.dim(`checked ${urls.size} source link(s)`));
  }

  const errors = problems.filter((p) => p.level === 'error');
  const warnings = problems.filter((p) => p.level === 'warning');
  for (const p of errors) console.log(c.fail(`${p.id}: ${p.message}`));
  for (const p of warnings) console.log(c.warn(`${p.id}: ${p.message}`));
  const counts = Object.entries(db).map(([k, v]) => `${k} ${(v as unknown[]).length}`).join(' · ');
  console.log(c.dim(counts));
  console.log(errors.length ? c.fail(`${errors.length} error(s), ${warnings.length} warning(s)`) : c.ok(`valid — ${warnings.length} warning(s)`));
  process.exit(errors.length ? 1 : 0);
}

void main();
