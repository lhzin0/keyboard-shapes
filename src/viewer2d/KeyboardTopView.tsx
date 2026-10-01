import { useMemo, useState } from 'react';
import type { AssemblySelection } from '../geometry/3d/KeyboardAssembly';
import { resolvePlacements } from '../geometry/placement';
import { boundsOf, pointInPolygon, translatePoints } from '../geometry/shape';
import type { CheckStatus, ComponentType, Cutout, Point2D, PortPosition } from '../types/keyboard';
import { cx } from '../utils/format';
import ui from '../components/ui.module.css';
import { DimLine, MeasureLayer, MeasurePanel, useMeasure } from './DimensionOverlay';
import { KeyboardLayoutRenderer } from './KeyboardLayoutRenderer';
import { SvgStage } from './SvgStage';
import styles from './Viewer2D.module.css';

type TopComponent = 'case' | 'pcb' | 'plate' | 'daughterboard';

interface Props {
  selection: AssemblySelection;
  selected?: TopComponent | null;
  onSelect?(c: TopComponent | null): void;
  showMeasurePanel?: boolean;
}

const polyPath = (pts: Point2D[]) => `M${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`;

function portRect(port: PortPosition, dx: number, dy: number) {
  const depth = 3.2;
  const horizontal = port.facing === 'front' || port.facing === 'back';
  const cx0 = port.x + dx;
  const cy0 = port.y + dy;
  return horizontal
    ? { x: cx0 - port.width / 2, y: cy0 - depth / 2, w: port.width, h: depth }
    : { x: cx0 - depth / 2, y: cy0 - port.width / 2, w: depth, h: port.width };
}

function cutoutRect(c: Cutout, caseW: number, caseD: number, wall: number) {
  switch (c.wall) {
    case 'back':
      return { x: c.center - c.width / 2, y: -0.5, w: c.width, h: wall + 1 };
    case 'front':
      return { x: c.center - c.width / 2, y: caseD - wall - 0.5, w: c.width, h: wall + 1 };
    case 'left':
      return { x: -0.5, y: c.center - c.width / 2, w: wall + 1, h: c.width };
    case 'right':
      return { x: caseW - wall - 0.5, y: c.center - c.width / 2, w: wall + 1, h: c.width };
  }
}

const stateClass = (s: CheckStatus | undefined) => (s === 'fail' ? styles['fail'] : s === 'warn' ? styles['warnState'] : undefined);

