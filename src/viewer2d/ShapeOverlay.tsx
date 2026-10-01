import { useMemo, useState } from 'react';
import { Slider, Segmented } from '../components/Panels';
import ui from '../components/ui.module.css';
import { boundsOf, overlapStats, translatePoints, type Bounds } from '../geometry/shape';
import type { ShapeEntry } from '../services/shapes';
import type { Point2D } from '../types/keyboard';
import { cx } from '../utils/format';
import { SvgStage } from './SvgStage';
import styles from './Viewer2D.module.css';

export type Alignment = 'center' | 'front' | 'back' | 'usb' | 'custom';

const COLORS = ['var(--info)', 'var(--warn)', 'var(--ok)', 'var(--danger)'];

const polyPath = (pts: Point2D[]) => `M${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`;

/** Offset that places `b` relative to `a` for the chosen alignment. */
export function alignmentOffset(a: ShapeEntry, b: ShapeEntry, mode: Alignment, custom: Point2D): Point2D {
  const ba = boundsOf(a.shape.points);
  const bb = boundsOf(b.shape.points);
  const cxa = (ba.minX + ba.maxX) / 2;
  const cxb = (bb.minX + bb.maxX) / 2;
  switch (mode) {
    case 'center':
      return { x: cxa - cxb, y: (ba.minY + ba.maxY) / 2 - (bb.minY + bb.maxY) / 2 };
    case 'front':
      return { x: cxa - cxb, y: ba.maxY - bb.maxY };
    case 'back':
      return { x: cxa - cxb, y: ba.minY - bb.minY };
    case 'usb':
      return a.usb && b.usb ? { x: a.usb.x - b.usb.x, y: a.usb.y - b.usb.y } : { x: cxa - cxb, y: ba.maxY - bb.maxY };
    case 'custom':
      return custom;
  }
}

/** Paints A-only / B-only / both cells into a canvas (1 cell = `cell` mm) and returns a data URL. */
function diffImage(a: Point2D[], b: Point2D[], cell: number): { url: string; bounds: Bounds } | null {
  if (typeof document === 'undefined') return null;
  const ba = boundsOf(a);
  const bb = boundsOf(b);
  const bounds: Bounds = { minX: Math.min(ba.minX, bb.minX), minY: Math.min(ba.minY, bb.minY), maxX: Math.max(ba.maxX, bb.maxX), maxY: Math.max(ba.maxY, bb.maxY) };
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const rows = Math.ceil((bounds.maxY - bounds.minY) / cell);
  if (cols < 1 || rows < 1 || cols * rows > 4_000_000) return null;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const draw = (pts: Point2D[], color: string) => {
    ctx.fillStyle = color;
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = (p.x - bounds.minX) / cell;
      const y = (p.y - bounds.minY) / cell;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  };
  // draw A (blue), then B with XOR-like logic: use two masks
  const mask = (pts: Point2D[]) => {
    const c = document.createElement('canvas');
    c.width = cols;
    c.height = rows;
    const x = c.getContext('2d');
    if (!x) return null;
    x.fillStyle = '#fff';
    x.beginPath();
    pts.forEach((p, i) => {
      const px = (p.x - bounds.minX) / cell;
      const py = (p.y - bounds.minY) / cell;
      if (i === 0) x.moveTo(px, py);
      else x.lineTo(px, py);
    });
    x.closePath();
    x.fill();
    return x.getImageData(0, 0, cols, rows).data;
  };
  const ma = mask(a);
  const mb = mask(b);
  if (!ma || !mb) return null;
  const out = ctx.createImageData(cols, rows);
  for (let i = 0; i < cols * rows; i++) {
    const inA = (ma[i * 4 + 3] ?? 0) > 127;
    const inB = (mb[i * 4 + 3] ?? 0) > 127;
    const o = i * 4;
    if (inA && inB) [out.data[o], out.data[o + 1], out.data[o + 2], out.data[o + 3]] = [74, 222, 128, 70];
    else if (inA) [out.data[o], out.data[o + 1], out.data[o + 2], out.data[o + 3]] = [124, 183, 255, 190];
    else if (inB) [out.data[o], out.data[o + 1], out.data[o + 2], out.data[o + 3]] = [245, 185, 74, 190];
  }
  ctx.putImageData(out, 0, 0);
  void draw;
  return { url: canvas.toDataURL(), bounds };
}

