import { Icon } from '../components/Icon';
import { Segmented, Slider } from '../components/Panels';
import ui from '../components/ui.module.css';
import { LAYER_LABEL, type LayerId } from '../geometry/3d/KeyboardAssembly';
import { useViewer3D, type RenderMode } from '../stores';
import { cx } from '../utils/format';

/** Layer list: visible / hidden, opacity, isolate. */
export function LayersPanel({ layers }: { layers: LayerId[] }) {
  const state = useViewer3D((s) => s.layers);
  const isolated = useViewer3D((s) => s.isolated);
  const setLayer = useViewer3D((s) => s.setLayer);
  const isolate = useViewer3D((s) => s.isolate);
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }} aria-label="Layers">
      {layers.map((id) => {
        const l = state[id];
        const dimmed = isolated !== null && isolated !== id;
        return (
          <li key={id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 8, opacity: dimmed ? 0.5 : 1 }}>
            <button
              className={ui['iconBtn']}
              aria-pressed={l.visible}
              aria-label={`${l.visible ? 'Hide' : 'Show'} ${LAYER_LABEL[id]}`}
              title={l.visible ? 'Hide' : 'Show'}
              onClick={() => setLayer(id, { visible: !l.visible })}
            >
              <Icon name={l.visible ? 'eye' : 'eyeOff'} />
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{LAYER_LABEL[id]}</div>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={l.opacity}
                aria-label={`${LAYER_LABEL[id]} opacity`}
                onChange={(e) => setLayer(id, { opacity: Number(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--accent)', height: 24 }}
              />
            </div>
            <button className={cx(ui['btn'], ui['small'])} aria-pressed={isolated === id} onClick={() => isolate(id)} title="Show only this layer">
              Isolate
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Exploded view: parts move apart in proportion to their original height in the stack. */
export function ExplodedView() {
  const explode = useViewer3D((s) => s.explode);
  const setExplode = useViewer3D((s) => s.setExplode);
  return <Slider label="Exploded view" value={explode} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setExplode} />;
}

/** Section view: clipping plane through the model. */
export function SectionView() {
  const section = useViewer3D((s) => s.section);
  const setSection = useViewer3D((s) => s.setSection);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className={ui['row']}>
        <button className={ui['btn']} aria-pressed={section.enabled} onClick={() => setSection({ enabled: !section.enabled })}>
          <Icon name="scissors" size={16} />
          {section.enabled ? 'Section on' : 'Section off'}
        </button>
        <Segmented<'x' | 'y' | 'z'>
          label="Section axis"
          value={section.axis}
          onChange={(axis) => setSection({ axis })}
          options={[
            { value: 'x', label: 'Left–right' },
            { value: 'z', label: 'Front–back' },
            { value: 'y', label: 'Height' },
          ]}
        />
        <button className={cx(ui['btn'], ui['small'])} onClick={() => setSection({ flip: !section.flip })} aria-pressed={section.flip}>
          Flip
        </button>
      </div>
      <Slider label="Cut position" value={section.position} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(position) => setSection({ position, enabled: true })} />
    </div>
  );
}

export function RenderModeControl() {
  const mode = useViewer3D((s) => s.renderMode);
  const set = useViewer3D((s) => s.setRenderMode);
  return (
    <Segmented<RenderMode>
      label="Render mode"
      value={mode}
      onChange={set}
      options={[
        { value: 'solid', label: 'Solid' },
        { value: 'transparent', label: 'X-ray' },
        { value: 'wireframe', label: 'Wireframe' },
      ]}
    />
  );
}
