import type {
  CheckResult,
  CheckStatus,
  ComponentRef,
  CompatibilityResult,
  PrecisionLevel,
  Verdict,
} from '../types/keyboard';

const PRECISION_ORDER: PrecisionLevel[] = ['official', 'cad', 'measured', 'reconstructed', 'estimated', 'unknown'];

/** The lowest-quality level among the inputs (worst wins). */
export function worstPrecision(levels: Array<PrecisionLevel | undefined>): PrecisionLevel {
  let worst = 0;
  for (const l of levels) {
    const i = PRECISION_ORDER.indexOf(l ?? 'unknown');
    if (i > worst) worst = i;
  }
  return PRECISION_ORDER[worst] ?? 'unknown';
}

export function check(
  id: CheckResult['id'],
  label: string,
  status: CheckStatus,
  summary: string,
  extra: Partial<Omit<CheckResult, 'id' | 'label' | 'status' | 'summary'>> = {},
): CheckResult {
  return { id, label, status, summary, ...extra };
}

/**
 * Collapse individual checks into one verdict. Missing data is never promoted
 * to "compatible": any `unknown` check caps the verdict at `partial`.
 */
export function verdictOf(checks: CheckResult[]): Verdict {
  if (checks.length === 0) return 'unknown';
  if (checks.some((c) => c.status === 'fail')) return 'incompatible';
  if (checks.every((c) => c.status === 'unknown')) return 'unknown';
  if (checks.some((c) => c.status === 'unknown')) return 'partial';
  if (checks.some((c) => c.status === 'warn')) return 'tight';
  return 'compatible';
}

export function conclusionOf(verdict: Verdict, checks: CheckResult[]): string {
  const failed = checks.filter((c) => c.status === 'fail').map((c) => c.label.toLowerCase());
  const unknown = checks.filter((c) => c.status === 'unknown').map((c) => c.label.toLowerCase());
  switch (verdict) {
    case 'compatible':
      return 'Compatibility verified by geometry.';
    case 'tight':
      return 'Fits, but at least one margin is tight.';
    case 'partial':
      return `Compatibility partially verified — missing data: ${unknown.join(', ')}.`;
    case 'incompatible':
      return `Incompatible — ${failed.join(', ')}.`;
    default:
      return 'Not enough data to decide.';
  }
}

export function makeResult(
  a: ComponentRef,
  b: ComponentRef,
  checks: CheckResult[],
  dataQuality: PrecisionLevel,
  placement?: CompatibilityResult['placement'],
): CompatibilityResult {
  const verdict = verdictOf(checks);
  return { a, b, checks, verdict, conclusion: conclusionOf(verdict, checks), placement, dataQuality };
}

export const fmt = (v: number, digits = 2) => `${v.toFixed(digits)} mm`;
