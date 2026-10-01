/**
 * Collect product images from a page and classify them (TOP / SIDE / FRONT / BACK /
 * BLUEPRINT / DETAIL / UNKNOWN) using only what is visible in the markup: file names,
 * alt text and size hints. Pixel-level analysis happens later, on demand, in the
 * shape reconstructor.
 *
 * Classification is token-based on purpose. Substring matching misfires badly on real
 * shop pages: a content hash like "…-cad-…" is not a CAD drawing, and "Low_Profile_Switch"
 * is a keycap profile, not a side view.
 */
import { decodeEntities, extractJsonLd, extractMeta, findTags, resolveUrl } from './html';
import type { ImageCandidate, ImageOrigin, ImageType } from './types';

interface Rule {
  type: ImageType;
  /** Whole tokens (split on non-alphanumerics). */
  tokens?: string[];
  /** Multi-word phrases, matched on the token stream joined by single spaces. */
  phrases?: string[];
  weight: number;
}

const RULES: Rule[] = [
  { type: 'BLUEPRINT', tokens: ['blueprint', 'blueprints', 'technical', 'dimension', 'dimensions', 'drawing', 'schematic', 'cad', 'specsheet', 'measurements'], phrases: ['spec sheet'], weight: 0.9 },
  { type: 'TOP', tokens: ['topview', 'overhead', 'planview', 'flatlay'], phrases: ['top view', 'top down', 'birds eye', 'bird eye', 'plan view', 'flat lay'], weight: 0.85 },
  { type: 'SIDE', tokens: ['sideview', 'lateral'], phrases: ['side view', 'side profile', 'profile view', 'typing angle'], weight: 0.85 },
  { type: 'FRONT', tokens: ['frontview'], phrases: ['front view'], weight: 0.8 },
  { type: 'BACK', tokens: ['backview', 'rearview'], phrases: ['back view', 'rear view'], weight: 0.8 },
  {
    type: 'DETAIL',
    tokens: ['detail', 'details', 'closeup', 'zoom', 'macro', 'lifestyle', 'desk', 'setup', 'switch', 'switches', 'keycap', 'keycaps', 'stabilizer', 'stabilizers', 'stabiliser', 'knob', 'gasket', 'foam', 'pcb', 'cable', 'usb', 'tape', 'grip', 'launcher', 'software'],
    phrases: ['close up'],
    weight: 0.6,
  },
];

/** A bare "side" / "top" in a file name is a hint, not proof ("top-case", "side-by-side"): weaker, checked after DETAIL. */
const WEAK: Array<{ type: ImageType; tokens: string[] }> = [
  { type: 'TOP', tokens: ['top'] },
  { type: 'SIDE', tokens: ['side'] },
  { type: 'FRONT', tokens: ['front'] },
  { type: 'BACK', tokens: ['back', 'rear'] },
];

const JUNK_TOKENS = new Set(['logo', 'icon', 'icons', 'sprite', 'avatar', 'badge', 'payment', 'visa', 'paypal', 'star', 'stars', 'rating', 'flag', 'banner', 'placeholder', 'pixel', 'tracking', 'spinner', 'loading', 'social', 'facebook', 'instagram', 'twitter', 'youtube']);

