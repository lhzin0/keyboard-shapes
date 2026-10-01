import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { useElementSize } from '../hooks';
import { useUiStore } from '../stores';
import { cx } from '../utils/format';
import ui from '../components/ui.module.css';
import styles from './Viewer2D.module.css';

export interface MmBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface View {
  /** pixels per millimetre */
  k: number;
  tx: number;
  ty: number;
}

interface StageContext {
  /** pixels per millimetre — children use it to keep text and handles a constant on-screen size */
  k: number;
  /** client coordinates → millimetres in the stage frame */
  toMm(clientX: number, clientY: number): { x: number; y: number };
}

const Ctx = createContext<StageContext>({ k: 1, toMm: () => ({ x: 0, y: 0 }) });
export const useStage = () => useContext(Ctx);

const niceStep = (k: number, minPx = 28) => {
  for (const s of [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) if (s * k >= minPx) return s;
  return 1000;
};

export type StageMode = 'fit' | 'actual' | 'free';

interface Props {
  bounds: MmBounds;
  children: ReactNode;
  /** Called on a click that was not a drag (used by measuring tools). */
  onTap?(mm: { x: number; y: number }, ev: React.PointerEvent, k: number): void;
  cursor?: string;
  toolbarExtra?: ReactNode;
  label: string;
  /** Initial grid/ruler state. */
  grid?: boolean;
  ruler?: boolean;
  /** Draw something in screen space (labels that must not scale). */
  className?: string;
}

export function SvgStage({ bounds, children, onTap, cursor, toolbarExtra, label, grid: gridProp = true, ruler: rulerProp = true, className }: Props) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const pxPerMm = useUiStore((s) => s.pxPerMm);
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const [mode, setMode] = useState<StageMode>('fit');
  const [showGrid, setShowGrid] = useState(gridProp);
  const [showRuler, setShowRuler] = useState(rulerProp);

  const bw = Math.max(bounds.maxX - bounds.minX, 1);
  const bh = Math.max(bounds.maxY - bounds.minY, 1);
  const cx0 = (bounds.minX + bounds.maxX) / 2;
  const cy0 = (bounds.minY + bounds.maxY) / 2;

  const fit = useCallback(() => {
    if (!size.width || !size.height) return;
    const pad = 36;
    const k = Math.max(0.05, Math.min((size.width - pad * 2) / bw, (size.height - pad * 2) / bh));
    setView({ k, tx: size.width / 2 - cx0 * k, ty: size.height / 2 - cy0 * k });
  }, [size.width, size.height, bw, bh, cx0, cy0]);

  const actual = useCallback(() => {
    if (!size.width) return;
    setView({ k: pxPerMm, tx: size.width / 2 - cx0 * pxPerMm, ty: size.height / 2 - cy0 * pxPerMm });
  }, [size.width, size.height, cx0, cy0, pxPerMm]);

  // (re)fit whenever the content or the container changes, unless the user took over
  useEffect(() => {
    if (mode === 'fit') fit();
    else if (mode === 'actual') actual();
  }, [mode, fit, actual]);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    setMode('free');
    setView((v) => {
      const k = Math.min(60, Math.max(0.05, v.k * factor));
      const f = k / v.k;
      return { k, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f };
    });
  }, []);

  // wheel zoom (non-passive so the page does not scroll)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, zoomAt]);

  /* pointer gestures: 1 pointer = pan, 2 pointers = pinch zoom + pan */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const last = useRef<{ dist: number; mx: number; my: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) start.current = { x: e.clientX, y: e.clientY, moved: false };
    else if (start.current) start.current.moved = true;
    last.current = null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 4) start.current.moved = true;
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      if (start.current?.moved) {
        setMode('free');
        setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
      }
    } else if (pts.length >= 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const rect = ref.current?.getBoundingClientRect();
      if (last.current && rect) {
        zoomAt(dist / last.current.dist, mx - rect.left, my - rect.top);
        setView((v) => ({ ...v, tx: v.tx + (mx - last.current!.mx), ty: v.ty + (my - last.current!.my) }));
      }
      last.current = { dist, mx, my };
    }
  };

  const toMm = useCallback(
    (clientX: number, clientY: number) => {
      const r = ref.current?.getBoundingClientRect();
      const x = (clientX - (r?.left ?? 0) - view.tx) / view.k;
      const y = (clientY - (r?.top ?? 0) - view.ty) / view.k;
      return { x, y };
    },
    [ref, view],
  );

  const onPointerUp = (e: React.PointerEvent) => {
    const wasTap = start.current && !start.current.moved && pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    last.current = null;
    if (wasTap && onTap) onTap(toMm(e.clientX, e.clientY), e, view.k);
    if (pointers.current.size === 0) start.current = null;
  };

  const ctx = useMemo<StageContext>(() => ({ k: view.k, toMm }), [view.k, toMm]);

  // grid / ruler geometry in mm
  const step = niceStep(view.k);
  const x0 = -view.tx / view.k;
  const y0 = -view.ty / view.k;
  const x1 = (size.width - view.tx) / view.k;
  const y1 = (size.height - view.ty) / view.k;
  const gridLines: ReactNode[] = [];
  if (showGrid && size.width) {
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) gridLines.push(<line key={`x${x}`} x1={x} x2={x} y1={y0} y2={y1} className={x % (step * 5) === 0 ? styles['gridMajor'] : styles['grid']} />);
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) gridLines.push(<line key={`y${y}`} y1={y} y2={y} x1={x0} x2={x1} className={y % (step * 5) === 0 ? styles['gridMajor'] : styles['grid']} />);
  }
  const rulerTicksX: ReactNode[] = [];
  const rulerTicksY: ReactNode[] = [];
  if (showRuler && size.width) {
    const rs = niceStep(view.k, 50);
    for (let x = Math.ceil(x0 / rs) * rs; x <= x1; x += rs) {
      const px = x * view.k + view.tx;
      rulerTicksX.push(
        <g key={x} transform={`translate(${px} 0)`}>
          <line y1={14} y2={22} />
          <text x={3} y={11}>{Number(x.toFixed(2))}</text>
        </g>,
      );
    }
    for (let y = Math.ceil(y0 / rs) * rs; y <= y1; y += rs) {
      const py = y * view.k + view.ty;
      rulerTicksY.push(
        <g key={y} transform={`translate(0 ${py})`}>
          <line x1={14} x2={22} />
          <text x={2} y={-3} transform="rotate(-90 2 -3)">{Number(y.toFixed(2))}</text>
        </g>,
      );
    }
  }

  const scaleBarMm = niceStep(view.k, 70);

  return (
    <div className={cx(styles['stage'], className)} ref={ref} role="img" aria-label={label}>
      <svg
        className={styles['svg']}
        width={size.width}
        height={size.height}
        style={{ cursor: cursor ?? 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <Ctx.Provider value={ctx}>
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`} className={styles['content']}>
            {gridLines}
            {children}
          </g>
        </Ctx.Provider>
        {showRuler && size.width > 0 && (
          <g className={styles['ruler']} pointerEvents="none">
            <rect width={size.width} height={22} />
            <rect width={22} height={size.height} />
            <g>{rulerTicksX}</g>
            <g>{rulerTicksY}</g>
          </g>
        )}
        <g className={styles['scaleBar']} transform={`translate(${size.width - scaleBarMm * view.k - 16} ${size.height - 18})`} pointerEvents="none">
          <line x2={scaleBarMm * view.k} />
          <line y1={-4} y2={4} />
          <line x1={scaleBarMm * view.k} x2={scaleBarMm * view.k} y1={-4} y2={4} />
          <text x={scaleBarMm * view.k} y={-8} textAnchor="end">{scaleBarMm} mm</text>
        </g>
      </svg>

      <div className={styles['toolbar']} role="toolbar" aria-label={`${label} controls`}>
        <button className={ui['iconBtn']} onClick={() => setMode('fit')} aria-pressed={mode === 'fit'} title="Fit to view" aria-label="Fit to view">
          <Icon name="fit" />
        </button>
        <button className={cx(ui['btn'], ui['small'])} onClick={() => setMode('actual')} aria-pressed={mode === 'actual'} title="Real size (1:1 at the calibrated screen scale)">
          1:1
        </button>
        <button className={ui['iconBtn']} onClick={() => zoomAt(1.3, size.width / 2, size.height / 2)} title="Zoom in" aria-label="Zoom in">
          <Icon name="plus" />
        </button>
        <button className={ui['iconBtn']} onClick={() => zoomAt(1 / 1.3, size.width / 2, size.height / 2)} title="Zoom out" aria-label="Zoom out">
          <Icon name="minus" />
        </button>
        <button className={ui['iconBtn']} onClick={() => setShowGrid(!showGrid)} aria-pressed={showGrid} title="Grid" aria-label="Toggle grid">
          <Icon name="grid" />
        </button>
        <button className={ui['iconBtn']} onClick={() => setShowRuler(!showRuler)} aria-pressed={showRuler} title="Ruler" aria-label="Toggle ruler">
          <Icon name="ruler" />
        </button>
        {toolbarExtra}
      </div>
    </div>
  );
}
