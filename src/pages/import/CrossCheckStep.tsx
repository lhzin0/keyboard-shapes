import { useMemo, useState } from 'react';
import { PrecisionBadge } from '../../components/Badges';
import ui from '../../components/ui.module.css';
import type { Reconciled } from '../../import/CrossReference';
import type { LookupResult } from '../../import/lookup';
import { cx, num } from '../../utils/format';
import styles from '../Pages.module.css';

const STATUS_TEXT: Record<string, string> = {
  ok: 'searched',
  'no-match': 'no matching product',
  denied: 'robots.txt disallows search',
  error: 'error',
};

function Row({ label, r, unit }: { label: string; r?: Reconciled<number | string>; unit?: string }) {
  if (!r) {
    return (
      <tr>
        <th scope="row">{label}</th>
        <td colSpan={4} className={ui['muted']}>unknown — no source published it</td>
      </tr>
    );
  }
  const conflict = r.conflicts.length > 0;
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="mono">{typeof r.value === 'number' ? num(r.value, 1) : r.value}{unit ? ` ${unit}` : ''}</td>
      <td><PrecisionBadge level={r.level} score={r.confidence} /></td>
      <td className="mono">{r.supporters.length} site{r.supporters.length === 1 ? '' : 's'}: {r.supporters.map((s) => s.siteName).join(', ')}</td>
      <td className={cx(conflict && ui['warn'])} style={{ fontSize: 13 }}>{conflict ? r.note : '—'}</td>
    </tr>
  );
}

/**
 * Multi-site cross-check. Browsers cannot search shops (CORS), so the search runs where it can —
 * `npm run lookup` or the "Lookup" GitHub Action — and this panel loads its JSON result.
 */
export function CrossCheckStep({ onApply }: { onApply(result: LookupResult): void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  const load = (raw: string) => {
    try {
      const j = JSON.parse(raw) as LookupResult;
      if (!j || !Array.isArray(j.sites) || !j.reconciled || typeof j.query !== 'string') throw new Error('This is not a KeyboardShapes lookup result (expected the file written by --json).');
      setResult(j);
      setError(null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const raw = await f.text();
    setText(raw.length > 200_000 ? '' : raw);
    load(raw);
    e.target.value = '';
  };

  const r = result?.reconciled;
  const contributing = useMemo(() => result?.sites.filter((s) => s.imports.some((i) => i.status === 'ok')) ?? [], [result]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className={ui['muted']} style={{ fontSize: 14 }}>
        The multi-site search queries the public search of many shops (only endpoints their robots.txt allows), reads each matching product page and cross-checks the numbers. Run it where network rules allow:
      </p>
      <pre className="mono" style={{ margin: 0, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, overflowX: 'auto', fontSize: 12.5 }}>
        npm run lookup -- --q=&quot;madlions mad60he&quot; --json=lookup.json
      </pre>
      <p className={ui['muted']} style={{ fontSize: 13 }}>
        …or run the <strong>Lookup</strong> workflow in GitHub Actions and download its artifact. Then load the file here:
      </p>
      <div className={ui['row']}>
        <label className={cx(ui['btn'])} style={{ cursor: 'pointer' }}>
          Choose lookup.json
          <input type="file" accept="application/json,.json" className="sr-only" onChange={onFile} />
        </label>
      </div>
      <textarea className={ui['field']} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste the JSON here" aria-label="Lookup JSON" />
      <div>
        <button className={cx(ui['btn'], ui['primary'])} disabled={!text.trim()} onClick={() => load(text)}>Read result</button>
      </div>
      {error && <p className={ui['noticeFail']} role="alert">{error}</p>}

      {result && r && (
        <div style={{ display: 'grid', gap: 12 }}>
          <h3 style={{ fontSize: 15 }}>
            “{result.query}” <span className={ui['muted']} style={{ fontWeight: 400, fontSize: 13 }}>· {result.at.slice(0, 10)} · {contributing.length} of {result.sites.length} sites contributed</span>
          </h3>
          <div className={styles['compareTable']}>
            <table className={ui['table']}>
              <thead>
                <tr><th>Field</th><th>Value</th><th>Precision</th><th>Agreeing sites</th><th>Disagreement</th></tr>
              </thead>
              <tbody>
                <Row label="Width" r={r.width} unit="mm" />
                <Row label="Depth" r={r.depth} unit="mm" />
                <Row label="Height" r={r.height} unit="mm" />
                <Row label="Front height" r={r.frontHeight} unit="mm" />
                <Row label="Rear height" r={r.rearHeight} unit="mm" />
                <Row label="Layout" r={r.layout} />
                <Row label="Weight" r={r.weightG} unit="g" />
              </tbody>
            </table>
          </div>
          {r.angleDeg !== undefined && <p className={ui['muted']} style={{ fontSize: 13 }}>Typing angle {r.angleDeg}° — derived from front/rear height and depth.</p>}
          {r.warnings.map((w) => (
            <p key={w} className={ui['noticeWarn']}>⚠ {w}</p>
          ))}
          <p className={ui['muted']} style={{ fontSize: 12.5 }}>
            Agreement raises confidence, never precision: only a manufacturer source can make a value “official”. Several pages of one shop count as one voice.
          </p>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Per-site report ({result.sites.length})</summary>
            <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6, fontSize: 13 }}>
              {result.sites.map((s) => (
                <li key={s.site.id}>
                  <strong>{s.site.name}</strong> <span className={ui['muted']}>({s.site.role}) — {STATUS_TEXT[s.status] ?? s.status}{s.message ? `: ${s.message}` : ''}</span>
                  {s.imports.filter((i) => i.status !== 'skipped-low-relevance').map((i) => (
                    <div key={i.url} style={{ paddingLeft: 12 }} className={ui['muted']}>
                      {i.status === 'ok' ? '✓' : i.status === 'blocked' ? '✕ blocked (not bypassed)' : '⚠'} {i.title.slice(0, 70)}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </details>
          <div>
            <button className={cx(ui['btn'], ui['primary'])} onClick={() => onApply(result)}>Use these values</button>
          </div>
        </div>
      )}
    </div>
  );
}
