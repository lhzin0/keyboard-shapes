import type { Model3D } from '../../types/keyboard';

/**
 * Source priority for a 3D model:
 *   CAD  >  official GLB  >  reconstructed  >  parametric  >  estimated
 *
 * A candidate without a `url` can only be generated procedurally, so file-backed
 * kinds (cad / glb / reconstructed) are skipped when their file is missing.
 */
export const MODEL_PRIORITY: Model3D['kind'][] = ['cad', 'glb', 'reconstructed', 'parametric', 'estimated'];

const FILE_BACKED: Model3D['kind'][] = ['cad', 'glb', 'reconstructed'];

export type ResolvedModel = { kind: Model3D['kind']; url?: string; sourceName?: string; procedural: boolean };

export function resolveModelSource(candidates: Array<Model3D | undefined>): ResolvedModel {
  const usable = candidates.filter((c): c is Model3D => !!c && (!FILE_BACKED.includes(c.kind) || !!c.url));
  usable.sort((a, b) => MODEL_PRIORITY.indexOf(a.kind) - MODEL_PRIORITY.indexOf(b.kind));
  const best = usable[0];
  if (!best) return { kind: 'estimated', procedural: true };
  // a parametric/estimated model is always rebuilt from the geometry; its url (if any) is only a downloadable copy
  const procedural = best.kind === 'parametric' || best.kind === 'estimated' || !best.url;
  return { kind: best.kind, url: best.url, sourceName: best.sourceName, procedural };
}
