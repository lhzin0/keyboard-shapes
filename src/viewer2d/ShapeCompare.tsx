/**
 * Size comparison of every side of the keyboards: top, front and side outlines drawn together on black,
 * one scale in millimetres, centred on a shared axis (the desk is the common baseline for front and side).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useElementSize } from '../hooks';
import { boundsOf, type Bounds } from '../geometry/shape';
import type { Silhouette } from '../services/silhouettes';
import type { Point2D } from '../types/keyboard';
import styles from './ShapeCompare.module.css';

export interface CompareLayer {
  key: string;
  color: string;
  top: Point2D[];
  front: Silhouette | null;
  side: Silhouette | null;
}

interface Props {
  layers: CompareLayer[];
  /** Screen area covered by floating UI; the drawing is centred in what is left. */
  insets: { left: number; top: number; bottom: number };
}

const GAP = 24;
const PAD = 28;

const path = (pts: Point2D[]) => `M${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`;
const shift = (pts: Point2D[], dx: number, dy: number) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
const union = (bs: Bounds[]): Bounds => ({
  minX: Math.min(...bs.map((b) => b.minX)),
  minY: Math.min(...bs.map((b) => b.minY)),
  maxX: Math.max(...bs.map((b) => b.maxX)),
  maxY: Math.max(...bs.map((b) => b.maxY)),
});
/** Moves an outline so its horizontal centre is 0 (and, for the top view, its vertical centre too). */
const centre = (pts: Point2D[], vertical: boolean) => {
  const b = boundsOf(pts);
  return shift(pts, -(b.minX + b.maxX) / 2, vertical ? -(b.minY + b.maxY) / 2 : 0);
};

interface Drawn {
  key: string;
  color: string;
  d: string;
  box: boolean;
}

/** Top view, then the front view, then the side view: stacked, all centred on the same vertical axis, one scale. */
function arrange(layers: CompareLayer[]) {
  const views = [
    { name: 'TOP', items: layers.map((l) => ({ l, pts: centre(l.top, true), box: false })), base: false },
    { name: 'FRONT', items: layers.flatMap((l) => (l.front ? [{ l, pts: centre(l.front.points, false), box: l.front.box }] : [])), base: true },
    { name: 'SIDE', items: layers.flatMap((l) => (l.side ? [{ l, pts: centre(l.side.points, false), box: l.side.box }] : [])), base: true },
  ].filter((v) => v.items.length > 0);

  const shapes: Drawn[] = [];
  const labels: Array<{ text: string; x: number; y: number }> = [];
  const desks: Array<{ x1: number; x2: number; y: number }> = [];
  const bounds: Bounds[] = [];
  let y = 0;
  for (const v of views) {
    const b = union(v.items.map((i) => boundsOf(i.pts)));
    // move the view down to its slot; for front and side y = 0 (the desk) ends up at dy
    const dy = y - b.minY;
    for (const { l, pts, box } of v.items) shapes.push({ key: l.key, color: l.color, d: path(shift(pts, 0, dy)), box });
    labels.push({ text: v.name, x: b.minX, y: y - 5 });
    if (v.base) desks.push({ x1: b.minX - 8, x2: b.maxX + 8, y: dy });
    bounds.push({ minX: b.minX, maxX: b.maxX, minY: y - 14, maxY: y + (b.maxY - b.minY) });
    y += b.maxY - b.minY + GAP + 14;
  }
  return { shapes, labels, desks, bounds: bounds.length ? union(bounds) : null };
}

export function ShapeCompare({ layers, insets }: Props) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [vp, setVp] = useState({ k: 1, tx: 0, ty: 0 });
  const [free, setFree] = useState(false);
  const scene = useMemo(() => arrange(layers), [layers]);

  const fit = useCallback(() => {
    const b = scene.bounds;
    if (!b || !size.width || !size.height) return;
    const w = Math.max(120, size.width - insets.left - PAD * 2);
    const h = Math.max(120, size.height - insets.top - insets.bottom - PAD * 2);
    const k = Math.min(w / Math.max(b.maxX - b.minX, 1), h / Math.max(b.maxY - b.minY, 1));
    setVp({ k, tx: insets.left + PAD + w / 2 - ((b.minX + b.maxX) / 2) * k, ty: insets.top + PAD + h / 2 - ((b.minY + b.maxY) / 2) * k });
  }, [scene.bounds, size.width, size.height, insets.left, insets.top, insets.bottom]);

  // re-fit whenever the content or the space changes, unless the user zoomed or panned
  useEffect(() => setFree(false), [layers]);
  useEffect(() => {
    if (!free) fit();
  }, [free, fit]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setFree(true);
      setVp((v) => {
        const k = Math.min(80, Math.max(0.2, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, tx: px - ((px - v.tx) * k) / v.k, ty: py - ((py - v.ty) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);

  const last = useRef<{ x: number; y: number } | null>(null);
  const stroke = { strokeWidth: 1.6, vectorEffect: 'non-scaling-stroke' as const, fill: 'none', strokeLinejoin: 'round' as const };

  return (
    <div
      ref={ref}
      className={styles['canvas']}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const p = last.current;
        if (!p) return;
        last.current = { x: e.clientX, y: e.clientY };
        setFree(true);
        setVp((v) => ({ ...v, tx: v.tx + e.clientX - p.x, ty: v.ty + e.clientY - p.y }));
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
      onDoubleClick={() => setFree(false)}
      role="img"
      aria-label="Top, front and side outlines of the selected keyboards, drawn to the same scale"
    >
      <svg width="100%" height="100%">
        <g transform={`translate(${vp.tx} ${vp.ty}) scale(${vp.k})`}>
          {scene.desks.map((d) => (
            <line key={d.y} x1={d.x1} x2={d.x2} y1={d.y} y2={d.y} className={styles['desk']} vectorEffect="non-scaling-stroke" />
          ))}
          {scene.shapes.map((s, i) => (
            <path key={`${i}${s.key}`} d={s.d} stroke={s.color} strokeDasharray={s.box ? '5 4' : undefined} {...stroke} />
          ))}
          {scene.labels.map((l) => (
            <text key={l.text} x={l.x} y={l.y} fontSize={11 / vp.k} className={styles['label']}>
              {l.text}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}