/** Top view: outlines, keys, mounting points, USB, dimensions, collisions. SVG, millimetres. */
export function KeyboardTopView({ selection, selected, onSelect, showMeasurePanel = true }: Props) {
  const resolved = useMemo(() => resolvePlacements(selection), [selection]);
  const { evaluation } = resolved;
  const { case: c, pcb, plate, daughterboard: db, layout } = selection;

  const [layers, setLayers] = useState({ keys: true, plate: true, pcb: true, holes: true, usb: true, dims: true, collisions: true, labels: true });
  const toggle = (k: keyof typeof layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  const pcbPts = useMemo(() => (pcb ? translatePoints(pcb.outline.points, resolved.pcb.dx, resolved.pcb.dy) : null), [pcb, resolved.pcb]);
  const platePts = useMemo(() => (plate ? translatePoints(plate.outline.points, resolved.plate.dx, resolved.plate.dy) : null), [plate, resolved.plate]);
  const dbPts = useMemo(() => (db ? translatePoints(db.outline.points, resolved.daughterboard.dx, resolved.daughterboard.dy) : null), [db, resolved.daughterboard]);
  const casePts = c?.externalShape.points ?? null;

  const bounds = useMemo(() => {
    const all = [...(casePts ?? []), ...(pcbPts ?? []), ...(platePts ?? []), ...(dbPts ?? [])];
    const b = boundsOf(all.length ? all : [{ x: 0, y: 0 }, { x: 100, y: 60 }]);
    const m = 14;
    return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m + 30, maxY: b.maxY + m + 20 };
  }, [casePts, pcbPts, platePts, dbPts]);

  const snapPoints = useMemo(() => {
    const pts: Point2D[] = [];
    for (const poly of [casePts, c?.internalCavity?.points, pcbPts, platePts, dbPts]) if (poly) pts.push(...poly);
    for (const m of c?.mountingPoints ?? []) pts.push(m);
    for (const m of pcb?.mountingPoints ?? []) pts.push({ x: m.x + resolved.pcb.dx, y: m.y + resolved.pcb.dy });
    for (const m of plate?.mountingPoints ?? []) pts.push({ x: m.x + resolved.plate.dx, y: m.y + resolved.plate.dy });
    pts.push(...resolved.centers);
    return pts;
  }, [casePts, c, pcb, plate, pcbPts, platePts, dbPts, resolved]);

  const measure = useMeasure(snapPoints);

  const hit = (p: Point2D): TopComponent | null => {
    if (dbPts && pointInPolygon(p, dbPts)) return 'daughterboard';
    if (pcbPts && pointInPolygon(p, pcbPts)) return 'pcb';
    if (platePts && pointInPolygon(p, platePts)) return 'plate';
    if (casePts && pointInPolygon(p, casePts)) return 'case';
    return null;
  };

  const presets = useMemo(() => {
    const out: { label: string; a: Point2D; b: Point2D }[] = [];
    if (c) {
      const { width: W, depth: D } = c.dimensions;
      out.push({ label: 'Case width', a: { x: 0, y: D + 8 }, b: { x: W, y: D + 8 } }, { label: 'Case depth', a: { x: W + 8, y: 0 }, b: { x: W + 8, y: D } });
    }
    const h = pcb?.mountingPoints;
    if (h && h.length >= 2) {
      const a = h[0]!;
      const b = h[1]!;
      out.push({ label: 'Hole 1 → 2', a: { x: a.x + resolved.pcb.dx, y: a.y + resolved.pcb.dy }, b: { x: b.x + resolved.pcb.dx, y: b.y + resolved.pcb.dy } });
    }
    return out;
  }, [c, pcb, resolved.pcb]);

  const wall = c?.wallThickness ?? 3;
  const usbCutouts = c?.cutouts.filter((x) => x.kind === 'usb') ?? [];

  return (
    <div style={{ display: 'grid', gap: 10, height: '100%', gridTemplateRows: 'auto minmax(0,1fr)' }}>
      <div className={ui['row']} role="group" aria-label="Top view layers" style={{ gap: 6 }}>
        {(['keys', 'plate', 'pcb', 'holes', 'usb', 'dims', 'collisions'] as const).map((k) => (
          <button key={k} className={ui['chip']} aria-pressed={layers[k]} onClick={() => toggle(k)}>
            {k === 'dims' ? 'Dimensions' : k === 'pcb' ? 'PCB' : k.charAt(0).toUpperCase() + k.slice(1)}
          </button>
        ))}
        <button className={ui['chip']} aria-pressed={measure.active} onClick={() => measure.setActive(!measure.active)}>
          Measure
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: showMeasurePanel && (measure.active || measure.items.length) ? 'minmax(0,1fr) minmax(220px, 300px)' : 'minmax(0,1fr)', gap: 10, minHeight: 0 }}>
        <div className={ui['card']} style={{ overflow: 'hidden', minHeight: 280 }}>
          <SvgStage
            label="Top view"
            bounds={bounds}
            cursor={measure.active ? 'crosshair' : 'grab'}
            onTap={(mm, _ev, k) => {
              if (measure.active) measure.tap(mm, k);
              else onSelect?.(hit(mm));
            }}
          >
            {casePts && (
              <path d={polyPath(casePts)} className={cx(styles['caseOutline'], selected === 'case' && styles['selected'], stateClass(evaluation.componentStatus.case))} />
            )}
            {c?.internalCavity && <path d={polyPath(c.internalCavity.points)} className={styles['cavity']} />}
            {c?.daughterboardArea && (
              <rect x={c.daughterboardArea.x} y={c.daughterboardArea.y} width={c.daughterboardArea.width} height={c.daughterboardArea.depth} className={styles['cavity']} />
            )}
            {layers.plate && platePts && (
              <path d={polyPath(platePts)} className={cx(styles['plateOutline'], selected === 'plate' && styles['selected'], stateClass(evaluation.componentStatus.plate))} />
            )}
            {layers.pcb && pcbPts && (
              <path d={polyPath(pcbPts)} className={cx(styles['pcbOutline'], selected === 'pcb' && styles['selected'], stateClass(evaluation.componentStatus.pcb))} />
            )}
            {dbPts && (
              <path d={polyPath(dbPts)} className={cx(styles['dbOutline'], selected === 'daughterboard' && styles['selected'], stateClass(evaluation.componentStatus.daughterboard))} />
            )}
            {layers.keys && layout && resolved.centers.length === layout.keys.length && (
              <KeyboardLayoutRenderer layout={layout} centers={resolved.centers} showLabels={layers.labels} />
            )}
            {layers.holes && (
              <g>
                {c?.mountingPoints.map((m) => (
                  <circle key={`c${m.id}`} className={styles['hole']} cx={m.x} cy={m.y} r={(m.diameter ?? 4.5) / 2} strokeDasharray="3 2" />
                ))}
                {pcb?.mountingPoints.map((m) => (
                  <circle key={`p${m.id}`} className={styles['hole']} cx={m.x + resolved.pcb.dx} cy={m.y + resolved.pcb.dy} r={(m.diameter ?? 2.5) / 2} />
                ))}
                {plate?.mountingPoints.map((m) => (
                  <circle key={`pl${m.id}`} className={styles['hole']} cx={m.x + resolved.plate.dx} cy={m.y + resolved.plate.dy} r={(m.diameter ?? 2.5) / 2 + 1} opacity={0.6} />
                ))}
              </g>
            )}
            {layers.usb && c && (
              <g>
                {usbCutouts.map((u) => {
                  const r = cutoutRect(u, c.dimensions.width, c.dimensions.depth, wall);
                  return <rect key={u.id} className={styles['usb']} x={r.x} y={r.y} width={r.w} height={r.h} />;
                })}
                {pcb?.usbPort && (() => {
                  const r = portRect(pcb.usbPort, resolved.pcb.dx, resolved.pcb.dy);
                  return <rect className={styles['usb']} x={r.x} y={r.y} width={r.w} height={r.h} strokeDasharray="2 1" />;
                })()}
                {db && (() => {
                  const r = portRect(db.usbPort, resolved.daughterboard.dx, resolved.daughterboard.dy);
                  return <rect className={styles['usb']} x={r.x} y={r.y} width={r.w} height={r.h} strokeDasharray="2 1" />;
                })()}
              </g>
            )}
            {layers.dims && c && (
              <g>
                <DimLine a={{ x: 0, y: c.dimensions.depth }} b={{ x: c.dimensions.width, y: c.dimensions.depth }} offset={16} label={`${c.dimensions.width.toFixed(1)} mm`} />
                <DimLine a={{ x: c.dimensions.width, y: 0 }} b={{ x: c.dimensions.width, y: c.dimensions.depth }} offset={16} label={`${c.dimensions.depth.toFixed(1)} mm`} />
              </g>
            )}
            {layers.collisions && evaluation.collisions.map((col, i) => (
              <g key={i}>
                <circle className={styles['collision']} cx={col.at.x} cy={col.at.y} r={Math.max(3, col.depthMm ?? 3)} />
                <title>{col.description}</title>
              </g>
            ))}
            <MeasureLayer items={measure.items} pending={measure.pending} />
          </SvgStage>
        </div>
        {showMeasurePanel && (measure.active || measure.items.length > 0) && (
          <div className={ui['cardPad']} style={{ alignSelf: 'start' }}>
            <MeasurePanel api={measure} extra={presets} />
          </div>
        )}
      </div>
    </div>
  );
}

export type { ComponentType };
