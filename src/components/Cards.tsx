import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { boundsOf } from '../geometry/shape';
import type { CatalogItem } from '../search';
import { getComponent, getKeyboard, resolveKeyboard } from '../services/database';
import { useCompareStore } from '../stores';
import type { Case, ComponentType, Daughterboard, PCB, Plate, Point2D, Shape } from '../types/keyboard';
import { PRECISION_LABEL, cx } from '../utils/format';
import { PrecisionBadge } from './Badges';
import styles from './Cards.module.css';
import ui from './ui.module.css';

/** Tiny SVG preview of an outline. */
export function ShapeThumb({ shape, extra, label }: { shape?: Shape; extra?: Point2D[][]; label: string }) {
  const view = useMemo(() => {
    if (!shape) return null;
    const b = boundsOf(shape.points);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const pad = Math.max(w, h) * 0.04;
    const d = `M${shape.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}Z`;
    return { box: `${b.minX - pad} ${b.minY - pad} ${w + 2 * pad} ${h + 2 * pad}`, d };
  }, [shape]);
  if (!view) return <div className={ui['muted']} style={{ fontSize: 12 }}>No outline</div>;
  return (
    <svg viewBox={view.box} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <path d={view.d} fill="color-mix(in srgb, var(--draw-case) 18%, transparent)" stroke="var(--draw-case)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {extra?.map((pts, i) => (
        <path key={i} d={`M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}Z`} fill="none" stroke="var(--draw-pcb)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" opacity={0.7} />
      ))}
    </svg>
  );
}

/** Outline of a catalog item, resolved from the database. */
export function outlineOf(item: Pick<CatalogItem, 'kind' | 'id'>): { shape?: Shape; inner?: Point2D[] } {
  if (item.kind === 'keyboard') {
    const kb = getKeyboard(item.id);
    if (!kb) return {};
    const parts = resolveKeyboard(kb);
    return { shape: kb.shape ?? parts.case?.externalShape, inner: parts.case?.internalCavity?.points };
  }
  const c = getComponent(item.kind as ComponentType, item.id);
  if (!c) return {};
  if (item.kind === 'case') return { shape: (c as Case).externalShape, inner: (c as Case).internalCavity?.points };
  if (item.kind === 'pcb') return { shape: (c as PCB).outline };
  if (item.kind === 'plate') return { shape: (c as Plate).outline };
  if (item.kind === 'daughterboard') return { shape: (c as Daughterboard).outline };
  return {};
}

export function ItemCard({ item, compact }: { item: CatalogItem; compact?: boolean }) {
  const { shape, inner } = useMemo(() => outlineOf(item), [item]);
  const compare = useCompareStore();
  const ref = { kind: item.kind, id: item.id } as const;
  const inCompare = compare.has(ref);
  return (
    <article className={styles['card']}>
      <Link to={item.href} className={styles['thumb']} aria-label={`Open ${item.title}`}>
        <ShapeThumb shape={shape} extra={inner ? [inner] : undefined} label={`${item.title} outline`} />
      </Link>
      <div className={styles['body']}>
        <Link to={item.href} className={styles['title']} style={{ color: 'var(--text)' }}>
          {item.title}
        </Link>
        <span className={styles['sub']}>{item.subtitle}</span>
        <div className={styles['actions']}>
          <PrecisionBadge level={item.confidence.level} />
          {!compact && ['keyboard', 'case', 'pcb', 'plate', 'daughterboard'].includes(item.kind) && (
            <button className={cx(ui['btn'], ui['small'])} aria-pressed={inCompare} onClick={() => compare.toggle(ref)} title={inCompare ? 'Remove from compare' : 'Add to compare (up to 4)'}>
              {inCompare ? '✓ Comparing' : '+ Compare'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function KV({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className={styles['kv']}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export { styles as cardStyles, PRECISION_LABEL };
