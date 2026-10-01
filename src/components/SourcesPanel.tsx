import type { ConfidenceInfo, Measurement, SourceInfo } from '../types/keyboard';
import { PRECISION_HELP, PRECISION_LABEL, cx } from '../utils/format';
import { ConfidenceBadge, PrecisionBadge } from './Badges';
import ui from './ui.module.css';

export function SourcesPanel({ sources, confidence, dimensionNote }: { sources: SourceInfo[]; confidence: ConfidenceInfo; dimensionNote?: string }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className={ui['row']}>
        <ConfidenceBadge confidence={confidence} />
        <span className={ui['muted']} style={{ fontSize: 13 }}>{PRECISION_HELP[confidence.level]}</span>
      </div>
      {confidence.notes && <p className={cx(ui['muted'])} style={{ fontSize: 13 }}>{confidence.notes}</p>}
      {dimensionNote && <p className={ui['muted']} style={{ fontSize: 13 }}>{dimensionNote}</p>}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
        {sources.map((s, i) => (
          <li key={i} style={{ display: 'grid', gap: 2, fontSize: 13 }}>
            <span>
              <strong>{s.sourceName}</strong> <span className={ui['muted']}>· {s.sourceType}</span>
            </span>
            <span className={ui['muted']}>
              {s.method} · confidence <span className="mono">{Math.round(s.confidence * 100)}%</span> · {s.retrievedAt.slice(0, 10)}
            </span>
            {s.sourceUrl && (
              <a href={s.sourceUrl} target="_blank" rel="noreferrer noopener" style={{ overflowWrap: 'anywhere' }}>
                {s.sourceUrl}
              </a>
            )}
          </li>
        ))}
        {sources.length === 0 && <li className={ui['muted']}>No source recorded.</li>}
      </ul>
    </div>
  );
}

/** A measurement with its provenance. */
export function MeasurementValue({ m }: { m: Measurement }) {
  if (m.value === null) return <span className={ui['muted']}>unknown</span>;
  return (
    <span>
      <span className="mono">{m.value} {m.unit}</span>{' '}
      <span className={ui['muted']} style={{ fontSize: 12 }} title={m.method}>
        ({m.source}, {Math.round(m.confidence * 100)}%)
      </span>
    </span>
  );
}

export { PrecisionBadge, PRECISION_LABEL };
