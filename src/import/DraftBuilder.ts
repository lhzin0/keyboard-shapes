/**
 * DraftBuilder: confirmed import data → Keyboard + Case records.
 *
 * Only what is actually known goes into the records. A product page gives dimensions
 * and photos, never the inside of the case, so the draft has:
 *   - an outline (reconstructed from an image, else a rounded rectangle — flagged as estimated),
 *   - no internal cavity, no mounting posts, no cutouts unless the user/blueprint supplied them,
 *   - no PCB or plate: the compatibility engine will answer "unknown", never "compatible".
 */
import { buildLayout } from '../geometry/layouts';
import { makeShape, normalizeShape, round, roundedRectPoints } from '../geometry/shape';
import type {
  Case,
  ConfidenceInfo,
  Keyboard,
  LayoutName,
  MountingPoint,
  PrecisionLevel,
  Profile,
  Shape,
  SourceInfo,
} from '../types/keyboard';

export interface DraftInput {
  brand: string;
  model: string;
  layout: LayoutName;
  widthMm: number;
  depthMm: number;
  heightMm?: number;
  /** Typing-surface heights (no keycaps) → the case gets its angle from them. */
  frontHeightMm?: number;
  rearHeightMm?: number;
  /** Outline from the shape reconstructor, already in mm. */
  shape?: Shape;
  shapeConfidence?: ConfidenceInfo;
  holes?: MountingPoint[];
  profile?: Profile;
  sources: SourceInfo[];
  /** Remote image references (we keep the link, not a copy). */
  imageUrls: string[];
  existingSlugs: Set<string>;
  now?: string;
}

export interface Draft {
  keyboard: Keyboard;
  case: Case;
  warnings: string[];
}

/** The key positions are the generic ANSI reference map for the layout name, never the product's real key map. */
const LAYOUT_KEYMAP_NOTE = (layout: string) => `Key positions are the generic ANSI ${layout} reference map, not this product's actual key map (ISO/JIS and special keys differ).`;

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function uniqueSlug(base: string, existing: Set<string>): string {
  let slug = slugify(base) || 'keyboard';
  if (!existing.has(slug)) return slug;
  let i = 2;
  while (existing.has(`${slug}-${i}`)) i++;
  slug = `${slug}-${i}`;
  return slug;
}

export function buildDraft(input: DraftInput): Draft {
  const warnings: string[] = [];
  const now = input.now ?? new Date().toISOString();
  const slug = uniqueSlug(`${input.brand} ${input.model}`, input.existingSlugs);

  let outline: Shape;
  let level: PrecisionLevel;
  let score: number;
  let notes: string;
  if (input.shape) {
    outline = normalizeShape(input.shape);
    level = 'reconstructed';
    score = input.shapeConfidence?.score ?? 0.6;
    notes = 'Outline reconstructed from an image and calibrated with a known dimension. Interior (cavity, posts, cutouts) unknown.';
  } else {
    outline = makeShape(roundedRectPoints(0, 0, input.widthMm, input.depthMm, 4, 6));
    level = 'estimated';
    score = 0.3;
    notes = 'Outline assumed to be a rounded rectangle from the overall width × depth. The real shape may differ.';
    warnings.push('No image was reconstructed: the outline is an assumed rounded rectangle.');
  }

  if (LAYOUT_KEYMAP_NOTE) notes += ` ${LAYOUT_KEYMAP_NOTE(input.layout)}`;
  const width = round(outline.width, 2);
  const depth = round(outline.depth, 2);
  const confidence: ConfidenceInfo = { level, score, notes };

  const layout = buildLayout(input.layout) ?? { name: input.layout, keys: [], widthU: 0, heightU: 0, keyCount: 0, description: input.layout };
  if (layout.keyCount === 0) warnings.push(`No reference key map exists for "${input.layout}": key positions are not drawn.`);

  const caseId = `imp-${slug}-case`;
  const profile = input.profile;
  // front/rear height + depth give the typing angle: rear − front = depth · sin(angle)
  const fh = input.frontHeightMm ?? profile?.frontHeight;
  const rh = input.rearHeightMm ?? profile?.rearHeight;
  const angle = profile?.angle ?? (fh !== undefined && rh !== undefined ? round((Math.asin(Math.max(-1, Math.min(1, (rh - fh) / depth))) * 180) / Math.PI, 1) : undefined);
  const c: Case = {
    id: caseId,
    slug: caseId,
    brand: input.brand,
    model: `${input.model} case`,
    dimensions: { width, depth, height: input.heightMm ?? rh },
    externalShape: outline,
    angle,
    frontHeight: fh,
    rearHeight: rh,
    mountingPoints: input.holes ?? [],
    cutouts: [],
    model3d: { kind: 'parametric' },
    tags: ['imported', input.layout],
    sources: input.sources,
    confidence,
  };

  const keyboard: Keyboard = {
    id: `imp-${slug}`,
    brand: input.brand,
    model: input.model,
    slug,
    layout,
    dimensions: { width, depth, height: input.heightMm ?? rh },
    components: { caseId },
    profile,
    tags: ['imported', input.layout],
    sources: input.sources,
    confidence,
    images: input.imageUrls,
    model3d: { kind: 'parametric' },
    addedAt: now,
  };
  return { keyboard, case: c, warnings };
}
