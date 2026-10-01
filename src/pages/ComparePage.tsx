import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PrecisionBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { PartViewer } from '../components/PartViewer';
import ui from '../components/ui.module.css';
import { useDocumentTitle } from '../hooks';
import { catalog } from '../search';
import { getComponent, getKeyboard } from '../services/database';
import { selectionOfItem, selectionKey } from '../services/selection';
import { shapeEntry } from '../services/shapes';
import { MAX_COMPARE, useCompareStore, type CompareItem, type CompareKind } from '../stores';
import type { Case } from '../types/keyboard';
import { cx, mm } from '../utils/format';
import { ShapeOverlay } from '../viewer2d/ShapeOverlay';
import { KeyboardTopView } from '../viewer2d/KeyboardTopView';
import { KeyboardFrontView, KeyboardSideView } from '../viewer2d/ProfileViews';
import styles from './Pages.module.css';

type Tab = 'top' | 'front' | 'side' | '3d' | 'overlay' | 'table';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overlay', label: 'Overlay' },
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: '3d', label: '3D' },
  { id: 'table', label: 'Table' },
];

function parseItems(s: string | null): CompareItem[] {
  if (!s) return [];
  return s
    .split(',')
    .map((p) => {
      const [kind, ...rest] = p.split(':');
      return { kind: kind as CompareKind, id: rest.join(':') };
    })
    .filter((i) => i.kind && i.id);
}

function labelOf(i: CompareItem): string {
  if (i.kind === 'keyboard') {
    const k = getKeyboard(i.id);
    return k ? `${k.brand} ${k.model}` : i.id;
  }
  const c = getComponent(i.kind, i.id) as { brand?: string; model?: string } | undefined;
  return c ? `${c.brand ?? ''} ${c.model ?? i.id}`.trim() : i.id;
}