/** Lower-case alphanumeric tokens, with hashes / UUID fragments / long numbers removed. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !/^[0-9a-f]{6,}$/.test(t) && !/^\d{4,}$/.test(t) && !/^\d+x\d*$/.test(t));
}

function nameOf(url: string): string {
  const file = url.split('?')[0]?.split('/').pop() ?? '';
  try {
    return decodeURIComponent(file).replace(/\.[a-z0-9]{2,5}$/i, '');
  } catch {
    return file.replace(/\.[a-z0-9]{2,5}$/i, '');
  }
}

export function classifyImage(url: string, alt = ''): Pick<ImageCandidate, 'type' | 'typeConfidence' | 'reasons'> {
  const tokens = [...tokenize(nameOf(url)), ...tokenize(alt)];
  const stream = ` ${tokens.join(' ')} `;
  for (const rule of RULES) {
    const tok = rule.tokens?.find((t) => tokens.includes(t));
    const phrase = rule.phrases?.find((p) => stream.includes(` ${p} `));
    const hit = tok ?? phrase;
    if (hit) return { type: rule.type, typeConfidence: rule.weight, reasons: [`"${hit}" in file name or alt text`] };
  }
  for (const w of WEAK) {
    const tok = w.tokens.find((t) => tokens.includes(t));
    if (tok) return { type: w.type, typeConfidence: 0.7, reasons: [`"${tok}" in file name or alt text (weak hint)`] };
  }
  return { type: 'UNKNOWN', typeConfidence: 0.2, reasons: [] };
}

const isJunk = (url: string, alt?: string) => [...tokenize(nameOf(url)), ...tokenize(alt ?? '')].some((t) => JUNK_TOKENS.has(t));

function canonicalKey(url: string): string {
  // many CDNs encode the size in the query string or file name — collapse those variants
  return url
    .split('?')[0]
    ?.replace(/[-_](\d{2,4}x\d{0,4}|\d{2,4}w|small|medium|large|thumb|thumbnail)(?=\.\w+$)/i, '') as string;
}

export const ORIGIN_RANK: Record<ImageOrigin, number> = { structured: 3, meta: 2, markup: 1 };

function score(c: Omit<ImageCandidate, 'score'>): number {
  let s = 0.3;
  if (c.type === 'TOP') s += 0.35;
  else if (c.type === 'BLUEPRINT') s += 0.4;
  else if (c.type === 'SIDE') s += 0.3;
  else if (c.type === 'FRONT' || c.type === 'BACK') s += 0.2;
  else if (c.type === 'DETAIL') s -= 0.1;
  // images the page itself declares as *the* product images beat the rest of the markup
  // (shops embed hundreds of images of other products: recommendations, accessories, banners)
  if (c.origin === 'structured') s += 0.25;
  else if (c.origin === 'meta') s += 0.2;
  if (/\.(png|webp)(\?|$)/i.test(c.url)) s += 0.05; // often cut-out product shots
  if (c.width && c.height) {
    if (Math.min(c.width, c.height) >= 600) s += 0.1;
    if (Math.min(c.width, c.height) < 200) s -= 0.3;
  }
  return Math.max(0, Math.min(1, s));
}

export function extractImages(html: string, baseUrl: string): ImageCandidate[] {
  const found = new Map<string, Omit<ImageCandidate, 'score'>>();
  const add = (origin: ImageOrigin, href: string | undefined, alt?: string, width?: number, height?: number) => {
    if (!href || href.startsWith('data:')) return;
    const abs = resolveUrl(decodeEntities(href.trim()), baseUrl);
    if (!abs || !/^https?:/i.test(abs)) return;
    if (/\.(svg|gif|ico)(\?|$)/i.test(abs) || isJunk(abs, alt)) return;
    if ((width && width < 120) || (height && height < 120)) return;
    const key = canonicalKey(abs);
    const prev = found.get(key);
    if (prev) {
      if (ORIGIN_RANK[origin] > ORIGIN_RANK[prev.origin]) prev.origin = origin;
      return;
    }
    found.set(key, { url: abs, alt, width, height, origin, ...classifyImage(abs, alt) });
  };

  // structured data first (usually the best images)
  for (const node of extractJsonLd(html)) {
    const img = node['image'];
    const list = Array.isArray(img) ? img : img ? [img] : [];
    for (const i of list) {
      if (typeof i === 'string') add('structured', i);
      else if (i && typeof i === 'object') add('structured', (i as Record<string, unknown>)['url'] as string | undefined);
    }
  }
  const meta = extractMeta(html).byKey;
  add('meta', meta['og:image'] ?? meta['og:image:url']);
  add('meta', meta['twitter:image']);

  for (const a of findTags(html, 'img')) {
    const w = a['width'] ? Number(a['width']) : undefined;
    const h = a['height'] ? Number(a['height']) : undefined;
    const srcset = a['srcset'] ?? a['data-srcset'];
    const best = srcset
      ?.split(',')
      .map((p) => p.trim().split(/\s+/))
      .sort((x, y) => parseInt(y[1] ?? '0', 10) - parseInt(x[1] ?? '0', 10))[0]?.[0];
    add('markup', best ?? a['data-src'] ?? a['data-original'] ?? a['src'], a['alt'], Number.isFinite(w) ? w : undefined, Number.isFinite(h) ? h : undefined);
  }

  return [...found.values()].map((c) => ({ ...c, score: score(c) })).sort((a, b) => b.score - a.score);
}

/** The best candidate for each view type. */
export function pickByType(images: ImageCandidate[]): Partial<Record<ImageType, ImageCandidate>> {
  const out: Partial<Record<ImageType, ImageCandidate>> = {};
  for (const i of images) {
    const cur = out[i.type];
    if (!cur || i.score > cur.score) out[i.type] = i;
  }
  return out;
}

/**
 * Is this image safe to feed to the reconstructor without the user choosing it?
 * Only when the filename/alt says it is a top/blueprint/side view with confidence, *and*
 * the page itself declares it (structured data / og:image) or it names the product.
 * Everything else must be picked explicitly — a wrong image gives a confidently wrong outline.
 */
export function isAutoPickable(img: ImageCandidate, wanted: ImageType[], productTokens: string[] = []): boolean {
  if (!wanted.includes(img.type) || img.typeConfidence < 0.8) return false;
  if (img.origin !== 'markup') return true;
  const hay = new Set([...tokenize(nameOf(img.url)), ...tokenize(img.alt ?? '')]);
  return productTokens.some((t) => t.length > 2 && hay.has(t));
}
