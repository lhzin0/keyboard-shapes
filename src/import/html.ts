/**
 * Tiny, dependency-free HTML helpers that behave the same in Node and the browser.
 * They are deliberately forgiving: product pages are messy and we only need a few
 * well-defined pieces (meta tags, JSON-LD, tables, text).
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&times;': '×',
  '&deg;': '°',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|times|deg|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const body = tag.replace(/^<\s*[a-zA-Z0-9]+/, '').replace(/\/?>$/, '');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const name = (m[1] ?? '').toLowerCase();
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function findTags(html: string, tag: string): Array<Record<string, string>> {
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  return (html.match(re) ?? []).map(parseAttributes);
}

export interface MetaTags {
  /** name/property → content (first occurrence wins). */
  byKey: Record<string, string>;
  title?: string;
  canonical?: string;
}

export function extractMeta(html: string): MetaTags {
  const byKey: Record<string, string> = {};
  for (const a of findTags(html, 'meta')) {
    const key = (a['property'] ?? a['name'] ?? a['itemprop'] ?? '').toLowerCase();
    if (key && a['content'] !== undefined && byKey[key] === undefined) byKey[key] = a['content'];
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const canonical = findTags(html, 'link').find((l) => (l['rel'] ?? '').toLowerCase() === 'canonical')?.['href'];
  return { byKey, title: title ? stripTags(title) : undefined, canonical };
}

/** All JSON-LD blocks, flattened (handles arrays and @graph). Invalid blocks are skipped. */
export function extractJsonLd(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      out.push(obj);
      if (obj['@graph']) visit(obj['@graph']);
    }
  };
  while ((m = re.exec(html))) {
    try {
      visit(JSON.parse((m[1] ?? '').trim()));
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return out;
}

export function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

export interface TableRow {
  cells: string[];
}

/** Two-column spec tables and definition lists → key/value pairs. */
export function extractSpecPairs(html: string): Record<string, string> {
  const specs: Record<string, string> = {};
  const add = (k: string, v: string) => {
    const key = k.replace(/[:：]\s*$/, '').trim();
    const val = v.trim();
    if (key && val && key.length < 60 && val.length < 300 && specs[key] === undefined) specs[key] = val;
  };
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const cells = [...(m[1] ?? '').matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => stripTags(c[1] ?? ''));
    if (cells.length >= 2) add(cells[0] ?? '', cells[1] ?? '');
  }
  const dlRe = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  while ((m = dlRe.exec(html))) add(stripTags(m[1] ?? ''), stripTags(m[2] ?? ''));
  // "<li><strong>Weight:</strong> 1.2 kg</li>" style lists
  const liRe = /<li\b[^>]*>\s*<(?:strong|b|span)\b[^>]*>([^<]{2,40}?)[:：]?\s*<\/(?:strong|b|span)>\s*[:：]?\s*([^<]{1,200})/gi;
  while ((m = liRe.exec(html))) add(m[1] ?? '', decodeEntities(m[2] ?? ''));
  return specs;
}

export function resolveUrl(href: string, base: string): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}
