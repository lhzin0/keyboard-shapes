import { useMemo } from 'react';
import ui from '../components/ui.module.css';
import type { AssemblySelection } from '../geometry/3d/KeyboardAssembly';
import type { Point2D } from '../types/keyboard';
import { cx } from '../utils/format';
import { DimLine, MeasureLayer, MeasurePanel, useMeasure } from './DimensionOverlay';
import { buildProfileModel, type ProfileKind, type ProfileModel } from './profileModel';
import { SvgStage } from './SvgStage';
import styles from './Viewer2D.module.css';

const polyPath = (pts: Point2D[]) => `M${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`;

const KIND_CLASS: Record<ProfileKind, string | undefined> = {
  case: styles['caseOutline'],
  cavity: styles['cavity'],
  foam: styles['plateOutline'],
  pcb: styles['pcbOutline'],
  plate: styles['plateOutline'],
  switch: styles['key'],
  keycap: styles['key'],
  daughterboard: styles['dbOutline'],
};

function ProfileDrawing({ model, view }: { model: ProfileModel; view: 'side' | 'front' }) {
  const order: ProfileKind[] = ['case', 'cavity', 'foam', 'switch', 'plate', 'pcb', 'daughterboard', 'keycap'];
  const sorted = [...model.polys].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return (
    <g>
      {/* desk line */}
      <line x1={-40} x2={model.length + 40} y1={0} y2={0} stroke="var(--text-faint)" strokeWidth={1.5} />
      {sorted.map((p) => (
        <path key={p.id} d={polyPath(p.points)} className={KIND_CLASS[p.kind]} fillOpacity={p.kind === 'cavity' ? 1 : undefined} style={p.kind === 'cavity' ? { fill: 'var(--surface)' } : undefined} />
      ))}
      {model.usbCutout && <path d={polyPath(model.usbCutout)} className={styles['usb']} strokeDasharray="3 2" />}
      {view === 'side' && model.frontHeight > 0 && (
        <g>
          <DimLine a={{ x: -6, y: 0 }} b={{ x: -6, y: -model.frontHeight }} offset={-18} label={`front ${model.frontHeight.toFixed(1)} mm`} />
          <DimLine a={{ x: model.length, y: 0 }} b={{ x: model.length, y: -model.rearHeight }} offset={18} label={`rear ${model.rearHeight.toFixed(1)} mm`} />
          <DimLine a={{ x: 0, y: 0 }} b={{ x: model.length, y: 0 }} offset={18} label={`${model.length.toFixed(1)} mm · ${model.angle.toFixed(1)}°`} />
        </g>
      )}
      {view === 'front' && model.frontHeight > 0 && (
        <g>
          <DimLine a={{ x: 0, y: 0 }} b={{ x: model.length, y: 0 }} offset={18} label={`${model.length.toFixed(1)} mm`} />
          <DimLine a={{ x: model.length, y: 0 }} b={{ x: model.length, y: -model.rearHeight }} offset={18} label={`${model.rearHeight.toFixed(1)} mm`} />
        </g>
      )}
    </g>
  );
}

function ProfileView({ selection, view }: { selection: AssemblySelection; view: 'side' | 'front' }) {
  const model = useMemo(() => buildProfileModel(selection, view), [selection, view]);
  const snap = useMemo(() => model.polys.flatMap((p) => p.points), [model]);
  const measure = useMeasure(snap);
  const bounds = {
    minX: -50,
    minY: -(model.maxHeight + 30),
    maxX: model.length + 70,
    maxY: 40,
  };
  return (
    <div style={{ display: 'grid', gap: 10, height: '100%', gridTemplateRows: 'auto minmax(0,1fr)' }}>
      <div className={ui['row']}>
        <button className={ui['chip']} aria-pressed={measure.active} onClick={() => measure.setActive(!measure.active)}>
          Measure
        </button>
        {model.angle !== 0 && view === 'side' && <span className={cx(ui['badge'])}>typing angle {model.angle.toFixed(1)}°</span>}
        {model.warnings.map((w) => (
          <span key={w} className={cx(ui['badge'], ui['warn'])}>{w}</span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: measure.active || measure.items.length ? 'minmax(0,1fr) minmax(200px,280px)' : 'minmax(0,1fr)', gap: 10, minHeight: 0 }}>
        <div className={ui['card']} style={{ overflow: 'hidden', minHeight: 260 }}>
          <SvgStage label={view === 'side' ? 'Side view' : 'Front view'} bounds={bounds} cursor={measure.active ? 'crosshair' : 'grab'} onTap={(mm, _e, k) => measure.tap(mm, k)}>
            <ProfileDrawing model={model} view={view} />
            <MeasureLayer items={measure.items} pending={measure.pending} />
          </SvgStage>
        </div>
        {(measure.active || measure.items.length > 0) && (
          <div className={ui['cardPad']} style={{ alignSelf: 'start' }}>
            <MeasurePanel api={measure} />
          </div>
        )}
      </div>
    </div>
  );
}

export const KeyboardSideView = (p: { selection: AssemblySelection }) => <ProfileView selection={p.selection} view="side" />;
export const KeyboardFrontView = (p: { selection: AssemblySelection }) => <ProfileView selection={p.selection} view="front" />;