export default function ComparePage() {
  useDocumentTitle('Compare');
  const [params, setParams] = useSearchParams();
  const store = useCompareStore();
  const [tab, setTab] = useState<Tab>('overlay');
  const [active3d, setActive3d] = useState(0);

  // preload from the URL once (shareable links)
  useEffect(() => {
    const fromUrl = parseItems(params.get('items'));
    if (fromUrl.length) {
      store.clear();
      fromUrl.slice(0, MAX_COMPARE).forEach((i) => store.add(i));
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = store.items;
  const all = useMemo(() => catalog().filter((i) => ['keyboard', 'case', 'pcb', 'plate', 'daughterboard'].includes(i.kind)), []);
  const entries = useMemo(() => items.map((i) => shapeEntry(i)).filter((e): e is NonNullable<typeof e> => !!e), [items]);
  const kinds = new Set(items.map((i) => i.kind));
  const shareUrl = `${location.origin}${location.pathname}?items=${items.map((i) => `${i.kind}:${i.id}`).join(',')}`;

  const rows: Array<[string, (i: CompareItem) => string | undefined, boolean?]> = [
    ['Type', (i) => i.kind],
    ['Width', (i) => mm(shapeEntry(i)?.dimensions.width)],
    ['Depth', (i) => mm(shapeEntry(i)?.dimensions.depth)],
    ['Height', (i) => mm(shapeEntry(i)?.dimensions.height)],
    ['Layout', (i) => (i.kind === 'keyboard' ? getKeyboard(i.id)?.layout.name : catalog().find((c) => c.kind === i.kind && c.id === i.id)?.layout) ?? '—'],
    ['Keys', (i) => String(catalog().find((c) => c.kind === i.kind && c.id === i.id)?.keys ?? '—')],
    [
      'Angle',
      (i) => {
        const a = i.kind === 'case' ? (getComponent<Case>('case', i.id)?.angle) : catalog().find((c) => c.kind === i.kind && c.id === i.id)?.angle;
        return a !== undefined ? `${a}°` : '—';
      },
    ],
    ['Precision', (i) => shapeEntry(i)?.confidence.level ?? '—'],
  ];

  return (
    <div className={styles['page']}>
      <div className={styles['pageHead']}>
        <div>
          <h1>Compare</h1>
          <p className={styles['lead']}>Up to {MAX_COMPARE} keyboards or components. Shape overlap shows visual similarity — use the Build page to check physical compatibility.</p>
        </div>
        <div className={ui['row']}>
          {items.length > 0 && (
            <>
              <button className={ui['btn']} onClick={() => navigator.clipboard?.writeText(shareUrl)} title="Copy a link to this comparison">
                <Icon name="link" size={16} /> Copy link
              </button>
              <button className={ui['btn']} onClick={() => store.clear()}>
                <Icon name="trash" size={16} /> Clear
              </button>
            </>
          )}
        </div>
      </div>

      <div className={ui['cardPad']} style={{ marginBottom: 16, display: 'grid', gap: 12 }}>
        <div className={ui['row']}>
          {items.map((i) => (
            <span key={selectionKey(i)} className={ui['chip']} style={{ gap: 8 }}>
              {labelOf(i)}
              <button onClick={() => store.remove(i)} aria-label={`Remove ${labelOf(i)}`} style={{ background: 'none', border: 'none', padding: 0, display: 'inline-flex' }}>
                <Icon name="x" size={14} />
              </button>
            </span>
          ))}
          {items.length === 0 && <span className={ui['muted']}>Nothing selected yet.</span>}
        </div>
        {items.length < MAX_COMPARE && (
          <label style={{ display: 'grid', gap: 6, maxWidth: 420 }}>
            <span className={ui['label']} style={{ margin: 0 }}>Add</span>
            <select
              className={ui['field']}
              value=""
              onChange={(e) => {
                const [kind, ...rest] = e.target.value.split(':');
                if (kind) store.add({ kind: kind as CompareKind, id: rest.join(':') });
              }}
            >
              <option value="">Choose a keyboard or component…</option>
              {(['keyboard', 'case', 'pcb', 'plate', 'daughterboard'] as const).map((k) => (
                <optgroup key={k} label={k === 'keyboard' ? 'Keyboards' : `${k.toUpperCase()}s`}>
                  {all.filter((i) => i.kind === k && !store.has({ kind: k, id: i.id })).map((i) => (
                    <option key={i.id} value={`${k}:${i.id}`}>{i.title}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {kinds.size > 1 && <p className={ui['notice']}>Mixed types selected: overlays still work (outlines are drawn together), but a PCB and a case compare different things.</p>}
      </div>

      {items.length === 0 ? (
        <div className={styles['empty']}>
          <strong>Pick two or more items to compare</strong>
          <span>Use “+ Compare” on any card, or try an example:</span>
          <Link className={cx(ui['btn'], ui['primary'])} to="/compare?items=keyboard:ref-60,keyboard:ref-65,keyboard:ref-tkl">60% vs 65% vs TKL</Link>
        </div>
      ) : (
        <>
          <div className={styles['tabs']} role="tablist" aria-label="Comparison views">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={styles['tab']} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overlay' && (entries.length >= 2 ? <ShapeOverlay key={entries.map((e) => e.key).join('|')} entries={entries} /> : <p className={ui['muted']}>Add at least two items for an overlay.</p>)}

          {(tab === 'top' || tab === 'front' || tab === 'side') && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap: 14 }}>
              {items.map((i) => {
                const sel = selectionOfItem(i);
                return (
                  <section key={selectionKey(i)} className={ui['cardPad']} aria-label={labelOf(i)}>
                    <h3 style={{ fontSize: 15, marginBottom: 8 }}>{labelOf(i)}</h3>
                    <div style={{ height: 380 }}>
                      {sel && tab === 'top' && <KeyboardTopView selection={sel} showMeasurePanel={false} />}
                      {sel && tab === 'front' && <KeyboardFrontView selection={sel} />}
                      {sel && tab === 'side' && <KeyboardSideView selection={sel} />}
                      {!sel && <p className={ui['muted']}>No geometry.</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {tab === '3d' && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className={ui['row']}>
                {items.map((i, idx) => (
                  <button key={selectionKey(i)} className={ui['chip']} aria-pressed={active3d === idx} onClick={() => setActive3d(idx)}>
                    {labelOf(i)}
                  </button>
                ))}
              </div>
              {(() => {
                const it = items[Math.min(active3d, items.length - 1)];
                const sel = it ? selectionOfItem(it) : null;
                return it && sel ? <PartViewer key={selectionKey(it)} selection={sel} modelKey={selectionKey(it)} defaultView="3d" hide={['top', 'side', 'front']} /> : <p className={ui['muted']}>No geometry.</p>;
              })()}
              <p className={ui['muted']} style={{ fontSize: 13 }}>One 3D viewer at a time keeps phones responsive.</p>
            </div>
          )}

          {tab === 'table' && (
            <div className={cx(ui['card'], styles['compareTable'])}>
              <table className={ui['table']}>
                <thead>
                  <tr>
                    <th />
                    {items.map((i) => (
                      <th key={selectionKey(i)} scope="col">{labelOf(i)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([label, get]) => {
                    const vals = items.map((i) => get(i) ?? '—');
                    const differs = new Set(vals).size > 1;
                    return (
                      <tr key={label}>
                        <th scope="row">{label}</th>
                        {vals.map((v, idx) => (
                          <td key={idx} className={cx('mono', differs && styles['diffCell'])}>{v}</td>
                        ))}
                      </tr>
                    );
                  })}
                  <tr>
                    <th scope="row">Data quality</th>
                    {entries.map((e) => (
                      <td key={e.key}><PrecisionBadge level={e.confidence.level as 'estimated'} score={e.confidence.score} /></td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
