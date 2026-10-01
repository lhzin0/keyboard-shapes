import type { CheckStatus, ConfidenceInfo, PrecisionLevel, Verdict } from '../types/keyboard';
import { PRECISION_HELP, PRECISION_LABEL, STATUS_ICON, STATUS_WORD, VERDICT_LABEL, cx, precisionTone, verdictTone } from '../utils/format';
import ui from './ui.module.css';

export function PrecisionBadge({ level, score }: { level: PrecisionLevel; score?: number }) {
  return (
    <span className={cx(ui['badge'], ui[precisionTone(level)])} title={`${PRECISION_LABEL[level]}: ${PRECISION_HELP[level]}`}>
      <span className={ui['dot']} aria-hidden="true" />
      {PRECISION_LABEL[level]}
      {score !== undefined && <span className="mono"> {Math.round(score * 100)}%</span>}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: ConfidenceInfo }) {
  return <PrecisionBadge level={confidence.level} score={confidence.score} />;
}

export function StatusBadge({ status, label }: { status: CheckStatus; label?: string }) {
  return (
    <span className={cx(ui['badge'], ui[status])}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span>
      {label ?? STATUS_WORD[status]}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const tone = verdictTone(verdict);
  return (
    <span className={cx(ui['badge'], ui[tone])}>
      <span className={ui['dot']} aria-hidden="true" />
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