/** Overlay up to four outlines with per-shape opacity and alignment. */
export function ShapeOverlay({ entries }: { entries: ShapeEntry[] }) {
  const [mode, setMode] = useState<Alignment>('center');
  const [opacity, setOpacity] = useState<number[]>(() => entries.map(() => 0.8));
  const [custom, setCustom] = useState<Point2D>({ x: 0, y: 0 });
  const [diff, setDiff] = useState(false);
  const base = entries[0];

  const placed = useMemo(() => {
    if (!base) return [];
    return entries.map((e, i) => {
      const off = i === 0 ? { x: 0, y: 0 } : alignmentOffset(base, e, mode, custom);
      // shift A to its own origin; everything else relative to it
      return { entry: e, off, points: translatePoints(e.shape.points, off.x, off.y) };
    });
  }, [entries, base, mode, custom]);

  const bounds = useMemo(() => {
    const b = boundsOf(placed.flatMap((p) => p.points));
    return { minX: b.minX - 10, minY: b.minY - 10, maxX: b.maxX + 10, maxY: b.maxY + 10 };
  }, [placed]);

  const stats = useMemo(() => placed.slice(1).map((p) => ({ entry: p.entry, ...overlapStats(placed[0]!.points, p.points, 1) })), [placed]);
  const diffImg = useMemo(() => (diff && placed.length >= 2 ? diffImage(placed[0]!.points, placed[1]!.points, 0.5) : null), [diff, placed]);

  if (!base) return null;
  const canUsb = entries.slice(1).every((e) => base.usb && e.usb);

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0,1fr)' }}>
      <div className={ui['row']}>
        <Segmented<Alignment>
          label="Alignment"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'center', label: 'Center' },
            { value: 'front', label: 'Front' },
            { value: 'back', label: 'Back' },
            { value: 'usb', label: canUsb ? 'USB' : 'USB (n/a)' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        <button className={ui['chip']} aria-pressed={diff} onClick={() => setDiff(!diff)} disabled={entries.length < 2}>
          Show difference
        </button>
      </div>
      {mode === 'usb' && !canUsb && <p className={ui['muted']} style={{ fontSize: 13 }}>USB position is not recorded for every item — aligned by the front edge instead.</p>}
      {mode === 'custom' && (
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
          <Slider label="Offset X (mm)" value={custom.x} min={-60} max={60} step={0.5} format={(v) => `${v.toFixed(1)}`} onChange={(x) => setCustom({ ...custom, x })} />
          <Slider label="Offset Y (mm)" value={custom.y} min={-60} max={60} step={0.5} format={(v) => `${v.toFixed(1)}`} onChange={(y) => setCustom({ ...custom, y })} />
        </div>
      )}
      <div className={ui['card']} style={{ height: 'min(56dvh, 520px)', minHeight: 300, overflow: 'hidden' }}>
        <SvgStage label="Shape overlay" bounds={bounds}>
          {diffImg && (
            <image href={diffImg.url} x={diffImg.bounds.minX} y={diffImg.bounds.minY} width={diffImg.bounds.maxX - diffImg.bounds.minX} height={diffImg.bounds.maxY - diffImg.bounds.minY} style={{ imageRendering: 'pixelated' }} preserveAspectRatio="none" />
          )}
          {placed.map((p, i) => (
            <path
              key={p.entry.key}
              d={polyPath(p.points)}
              fill={diff ? 'none' : COLORS[i % COLORS.length]}
              fillOpacity={diff ? 0 : (opacity[i] ?? 0.8) * 0.35}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              strokeOpacity={opacity[i] ?? 0.8}
            />
          ))}
          {placed.map((p, i) =>
            p.entry.usb ? <circle key={`u${i}`} cx={p.entry.usb.x + p.off.x} cy={p.entry.usb.y + p.off.y} r={2.2} fill={COLORS[i % COLORS.length]} /> : null,
          )}
        </SvgStage>
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {entries.map((e, i) => (
          <div key={e.key} className={ui['cardPad']}>
            <div className={ui['row']} style={{ marginBottom: 6 }}>
              <span className={ui['dot']} style={{ color: COLORS[i % COLORS.length], background: COLORS[i % COLORS.length], width: 10, height: 10, borderRadius: 3 }} />
              <strong style={{ fontSize: 14 }}>{i === 0 ? 'A' : String.fromCharCode(65 + i)} · {e.label}</strong>
            </div>
            <Slider label="Opacity" value={opacity[i] ?? 0.8} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setOpacity((o) => o.map((x, j) => (j === i ? v : x)))} />
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {e.dimensions.width.toFixed(1)} × {e.dimensions.depth.toFixed(1)} mm
            </p>
          </div>
        ))}
      </div>
      {stats.length > 0 && (
        <div className={ui['cardPad']}>
          <h3 className={ui['sectionTitle']} style={{ marginBottom: 8 }}>Difference vs A</h3>
          <table className={ui['table']}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Overlap (IoU)</th>
                <th>Only in A</th>
                <th>Only in this</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.entry.key}>
                  <td>{s.entry.label}</td>
                  <td className="mono">{(s.iou * 100).toFixed(1)}%</td>
                  <td className="mono">{(s.onlyA / 100).toFixed(1)} cm²</td>
                  <td className="mono">{(s.onlyB / 100).toFixed(1)} cm²</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={cx(ui['muted'])} style={{ fontSize: 12, marginTop: 8 }}>
            Shape overlap is a visual similarity measure. It does not prove physical compatibility.
          </p>
        </div>
      )}
    </div>
  );
}

export { styles as overlayStyles };
