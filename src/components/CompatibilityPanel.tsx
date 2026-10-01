import type { BuildEvaluation } from '../compatibility/CompatibilityEngine';
import type { CheckResult, CompatibilityResult, PrecisionLevel, Verdict } from '../types/keyboard';
import { PRECISION_LABEL, VERDICT_LABEL, cx, STATUS_ICON, mm } from '../utils/format';
import { StatusBadge, VerdictBadge } from './Badges';
import styles from './Cards.module.css';
import ui from './ui.module.css';

function QualityNote({ level }: { level: PrecisionLevel }) {
  if (level === 'official' || level === 'cad' || level === 'measured') return null;
  return (
    <p className={cx(ui['notice'], level === 'estimated' || level === 'unknown' ? ui['noticeWarn'] : undefined)}>
      <span aria-hidden="true">ⓘ</span>
      <span>
        Verdict based on <strong>{PRECISION_LABEL[level].toLowerCase()}</strong> data. Geometry was checked, but the inputs are not measurements of a real product.
      </span>
    </p>
  );
}

export function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <div role="list">
      {checks.map((c, i) => (
        <div key={`${c.id}-${i}`} className={styles['check']} role="listitem">
          <div className={styles['checkLabel']}>{c.label}</div>
          <div>
            <div className={styles['checkRow']}>
              <StatusBadge status={c.status} label={c.status === 'ok' ? (c.valueMm !== undefined && c.id === 'clearance' ? mm(c.valueMm, 1) : 'Compatible') : undefined} />
            </div>
            <div className={styles['checkText']}>{c.summary}</div>
            {c.details?.map((d) => (
              <div key={d} className={styles['checkText']}>
                {STATUS_ICON[c.status]} {d}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function VerdictHeader({ verdict, conclusion }: { verdict: Verdict; conclusion: string }) {
  return (
    <div className={styles['verdict']}>
      <div className={ui['row']}>
        <VerdictBadge verdict={verdict} />
      </div>
      <div className={styles['verdictTitle']}>{conclusion}</div>
    </div>
  );
}

/** Whole-build summary: one row per category plus conclusion, placement notes and collisions. */
export function BuildCompatibility({ evaluation }: { evaluation: BuildEvaluation }) {
  if (evaluation.summary.length === 0) {
    return (
      <p className={ui['muted']}>
        Nothing to verify yet: compatibility checks need geometry for at least two kinds of parts (for example a case and a PCB). With less than that every check is <strong>unknown</strong> — never “compatible”.
      </p>
    );
  }
  const assumed = Object.entries(evaluation.placements).filter(([, p]) => p && p.method === 'center');
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <VerdictHeader verdict={evaluation.verdict} conclusion={evaluation.conclusion} />
      <CheckList checks={evaluation.summary} />
      {assumed.length > 0 && <p className={ui['notice']}>Position of {assumed.map(([k]) => k).join(', ')} was assumed (centred) because mounting points did not register.</p>}
      {evaluation.collisions.length > 0 && (
        <div className={ui['noticeFail']}>
          <span aria-hidden="true">✕</span>
          <span>
            <strong>{evaluation.collisions.length} collision{evaluation.collisions.length > 1 ? 's' : ''} detected</strong> — marked in red in the views.
          </span>
        </div>
      )}
      <QualityNote level={evaluation.dataQuality} />
    </div>
  );
}

/** One pair result (used by "Find compatible"). */
export function PairResult({ result }: { result: CompatibilityResult }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className={ui['row']}>
        <VerdictBadge verdict={result.verdict} />
        <span className={ui['muted']} style={{ fontSize: 13 }}>{result.conclusion}</span>
      </div>
      <CheckList checks={result.checks} />
      <QualityNote level={result.dataQuality} />
    </div>
  );
}

export { VERDICT_LABEL };
