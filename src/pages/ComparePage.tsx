import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useDocumentTitle, useIsMobile } from '../hooks';
import { catalog, type CatalogItem } from '../search';
import { silhouettes } from '../services/silhouettes';
import { shapeEntry } from '../services/shapes';
import { MAX_COMPARE, useCompareStore, type CompareItem } from '../stores';
import { ShapeCompare, type CompareLayer } from '../viewer2d/ShapeCompare';
import styles from './Compare.module.css';

const COLORS = ['#00c8ff', '#ff2bd6', '#ffe600', '#3dff8b', '#ff8a2b', '#a78bff'];
const KINDS = ['keyboard', 'case', 'pcb', 'plate', 'daughterboard'];
const EXAMPLES = [
  { label: '60% vs 65% vs TKL', items: 'keyboard:ref-60,keyboard:ref-65,keyboard:ref-tkl' },
  { label: 'Wooting 60HE+ vs v2', items: 'keyboard:imp-wooting-60he,keyboard:imp-wooting-60he-v2' },
];

const keyOf = (i: { kind: string; id: string }) => `${i.kind}:${i.id}`;
const fmt = (n: number | undefined) => (n === undefined ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));

function parseItems(s: string | null): CompareItem[] {
  return (s ?? '')
    .split(',')
    .map((p) => {
      const [kind, ...rest] = p.split(':');
      return { kind, id: rest.join(':') } as CompareItem;
    })
    .filter((i) => i.kind && i.id);
}

export default function ComparePage() {
  useDocumentTitle('Compare');
  const [params, setParams] = useSearchParams();
  const { items, add, remove, clear } = useCompareStore();
  const mobile = useIsMobile();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  // shareable link: ?items=keyboard:a,keyboard:b
  useEffect(() => {
    const fromUrl = parseItems(params.get('items'));
    if (!fromUrl.length) return;
    clear();
    fromUrl.slice(0, MAX_COMPARE).forEach(add);
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(
    () =>
      items.flatMap((item, i) => {
        const entry = shapeEntry(item);
        if (!entry) return [];
        const { front, side } = silhouettes(item, entry);
        const layer: CompareLayer = { key: keyOf(item), color: COLORS[i % COLORS.length]!, top: entry.shape.points, front, side };
        return [{ item, entry, layer }];
      }),
    [items],
  );
  const layers = useMemo(() => rows.map((r) => r.layer), [rows]);

  const results = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const taken = new Set(items.map(keyOf));
    return catalog()
      .filter((c: CatalogItem) => KINDS.includes(c.kind) && !taken.has(keyOf(c)) && tokens.every((t) => c.text.includes(t) || c.title.toLowerCase().includes(t)))
      .sort((a, b) => Number(b.kind === 'keyboard') - Number(a.kind === 'keyboard'))
      .slice(0, 8);
  }, [q, items]);

  const pick = (c: CatalogItem) => {
    add({ kind: c.kind, id: c.id } as CompareItem);
    setQ('');
    setOpen(false);
  };

  const full = items.length >= MAX_COMPARE;
  const insets = { left: !mobile && rows.length ? 400 : 0, top: 76, bottom: mobile && rows.length ? Math.min(230, 60 + rows.length * 72) : 24 };

  return (
    <div className={styles['root']}>
      <ShapeCompare layers={layers} insets={insets} />

      <div className={styles['search']}>
        <Icon name="search" size={16} />
        <input
          value={q}
          disabled={full}
          placeholder={full ? `Up to ${MAX_COMPARE} items` : 'Add keyboard to comparison'}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) pick(results[0]);
            if (e.key === 'Escape') setOpen(false);
          }}
          aria-label="Add keyboard to comparison"
        />
        {rows.length > 0 && (
          <button onClick={clear} aria-label="Remove all" title="Remove all">
            <Icon name="reset" size={16} />
          </button>
        )}
        {open && results.length > 0 && !full && (
          <ul className={styles['results']}>
            {results.map((c) => (
              <li key={keyOf(c)}>
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
                  <span>{c.title}</span>
                  <small>{c.subtitle}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {rows.length > 0 ? (
        <ul className={styles['list']}>
          {rows.map(({ item, entry, layer }) => (
            <li key={layer.key}>
              <span className={styles['swatch']} style={{ background: layer.color }} />
              <div className={styles['info']}>
                <strong>{entry.label}</strong>
                <span className="mono">
                  {fmt(entry.dimensions.width)} × {fmt(entry.dimensions.depth)} × {fmt(entry.dimensions.height)} mm
                  {entry.weight !== undefined && <> · {Math.round(entry.weight)} g</>}
                </span>
                {(!layer.front || layer.front.box) && <small>{layer.front ? 'Front and side: overall height only' : 'Front and side: height not known'}</small>}
              </div>
              <button onClick={() => remove(item)} aria-label={`Remove ${entry.label}`}>
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles['empty']}>
          <strong>Compare the size of keyboards</strong>
          <span>Search above, or try an example:</span>
          <div>
            {EXAMPLES.map((e) => (
              <Link key={e.items} to={`/compare?items=${e.items}`}>
                {e.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
