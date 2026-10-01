import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { BottomSheet, Collapsible } from '../components/Panels';
import ui from '../components/ui.module.css';
import { buildAssembly, disposeAssembly, type AssemblySelection } from '../geometry/3d/KeyboardAssembly';
import { useIsMobile } from '../hooks';
import { useViewer3D, type ViewName } from '../stores';
import { cx } from '../utils/format';
import { AssemblyScene } from './AssemblyScene';
import { ExplodedView, LayersPanel, RenderModeControl, SectionView } from './Panels3D';
import styles from './Viewer3D.module.css';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface Props {
  selection: AssemblySelection;
  /** Extra content for the side panel (desktop) / a sheet (mobile), e.g. the compatibility summary. */
  extra?: { title: string; node: ReactNode };
  /** Parts are rebuilt only when this key changes (avoids rebuilding on identical selections). */
  modelKey: string;
}

const VIEWS: Array<{ id: ViewName; label: string }> = [
  { id: 'iso', label: '3D' },
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
];

type Sheet = null | 'layers' | 'explode' | 'section' | 'view' | 'extra';

export default function KeyboardViewer3D({ selection, extra, modelKey }: Props) {
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [gl] = useState(webglAvailable);
  const [notesOpen, setNotesOpen] = useState(false);

  const assembly = useMemo(() => buildAssembly(selection), [modelKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => disposeAssembly(assembly), [assembly]);
  useEffect(() => () => useViewer3D.getState().resetAll(), []);

  const projection = useViewer3D((s) => s.projection);
  const setProjection = useViewer3D((s) => s.setProjection);
  const goTo = useViewer3D((s) => s.goTo);
  const measure = useViewer3D((s) => s.measure);
  const setMeasure = useViewer3D((s) => s.setMeasure);
  const showCollisions = useViewer3D((s) => s.showCollisions);
  const setShowCollisions = useViewer3D((s) => s.setShowCollisions);
  const resetAll = useViewer3D((s) => s.resetAll);
  const hasCollisions = assembly.evaluation.collisions.length > 0;

  if (!gl) {
    return (
      <div className={cx(styles['root'])}>
        <div className={styles['fallback']}>
          <div>
            <h3 style={{ color: 'var(--text)' }}>3D is not available</h3>
            <p>This browser or device cannot create a WebGL context. The 2D top, side and front views still work.</p>
          </div>
        </div>
      </div>
    );
  }

  const sidePanel = (
    <>
      <Collapsible title="Layers">
        <LayersPanel layers={assembly.layers} />
      </Collapsible>
      <Collapsible title="Exploded view">
        <ExplodedView />
      </Collapsible>
      <Collapsible title="Section view">
        <SectionView />
      </Collapsible>
      <Collapsible title="Display">
        <div style={{ display: 'grid', gap: 10 }}>
          <RenderModeControl />
          {hasCollisions && (
            <button className={ui['btn']} aria-pressed={showCollisions} onClick={() => setShowCollisions(!showCollisions)}>
              Highlight collisions
            </button>
          )}
        </div>
      </Collapsible>
      {extra && <Collapsible title={extra.title}>{extra.node}</Collapsible>}
    </>
  );

  const bottomButtons: Array<{ id: Sheet | 'measure'; icon: IconName; label: string }> = [
    { id: 'layers', icon: 'layers', label: 'Layers' },
    { id: 'explode', icon: 'explode', label: 'Explode' },
    { id: 'section', icon: 'scissors', label: 'Section' },
    { id: 'view', icon: 'cube', label: 'Display' },
    { id: 'measure', icon: 'ruler', label: 'Measure' },
  ];

  return (
    <div className={cx(styles['root'], !mobile && styles['desktop'])}>
      <div className={styles['canvasWrap']}>
        <Canvas frameloop="demand" dpr={[1, 2]} gl={{ antialias: true }} aria-label="3D keyboard viewer">
          <AssemblyScene assembly={assembly} />
        </Canvas>

        <div className={styles['topbar']}>
          <div className={styles['cluster']} role="group" aria-label="Camera views">
            {VIEWS.map((v) => (
              <button key={v.id} className={cx(ui['btn'], ui['small'])} onClick={() => goTo(v.id)}>
                {v.label}
              </button>
            ))}
            <button className={cx(ui['btn'], ui['small'])} aria-pressed={projection === 'orthographic'} onClick={() => setProjection(projection === 'perspective' ? 'orthographic' : 'perspective')} title="Toggle perspective / orthographic">
              {projection === 'perspective' ? 'Persp' : 'Ortho'}
            </button>
            <button className={ui['iconBtn']} style={{ width: 34, minHeight: 32 }} onClick={resetAll} aria-label="Reset view and layers" title="Reset">
              <Icon name="reset" size={16} />
            </button>
          </div>
          {!mobile && (
            <div className={styles['cluster']}>
              <button className={cx(ui['btn'], ui['small'])} aria-pressed={measure} onClick={() => setMeasure(!measure)}>
                <Icon name="ruler" size={16} /> Measure
              </button>
            </div>
          )}
        </div>

        {measure && (
          <div className={ui['notice']} style={{ position: 'absolute', top: 58, left: 10, right: 10, maxWidth: 420, background: 'var(--surface)' }}>
            Click two points on the model to measure the distance in mm.
          </div>
        )}

        {assembly.warnings.length > 0 && (
          <div className={styles['warnings']} style={mobile ? { bottom: 84 } : undefined}>
            {mobile && (
              <button className={cx(ui['chip'])} style={{ pointerEvents: 'auto', width: 'fit-content' }} aria-expanded={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>
                ⚠ {assembly.warnings.length} note{assembly.warnings.length > 1 ? 's' : ''} {notesOpen ? '▴' : '▾'}
              </button>
            )}
            {(!mobile || notesOpen) &&
              assembly.warnings.map((w) => (
                <span key={w} style={mobile ? { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', pointerEvents: 'auto' } : undefined}>
                  ⚠ {w}
                </span>
              ))}
          </div>
        )}

        {mobile && (
          <div className={styles['bottomBar']} role="toolbar" aria-label="Viewer controls">
            {bottomButtons.map((b) => (
              <button
                key={b.id}
                className={ui['btn']}
                aria-pressed={b.id === 'measure' ? measure : sheet === b.id}
                onClick={() => (b.id === 'measure' ? setMeasure(!measure) : setSheet(b.id as Sheet))}
              >
                <Icon name={b.icon} size={20} />
                {b.label}
              </button>
            ))}
            {extra && (
              <button className={ui['btn']} onClick={() => setSheet('extra')}>
                <Icon name="info" size={20} />
                {extra.title}
              </button>
            )}
          </div>
        )}
      </div>

      {!mobile && <aside className={styles['side']} aria-label="Viewer panels">{sidePanel}</aside>}

      {mobile && (
        <>
          <BottomSheet open={sheet === 'layers'} title="Layers" onClose={() => setSheet(null)}>
            <LayersPanel layers={assembly.layers} />
          </BottomSheet>
          <BottomSheet open={sheet === 'explode'} title="Exploded view" onClose={() => setSheet(null)}>
            <ExplodedView />
          </BottomSheet>
          <BottomSheet open={sheet === 'section'} title="Section view" onClose={() => setSheet(null)}>
            <SectionView />
          </BottomSheet>
          <BottomSheet open={sheet === 'view'} title="Display" onClose={() => setSheet(null)}>
            <div style={{ display: 'grid', gap: 12 }}>
              <RenderModeControl />
              {hasCollisions && (
                <button className={ui['btn']} aria-pressed={showCollisions} onClick={() => setShowCollisions(!showCollisions)}>
                  Highlight collisions
                </button>
              )}
            </div>
          </BottomSheet>
          {extra && (
            <BottomSheet open={sheet === 'extra'} title={extra.title} onClose={() => setSheet(null)}>
              {extra.node}
            </BottomSheet>
          )}
        </>
      )}
    </div>
  );
}
