/**
 * Extract physical dimensions from free text ("325 x 115 x 35 mm", "Width: 32.7 cm",
 * "12.8 × 4.5 in" …) and convert everything to millimetres.
 *
 * The result carries a confidence: labelled values ("Width: 327 mm") beat anonymous
 * triplets ("325 x 115 x 35"), because the latter need an assumption about the order.
 */
import type { Measurement, SourceType } from '../types/keyboard';
import type { ProductDimensions } from './types';

type Unit = 'mm' | 'cm' | 'in' | 'm';

const UNIT_TO_MM: Record<Unit, number> = { mm: 1, cm: 10, in: 25.4, m: 1000 };

function normUnit(u: string | undefined): Unit | undefined {
  if (!u) return undefined;
  const s = u.toLowerCase().replace(/\./g, '');
  if (s === 'mm' || s === 'millimeter' || s === 'millimetre' || s === 'millimeters' || s === 'millimetres') return 'mm';
  if (s === 'cm' || s === 'centimeter' || s === 'centimetre' || s === 'centimeters') return 'cm';
  if (s === 'in' || s === 'inch' || s === 'inches' || s === '"' || s === '”' || s === '″') return 'in';
  if (s === 'm') return 'm';
  return undefined;
}

const NUM = String.raw`(\d{1,4}(?:[.,]\d{1,2})?)`;
const UNIT = String.raw`(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|inches|inch|in\.?|"|”|″)`;

/** Dimension labels in en / pt / es → axis. "length" (comprimento, largo) is the long side. */
const LABEL_KEY: Record<string, 'length' | 'width' | 'depth' | 'height'> = {
  length: 'length', comprimento: 'length', longitud: 'length', largo: 'length',
  width: 'width', largura: 'width', ancho: 'width',
  depth: 'depth', profundidade: 'depth', profundidad: 'depth',
  height: 'height', altura: 'height', alto: 'height', thickness: 'height', espessura: 'height', grosor: 'height',
};
const LABELS = Object.keys(LABEL_KEY).join('|');

const toNumber = (s: string) => Number(s.replace(',', '.'));

export interface DimensionResult extends ProductDimensions {
  warnings: string[];
}

function measure(valueMm: number, source: SourceType, confidence: number, method: string): Measurement {
  return { value: Math.round(valueMm * 100) / 100, unit: 'mm', source, confidence, method };
}

/** Sanity ranges so that "5 x 3 x 2 in" of a switch is not mistaken for a keyboard. */
const PLAUSIBLE = { width: [90, 520], depth: [40, 260], height: [8, 90] } as const;
const inRange = (k: keyof typeof PLAUSIBLE, v: number) => v >= PLAUSIBLE[k][0] && v <= PLAUSIBLE[k][1];

