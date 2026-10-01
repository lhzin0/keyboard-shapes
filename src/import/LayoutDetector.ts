/**
 * Layout detection.
 *
 * Two entry points:
 *  - detectLayout(keys, hints)  : from a key map (positions known).
 *  - detectLayoutFromText(text) : from marketing/spec text ("65%", "87 keys", "tenkeyless" …).
 *
 * Both return a confidence and the reasons, so the UI can show *why* a layout
 * was proposed — and the user can always override it.
 */
import type { KeyDef, LayoutName } from '../types/keyboard';

export interface LayoutDetection {
  layout: LayoutName;
  /** 0..1 */
  confidence: number;
  reasons: string[];
  candidates: Array<{ layout: LayoutName; score: number }>;
}

interface Features {
  count: number;
  widthU: number;
  rowCount: number;
  hasFRow: boolean;
  hasNumpad: boolean;
  hasNavCluster: boolean;
  hasArrows: boolean;
  rotatedShare: number;
  splitRows: number;
  clusterGap: boolean;
}

function features(keys: KeyDef[]): Features {
  const count = keys.length;
  const widthU = Math.max(0, ...keys.map((k) => k.x + k.width));
  const ys = [...new Set(keys.map((k) => Math.round(k.y * 2) / 2))].sort((a, b) => a - b);
  const first = ys[0] ?? 0;
  const second = ys[1] ?? first;
  // F-row: the top row is separated from the next one by more than a regular row pitch
  const fKeys = keys.filter((k) => /^F\d{1,2}$/i.test(k.label)).length;
  const hasFRow = fKeys >= 8 || (ys.length >= 6 && second - first > 1.2);
  const rowCount = ys.length;
  const hasNumpad = keys.some((k) => k.x >= 18 && widthU >= 21) && count >= 90;
  const hasNavCluster = widthU >= 17 && keys.some((k) => k.x >= 15 && k.x < 18.4);
  const hasArrows = keys.some((k) => /^(up|down|left|right|↑|↓|←|→)$/i.test(k.label));
  const rotatedShare = keys.filter((k) => Math.abs(k.rotation) >= 5).length / Math.max(1, count);

  // a "split" board has a central hole (≥ 2u) on most rows
  const rows = new Map<number, KeyDef[]>();
  for (const k of keys) {
    const key = Math.round(k.y * 4) / 4;
    const list = rows.get(key);
    if (list) list.push(k);
    else rows.set(key, [k]);
  }
  let splitRows = 0;
  for (const list of rows.values()) {
    const sorted = [...list].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i] as KeyDef).x - ((sorted[i - 1] as KeyDef).x + (sorted[i - 1] as KeyDef).width);
      const mid = ((sorted[i] as KeyDef).x + (sorted[i - 1] as KeyDef).x) / 2;
      if (gap >= 2 && Math.abs(mid - widthU / 2) < widthU * 0.2) splitRows++;
    }
  }
  const clusterGap = keys.some((k) => k.x > 14.9 && k.x < 15.6) && keys.some((k) => k.x + k.width <= 15.05 && k.x + k.width > 14.9);
  return { count, widthU, rowCount, hasFRow, hasNumpad, hasNavCluster, hasArrows, rotatedShare, splitRows, clusterGap };
}

export function detectLayout(keys: KeyDef[], hintText?: string): LayoutDetection {
  const f = features(keys);
  const reasons: string[] = [];
  let layout: LayoutName = 'Custom';
  let confidence = 0.5;

  if (keys.length === 0) {
    return { layout: 'Custom', confidence: 0, reasons: ['No keys.'], candidates: [] };
  }

  if (f.rotatedShare >= 0.1) {
    layout = f.count >= 55 && f.count <= 82 ? 'Alice' : 'Ergo';
    reasons.push(`${Math.round(f.rotatedShare * 100)}% of keys are rotated`);
    confidence = 0.7;
  } else if (f.splitRows >= 3) {
    layout = 'Split';
    reasons.push(`central gap of ≥ 2u on ${f.splitRows} rows`);
    confidence = 0.75;
  } else if (f.hasNumpad) {
    if (f.count >= 100) {
      layout = 'Full Size';
      reasons.push(`${f.count} keys with numpad`);
    } else if (f.widthU <= 20.5) {
      layout = f.count >= 96 ? '1800' : '96%';
      reasons.push(`${f.count} keys, numpad, compact width ${f.widthU.toFixed(1)}u`);
    } else {
      layout = '96%';
      reasons.push(`${f.count} keys with numpad`);
    }
    confidence = 0.85;
  } else if (f.hasFRow && f.hasNavCluster) {
    layout = f.clusterGap || f.widthU >= 18 ? 'TKL' : '80%';
    reasons.push(`function row + navigation cluster, ${f.count} keys`);
    confidence = 0.85;
  } else if (f.hasFRow) {
    layout = '75%';
    reasons.push(`function row without a separate navigation cluster, ${f.count} keys`);
    confidence = 0.8;
  } else if (f.rowCount <= 4) {
    layout = '40%';
    reasons.push(`${f.rowCount} rows, ${f.count} keys`);
    confidence = 0.8;
  } else if (f.count <= 55) {
    layout = '50%';
    reasons.push(`${f.count} keys on 5 rows`);
    confidence = 0.65;
  } else if (f.count <= 64 && !f.hasArrows) {
    layout = '60%';
    reasons.push(`${f.count} keys, no arrow cluster`);
    confidence = 0.85;
  } else if (f.count <= 70) {
    layout = '65%';
    reasons.push(`${f.count} keys with arrows`);
    confidence = 0.85;
  } else if (f.count <= 78) {
    layout = '70%';
    reasons.push(`${f.count} keys on 5–6 rows`);
    confidence = 0.6;
  } else {
    layout = 'Custom';
    reasons.push(`${f.count} keys do not match a known layout`);
    confidence = 0.4;
  }

  if (hintText) {
    const hint = detectLayoutFromText(hintText);
    if (hint.layout !== 'Custom') {
      if (hint.layout === layout) {
        confidence = Math.min(0.97, confidence + 0.1);
        reasons.push(`specification text also says ${hint.layout}`);
      } else {
        reasons.push(`specification text says ${hint.layout} — please confirm`);
        confidence = Math.max(0.3, confidence - 0.2);
      }
    }
  }
  return { layout, confidence, reasons, candidates: [{ layout, score: confidence }] };
}

