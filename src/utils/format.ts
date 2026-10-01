import type { CheckStatus, ConfidenceInfo, PrecisionLevel, Verdict } from '../types/keyboard';

export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');

export const mm = (v: number | undefined | null, digits = 1): string => (v === undefined || v === null || Number.isNaN(v) ? '—' : `${v.toFixed(digits)} mm`);

export const num = (v: number, digits = 1): string => (Number.isInteger(v) ? String(v) : v.toFixed(digits));

export const PRECISION_LABEL: Record<PrecisionLevel, string> = {
  official: 'Official',
  cad: 'CAD',
  measured: 'Measured',
  reconstructed: 'Reconstructed',
  estimated: 'Estimated',
  unknown: 'Unknown',
};

export const PRECISION_HELP: Record<PrecisionLevel, string> = {
  official: 'Published by the manufacturer.',
  cad: 'Taken from a CAD file.',
  measured: 'Measured on a physical sample.',
  reconstructed: 'Reconstructed from photos or drawings, calibrated by a known dimension.',
  estimated: 'Estimated or generated parametrically — not a measurement.',
  unknown: 'No reliable information.',
};

/** CSS-module class key used for the precision badge colour. */
export function precisionTone(level: PrecisionLevel): 'ok' | 'info' | 'warn' | 'unknown' {
  if (level === 'official' || level === 'cad' || level === 'measured') return 'ok';
  if (level === 'reconstructed') return 'info';
  if (level === 'estimated') return 'warn';
  return 'unknown';
}

export function confidenceText(c: ConfidenceInfo): string {
  return `${PRECISION_LABEL[c.level]} · ${Math.round(c.score * 100)}%`;
}

export const STATUS_ICON: Record<CheckStatus, string> = { ok: '✓', warn: '⚠', fail: '✕', unknown: '?' };
export const STATUS_WORD: Record<CheckStatus, string> = { ok: 'OK', warn: 'Tight', fail: 'Incompatible', unknown: 'Unknown' };

export const VERDICT_LABEL: Record<Verdict, string> = {
  compatible: 'Compatible',
  tight: 'Compatible (tight)',
  partial: 'Partially verified',
  incompatible: 'Incompatible',
  unknown: 'Unknown',
};

export function verdictTone(v: Verdict): 'ok' | 'warn' | 'fail' | 'unknown' | 'info' {
  switch (v) {
    case 'compatible':
      return 'ok';
    case 'tight':
      return 'warn';
    case 'incompatible':
      return 'fail';
    case 'partial':
      return 'info';
    default:
      return 'unknown';
  }
}

export function statusTone(s: CheckStatus): 'ok' | 'warn' | 'fail' | 'unknown' {
  return s;
}

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