export function extractDimensions(text: string, source: SourceType, baseConfidence: number): DimensionResult {
  const warnings: string[] = [];
  const result: DimensionResult = { warnings };
  const t = text.replace(/\s+/g, ' ');

  // 1) labelled values: "Width: 327 mm", "Length 32.7cm", "Depth: 11 cm"
  type Hit = { mm: number; raw: string };
  const hits: Partial<Record<'length' | 'width' | 'depth' | 'height' | 'frontHeight' | 'rearHeight', Hit>> = {};
  const labelRe = new RegExp(String.raw`\b(?:(front|back|rear|frente|traseira|trasera)\s+)?(${LABELS})\b\s*(?:\((?:max|approx\.?)\))?\s*[:=-]?\s*${NUM}\s*${UNIT}`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(t))) {
    const qualifier = (m[1] ?? '').toLowerCase();
    const label = (m[2] ?? '').toLowerCase();
    const unit = normUnit(m[4]);
    if (!unit) continue;
    const mm = toNumber(m[3] ?? '0') * UNIT_TO_MM[unit];
    let key = (LABEL_KEY[label] ?? 'width') as keyof typeof hits;
    // "front height" / "back height" are two different measurements, not two readings of "height"
    if (key === 'height' && qualifier) key = qualifier === 'front' || qualifier === 'frente' ? 'frontHeight' : 'rearHeight';
    hits[key] ??= { mm, raw: m[0] };
  }
  // keyboards are wider than deep: when a "length" exists it is our width and "width" is our depth
  const labelled: Partial<Record<'width' | 'depth' | 'height', Hit>> = {};
  if (hits.length) {
    labelled.width = hits.length;
    labelled.depth = hits.width ?? hits.depth;
  } else {
    labelled.width = hits.width;
    labelled.depth = hits.depth;
  }
  labelled.height = hits.height;
  if (labelled.width && labelled.depth && labelled.width.mm < labelled.depth.mm) {
    // swapped labelling ("Width 115, Depth 325")
    const w = labelled.width;
    labelled.width = labelled.depth;
    labelled.depth = w;
  }

  // 2) anonymous sequence: "325 x 115 x 35 mm"
  const seqRe = new RegExp(String.raw`${NUM}\s*${UNIT}?\s*(?:x|×|\*|by)\s*${NUM}\s*${UNIT}?(?:\s*(?:x|×|\*|by)\s*${NUM}\s*${UNIT}?)?`, 'gi');
  let seq: { a: number; b: number; c?: number; raw: string } | undefined;
  while ((m = seqRe.exec(t))) {
    const units = [m[2], m[4], m[6]].map(normUnit).filter((u): u is Unit => !!u);
    const unit = units[units.length - 1];
    if (!unit) continue; // no unit anywhere: ambiguous, skip
    const k = UNIT_TO_MM[unit];
    const a = toNumber(m[1] ?? '0') * k;
    const b = toNumber(m[3] ?? '0') * k;
    const c = m[5] ? toNumber(m[5]) * k : undefined;
    const w = Math.max(a, b);
    const d = Math.min(a, b);
    if (inRange('width', w) && inRange('depth', d)) {
      seq = { a: w, b: d, c, raw: m[0] };
      break;
    }
  }

  const raws: string[] = [];
  const put = (key: 'width' | 'depth' | 'height' | 'frontHeight' | 'rearHeight', mmValue: number, conf: number, method: string, raw: string) => {
    if (!inRange(key.endsWith('Height') ? 'height' : (key as 'width' | 'depth' | 'height'), mmValue)) {
      warnings.push(`Ignored implausible ${key} ${mmValue.toFixed(1)} mm (from "${raw}").`);
      return;
    }
    result[key] = measure(mmValue, source, conf, method);
    raws.push(raw);
  };

  for (const key of ['width', 'depth', 'height'] as const) {
    const l = labelled[key];
    if (l) put(key, l.mm, baseConfidence, 'labelled-text', l.raw);
  }
  if (hits.frontHeight) put('frontHeight', hits.frontHeight.mm, baseConfidence, 'labelled-text', hits.frontHeight.raw);
  if (hits.rearHeight) put('rearHeight', hits.rearHeight.mm, baseConfidence, 'labelled-text', hits.rearHeight.raw);
  if (seq) {
    if (!result.width) put('width', seq.a, baseConfidence * 0.85, 'dimension-sequence', seq.raw);
    if (!result.depth) put('depth', seq.b, baseConfidence * 0.85, 'dimension-sequence', seq.raw);
    if (!result.height && seq.c !== undefined) put('height', seq.c, baseConfidence * 0.7, 'dimension-sequence', seq.raw);
    if (seq.c !== undefined) warnings.push('Order "length × width × height" assumed for the dimension sequence.');
  }
  if (raws.length) result.raw = [...new Set(raws)].join(' | ');
  return result;
}

export interface WeightResult {
  weight?: Measurement;
}

export function extractWeight(text: string, source: SourceType, baseConfidence: number): Measurement | undefined {
  const re = /\b(?:net\s+)?(?:weight|peso)\b[^0-9]{0,20}(\d{1,5}(?:[.,]\d{1,3})?)\s*(kg|kilograms?|grams?|g|lbs?|pounds?|oz)\b/i;
  const m = re.exec(text.replace(/\s+/g, ' '));
  if (!m) return undefined;
  const v = toNumber(m[1] ?? '0');
  const u = (m[2] ?? '').toLowerCase();
  const grams = u.startsWith('kilogram') || u === 'kg' ? v * 1000 : u.startsWith('gram') || u === 'g' ? v : u.startsWith('lb') || u.startsWith('pound') ? v * 453.592 : v * 28.3495;
  if (grams < 100 || grams > 6000) return undefined;
  return { value: Math.round(grams), unit: 'g', source, confidence: baseConfidence, method: 'labelled-text' };
}