/** "keys" in the languages product pages are commonly written in (en, pt, es, fr, de). */
const K = String.raw`(?:keys?|teclas?|touches?|tasten|tecle?s)`;
const NOT_PART_OF_WORD = String.raw`(?<![\w-])`;
const pat = (body: string) => new RegExp(`${NOT_PART_OF_WORD}(?:${body})(?!\\w)`, 'i');
const keys = (digits: string) => String.raw`${digits}[\s-]?${K}`;

const TEXT_PATTERNS: Array<[RegExp, LayoutName]> = [
  [pat(String.raw`full[\s-]?siz(?:e|ed)|tamanho\s+normal|tama[nñ]o\s+completo|${keys('10[458]')}`), 'Full Size'],
  [pat(String.raw`1800|9[68]\s?%|${keys('9[68]')}`), '96%'],
  [pat(String.raw`tkl|ten[\s-]?key[\s-]?less|sem\s+(?:teclado\s+)?num[eé]rico|sin\s+teclado\s+num[eé]rico|80\s?%|${keys('8[78]')}`), 'TKL'],
  [pat(String.raw`75\s?%|${keys('8[124]')}`), '75%'],
  [pat(String.raw`70\s?%`), '70%'],
  [pat(String.raw`65\s?%|${keys('6[678]')}`), '65%'],
  [pat(String.raw`60\s?%|${keys('6[1234]')}`), '60%'],
  [pat(String.raw`50\s?%|${keys('5[23]')}`), '50%'],
  [pat(String.raw`40\s?%|${keys('4[78]')}`), '40%'],
  [/\balice\b/i, 'Alice'],
  [/\bsplit\b|\bdividido\b/i, 'Split'],
  [/\b(ergo|ergonomic[oa]?|ergon[oô]mic[oa]?)\b/i, 'Ergo'],
];

/** Best-effort detection from free text (names, specs). Never certain: max confidence 0.7. */
export function detectLayoutFromText(text: string): LayoutDetection {
  const hits: Array<{ layout: LayoutName; match: string }> = [];
  for (const [re, layout] of TEXT_PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push({ layout, match: m[0] });
  }
  const first = hits[0];
  if (!first) return { layout: 'Custom', confidence: 0, reasons: ['No layout keywords found.'], candidates: [] };
  // "80%" and "TKL" overlap, "1800" and "96%" too; first match in priority order wins
  return {
    layout: first.layout,
    confidence: hits.length === 1 ? 0.7 : 0.55,
    reasons: [`found "${first.match}" in the text`],
    candidates: hits.map((h, i) => ({ layout: h.layout, score: 0.7 - i * 0.1 })),
  };
}

/**
 * Noisy text (a whole product page, with recommendations and accessories) cannot be read by
 * "first keyword wins": count every layout keyword and let the most frequent one win, then say
 * plainly when the evidence is split. Confidence stays low either way — this is a hint.
 */
export function detectLayoutByVoting(text: string): LayoutDetection {
  const counts: Array<{ layout: LayoutName; count: number; order: number }> = [];
  TEXT_PATTERNS.forEach(([re, layout], order) => {
    const n = text.match(new RegExp(re.source, 'gi'))?.length ?? 0;
    if (n > 0) counts.push({ layout, count: n, order });
  });
  if (counts.length === 0) return { layout: 'Custom', confidence: 0, reasons: ['No layout keywords found.'], candidates: [] };
  counts.sort((a, b) => b.count - a.count || a.order - b.order);
  const [top, second] = counts as [(typeof counts)[number], (typeof counts)[number] | undefined];
  const dominant = !second || top.count >= 2 * second.count;
  const summary = counts.slice(0, 3).map((c) => `${c.layout}×${c.count}`).join(', ');
  return {
    layout: top.layout,
    confidence: dominant ? 0.4 : 0.25,
    reasons: [dominant ? `most mentioned layout in the page text (${summary})` : `page text mentions several layouts (${summary}) — please confirm`],
    candidates: counts.map((c) => ({ layout: c.layout, score: c.count })),
  };
}
