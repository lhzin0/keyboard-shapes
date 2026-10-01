import { useCallback, useState } from 'react';
import { Icon } from '../components/Icon';
import ui from '../components/ui.module.css';
import { distance } from '../geometry/shape';
import type { Point2D } from '../types/keyboard';
import { cx } from '../utils/format';
import { useStage } from './SvgStage';
import styles from './Viewer2D.module.css';

export interface Measurement2D {
  id: number;
  a: Point2D;
  b: Point2D;
}

/**
 * Two-click measuring in millimetres. Clicks snap to the nearest point of interest
 * (outline vertices, holes, key centres) when one is within ~12 px.
 */
export function useMeasure(snapPoints: Point2D[]) {
  const [active, setActive] = useState(false);
  const [items, setItems] = useState<Measurement2D[]>([]);
  const [pending, setPending] = useState<Point2D | null>(null);
  const [nextId, setNextId] = useState(1);

  const snap = useCallback(
    (p: Point2D, k: number): Point2D => {
      const r = 12 / k;
      let best: Point2D | null = null;
      let bd = r;
      for (const s of snapPoints) {
        const d = distance(p, s);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best ?? p;
    },
    [snapPoints],
  );

  const tap = useCallback(
    (mm: Point2D, k: number) => {
      if (!active) return;
      const p = snap(mm, k);
      if (!pending) setPending(p);
      else {
        setItems((it) => [...it, { id: nextId, a: pending, b: p }]);
        setNextId((n) => n + 1);
        setPending(null);
      }
    },
    [active, pending, snap, nextId],
  );

  return {
    active,
    setActive: (v: boolean) => {
      setActive(v);
      if (!v) setPending(null);
    },
    items,
    pending,
    tap,
    clear: () => {
      setItems([]);
      setPending(null);
    },
    undo: () => (pending ? setPending(null) : setItems((it) => it.slice(0, -1))),
    add: (a: Point2D, b: Point2D) => {
      setItems((it) => [...it, { id: nextId, a, b }]);
      setNextId((n) => n + 1);
    },
  };
}

export type MeasureApi = ReturnType<typeof useMeasure>;

/** SVG layer: finished measurements + the pending first point. */
export function MeasureLayer({ items, pending }: { items: Measurement2D[]; pending: Point2D | null }) {
  const { k } = useStage();
  const fs = 12 / k;
  return (
    <g>
      {items.map((m) => {
        const d = distance(m.a, m.b);
        const mx = (m.a.x + m.b.x) / 2;
        const my = (m.a.y + m.b.y) / 2;
        return (
          <g key={m.id}>
            <line className={styles['dim']} x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} />
            <circle className={styles['snap']} cx={m.a.x} cy={m.a.y} r={4 / k} />
            <circle className={styles['snap']} cx={m.b.x} cy={m.b.y} r={4 / k} />
            <text className={styles['dimText']} x={mx} y={my - 6 / k} fontSize={fs}>
              {d.toFixed(2)} mm
            </text>
          </g>
        );
      })}
      {pending && <circle className={styles['snap']} cx={pending.x} cy={pending.y} r={6 / k} />}
    </g>
  );
}

/** Dimension line along one axis with end ticks and a label. */
export function DimLine({ a, b, label, offset = 0 }: { a: Point2D; b: Point2D; label: string; offset?: number }) {
  const { k } = useStage();
  const horizontal = Math.abs(a.y - b.y) < Math.abs(a.x - b.x);
  const o = offset / k;
  const p1 = horizontal ? { x: a.x, y: a.y + o } : { x: a.x + o, y: a.y };
  const p2 = horizontal ? { x: b.x, y: b.y + o } : { x: b.x + o, y: b.y };
  const t = 5 / k;
  return (
    <g>
      <line className={styles['dim']} x1={a.x} y1={a.y} x2={p1.x} y2={p1.y} strokeDasharray="2 3" opacity={0.6} />
      <line className={styles['dim']} x1={b.x} y1={b.y} x2={p2.x} y2={p2.y} strokeDasharray="2 3" opacity={0.6} />
      <line className={styles['dim']} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />
      {horizontal ? (
        <>
          <line className={styles['dim']} x1={p1.x} y1={p1.y - t} x2={p1.x} y2={p1.y + t} />
          <line className={styles['dim']} x1={p2.x} y1={p2.y - t} x2={p2.x} y2={p2.y + t} />
          <text className={styles['dimText']} x={(p1.x + p2.x) / 2} y={p1.y - 6 / k} fontSize={12 / k}>
            {label}
          </text>
        </>
      ) : (
        <>
          <line className={styles['dim']} x1={p1.x - t} y1={p1.y} x2={p1.x + t} y2={p1.y} />
          <line className={styles['dim']} x1={p2.x - t} y1={p2.y} x2={p2.x + t} y2={p2.y} />
          <text className={styles['dimText']} x={p1.x + 8 / k} y={(p1.y + p2.y) / 2} fontSize={12 / k} textAnchor="start" transform={`rotate(0)`}>
            {label}
          </text>
        </>
      )}
    </g>
  );
}

/** Side panel/sheet content for the measuring tool. */
export function MeasurePanel({ api, extra }: { api: MeasureApi; extra?: { label: string; a: Point2D; b: Point2D }[] }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className={ui['row']}>
        <button className={cx(ui['btn'], ui['small'])} aria-pressed={api.active} onClick={() => api.setActive(!api.active)}>
          <Icon name="ruler" size={16} />
          {api.active ? 'Measuring…' : 'Measure'}
        </button>
        <button className={cx(ui['btn'], ui['small'])} onClick={api.undo} disabled={!api.items.length && !api.pending}>
          Undo
        </button>
        <button className={cx(ui['btn'], ui['small'])} onClick={api.clear} disabled={!api.items.length && !api.pending}>
          Clear
        </button>
      </div>
      {api.active && <p className={ui['muted']} style={{ fontSize: 13 }}>Tap point A, then point B. Taps snap to vertices, holes and key centres.</p>}
      {extra && extra.length > 0 && (
        <div className={ui['row']}>
          {extra.map((e) => (
            <button key={e.label} className={cx(ui['chip'])} onClick={() => api.add(e.a, e.b)}>
              + {e.label}
            </button>
          ))}
        </div>
      )}
      {api.items.length > 0 && (
        <table className={ui['table']}>
          <thead>
            <tr>
              <th>#</th>
              <th>Distance</th>
              <th>Δx</th>
              <th>Δy</th>
            </tr>
          </thead>
          <tbody>
            {api.items.map((m) => (
              <tr key={m.id}>
                <td>{m.id}</td>
                <td className="mono">{distance(m.a, m.b).toFixed(2)} mm</td>
                <td className="mono">{Math.abs(m.b.x - m.a.x).toFixed(2)}</td>
                <td className="mono">{Math.abs(m.b.y - m.a.y).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
