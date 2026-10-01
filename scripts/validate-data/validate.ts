/**
 * Data validation: schema-ish checks + geometry + provenance rules.
 * Pure (no fs): used by `npm run validate`, the import CLI and the tests.
 */
import { containment, boundsOf } from '../../src/geometry/shape';
import type { Case, ConfidenceInfo, Daughterboard, Keyboard, PCB, Plate, Point2D, Shape, SourceInfo } from '../../src/types/keyboard';

export interface Problem {
  level: 'error' | 'warning';
  /** Record id (or file) the problem belongs to. */
  id: string;
  message: string;
}

export interface DatabaseLike {
  keyboards?: Keyboard[];
  cases?: Case[];
  pcbs?: PCB[];
  plates?: Plate[];
  daughterboards?: Daughterboard[];
  switches?: Array<{ id: string; slug: string; confidence: ConfidenceInfo; sources: SourceInfo[] }>;
  keycaps?: Array<{ id: string; slug: string; confidence: ConfidenceInfo; sources: SourceInfo[] }>;
  stabilizers?: Array<{ id: string; slug: string; confidence: ConfidenceInfo; sources: SourceInfo[] }>;
  foams?: Array<{ id: string; slug?: string; confidence: ConfidenceInfo; sources: SourceInfo[] }>;
  relations?: Array<{ from: { type: string; id: string }; to: { type: string; id: string }; kind: string }>;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function validateDatabase(db: DatabaseLike): Problem[] {
  const out: Problem[] = [];
  const err = (id: string, message: string) => out.push({ level: 'error', id, message });
  const warn = (id: string, message: string) => out.push({ level: 'warning', id, message });

  const shape = (id: string, label: string, s: Shape | undefined, expectOrigin: boolean) => {
    if (!s) return;
    if (!Array.isArray(s.points) || s.points.length < 3) return err(id, `${label}: needs at least 3 points`);
    if (s.points.some((p) => !finite(p.x) || !finite(p.y))) return err(id, `${label}: contains non-finite coordinates`);
    const b = boundsOf(s.points);
    if (Math.abs(b.maxX - b.minX - s.width) > 0.05 || Math.abs(b.maxY - b.minY - s.depth) > 0.05) {
      err(id, `${label}: width/depth (${s.width}×${s.depth}) do not match the points (${(b.maxX - b.minX).toFixed(2)}×${(b.maxY - b.minY).toFixed(2)})`);
    }
    if (expectOrigin && (Math.abs(b.minX) > 0.05 || Math.abs(b.minY) > 0.05)) err(id, `${label}: bounding box must start at (0,0), starts at (${b.minX.toFixed(2)}, ${b.minY.toFixed(2)})`);
    if (!s.closed) warn(id, `${label}: not closed`);
  };

  const provenance = (id: string, confidence: ConfidenceInfo | undefined, sources: SourceInfo[] | undefined) => {
    if (!confidence) return err(id, 'missing confidence');
    if (!(confidence.score >= 0 && confidence.score <= 1)) err(id, `confidence.score ${confidence.score} outside 0..1`);
    if (!sources || sources.length === 0) return err(id, 'missing sources');
    for (const s of sources) {
      if (!(s.confidence >= 0 && s.confidence <= 1)) err(id, `source "${s.sourceName}" confidence outside 0..1`);
      if (!s.sourceName || !s.method || !s.retrievedAt) err(id, `source "${s.sourceName}" misses sourceName/method/retrievedAt`);
      if (s.sourceUrl && !/^https?:\/\//.test(s.sourceUrl)) err(id, `source URL is not http(s): ${s.sourceUrl}`);
    }
    const types = new Set(sources.map((s) => s.sourceType));
    // an estimate must never be presented as official data
    if (types.has('parametric-reference') && confidence.level !== 'estimated') err(id, 'parametric reference data must be marked "estimated"');
    if (confidence.level === 'official' && !types.has('manufacturer')) err(id, '"official" precision requires a manufacturer source');
    if (confidence.level === 'cad' && !types.has('cad')) err(id, '"cad" precision requires a CAD source');
    if (types.has('photo-reconstruction') && ['official', 'cad', 'measured'].includes(confidence.level)) err(id, 'photo reconstruction cannot be "official", "cad" or "measured"');
  };

  const unique = (label: string, list: Array<{ id: string; slug?: string }> | undefined) => {
    const ids = new Set<string>();
    const slugs = new Set<string>();
    for (const x of list ?? []) {
      if (ids.has(x.id)) err(x.id, `${label}: duplicate id`);
      ids.add(x.id);
      if (x.slug) {
        if (slugs.has(x.slug)) err(x.id, `${label}: duplicate slug "${x.slug}"`);
        slugs.add(x.slug);
      }
    }
    return ids;
  };

  const points = (id: string, label: string, pts: Array<Point2D & { id?: string }> | undefined, outline: Shape | undefined, pad = 1) => {
    if (!pts || !outline) return;
    const b = boundsOf(outline.points);
    for (const p of pts) {
      if (!finite(p.x) || !finite(p.y)) err(id, `${label}: non-finite point ${p.id ?? ''}`);
      else if (p.x < b.minX - pad || p.x > b.maxX + pad || p.y < b.minY - pad || p.y > b.maxY + pad) err(id, `${label} ${p.id ?? ''} (${p.x}, ${p.y}) lies outside the outline`);
    }
  };

  const caseIds = unique('case', db.cases);
  const pcbIds = unique('pcb', db.pcbs);
  const plateIds = unique('plate', db.plates);
  const dbIds = unique('daughterboard', db.daughterboards);
  const switchIds = unique('switch', db.switches);
  const keycapIds = unique('keycap', db.keycaps);
  const stabIds = unique('stabilizer', db.stabilizers);
  const foamIds = unique('foam', db.foams);
  unique('keyboard', db.keyboards);

  for (const c of db.cases ?? []) {
    provenance(c.id, c.confidence, c.sources);
    shape(c.id, 'externalShape', c.externalShape, true);
    shape(c.id, 'internalCavity', c.internalCavity, false);
    if (c.internalCavity && c.externalShape && !containment(c.internalCavity.points, c.externalShape.points).contained) err(c.id, 'internalCavity is not inside externalShape');
    if (c.dimensions.width !== c.externalShape.width || c.dimensions.depth !== c.externalShape.depth) err(c.id, 'dimensions differ from externalShape');
    points(c.id, 'mounting post', c.mountingPoints, c.externalShape);
    if (c.appearance && !/^#[0-9a-f]{6}$/i.test(c.appearance.color)) err(c.id, `appearance.color "${c.appearance.color}" is not #rrggbb`);
    if (c.appearance?.keycapColor && !/^#[0-9a-f]{6}$/i.test(c.appearance.keycapColor)) err(c.id, `appearance.keycapColor "${c.appearance.keycapColor}" is not #rrggbb`);
    for (const cu of c.cutouts) {
      const along = cu.wall === 'front' || cu.wall === 'back' ? c.dimensions.width : c.dimensions.depth;
      if (cu.center - cu.width / 2 < -0.01 || cu.center + cu.width / 2 > along + 0.01) err(c.id, `cutout ${cu.id} extends beyond the ${cu.wall} wall`);
    }
    if (c.angle !== undefined && c.frontHeight !== undefined && c.rearHeight !== undefined) {
      const expected = c.frontHeight + c.dimensions.depth * Math.sin((c.angle * Math.PI) / 180);
      if (Math.abs(expected - c.rearHeight) > 1.5) warn(c.id, `rearHeight ${c.rearHeight} is inconsistent with frontHeight + depth·sin(angle) = ${expected.toFixed(1)}`);
    }
    if (c.model3d?.url && c.model3d.kind !== 'parametric' && c.model3d.url.startsWith('/')) warn(c.id, 'model3d.url should be relative to the site base');
  }

  for (const p of db.pcbs ?? []) {
    provenance(p.id, p.confidence, p.sources);
    shape(p.id, 'outline', p.outline, true);
    points(p.id, 'mounting hole', p.mountingPoints, p.outline);
    points(p.id, 'switch position', p.switchPositions, p.outline);
    if (p.usbPort) points(p.id, 'usb port', [p.usbPort], p.outline, 4);
    if (p.usbPort && p.daughterboard) warn(p.id, 'has both an integrated USB port and a daughterboard header');
    if (!p.usbPort && !p.daughterboard) warn(p.id, 'no USB information (alignment checks will be unknown)');
  }
  for (const p of db.plates ?? []) {
    provenance(p.id, p.confidence, p.sources);
    shape(p.id, 'outline', p.outline, true);
    points(p.id, 'switch cutout', p.switchCutouts, p.outline);
    points(p.id, 'screw hole', p.mountingPoints, p.outline);
    if (!(p.thickness > 0)) err(p.id, 'thickness must be positive');
  }
  for (const d of db.daughterboards ?? []) {
    provenance(d.id, d.confidence, d.sources);
    shape(d.id, 'outline', d.outline, true);
    points(d.id, 'mounting hole', d.mountingPoints, d.outline);
    if (!d.connectorType) err(d.id, 'connectorType is required');
  }
  for (const x of [...(db.switches ?? []), ...(db.keycaps ?? []), ...(db.stabilizers ?? []), ...(db.foams ?? [])]) provenance(x.id, x.confidence, x.sources);

  for (const k of db.keyboards ?? []) {
    provenance(k.id, k.confidence, k.sources);
    if (k.layout.keyCount !== k.layout.keys.length) err(k.id, `layout.keyCount ${k.layout.keyCount} ≠ keys.length ${k.layout.keys.length}`);
    const refs: Array<[string, string | undefined, Set<string>]> = [
      ['caseId', k.components.caseId, caseIds],
      ['pcbId', k.components.pcbId, pcbIds],
      ['plateId', k.components.plateId, plateIds],
      ['daughterboardId', k.components.daughterboardId, dbIds],
      ['switchId', k.components.switchId, switchIds],
      ['keycapId', k.components.keycapId, keycapIds],
      ['stabilizerId', k.components.stabilizerId, stabIds],
      ['foamId', k.components.foamId, foamIds],
    ];
    for (const [field, id, set] of refs) if (id && !set.has(id)) err(k.id, `components.${field} "${id}" does not exist`);
    const pcb = (db.pcbs ?? []).find((p) => p.id === k.components.pcbId);
    if (pcb && pcb.switchPositions.length !== k.layout.keyCount) err(k.id, `layout has ${k.layout.keyCount} keys but PCB ${pcb.id} has ${pcb.switchPositions.length} switch positions`);
    // never duplicate a component's data inside the keyboard
    if ((k as unknown as Record<string, unknown>)['pcb'] || (k as unknown as Record<string, unknown>)['case']) err(k.id, 'keyboards must reference components by id, not embed them');
    if (k.shape) warn(k.id, 'keyboard.shape duplicates the case outline; prefer resolving it from the case');
    k.images.forEach((u) => {
      if (!/^https?:\/\/|^\//.test(u)) err(k.id, `image reference "${u}" is not a URL or site path`);
    });
  }

  const exists: Record<string, Set<string>> = { case: caseIds, pcb: pcbIds, plate: plateIds, daughterboard: dbIds, switch: switchIds, keycap: keycapIds, stabilizer: stabIds, foam: foamIds };
  for (const r of db.relations ?? []) {
    for (const end of [r.from, r.to]) {
      if (!exists[end.type]?.has(end.id)) err(`relation ${r.from.id}→${r.to.id}`, `${end.type} "${end.id}" does not exist`);
    }
  }
  return out;
}
