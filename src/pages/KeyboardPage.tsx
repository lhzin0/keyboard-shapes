import { useMemo, useState } from 'react';
import { evaluateBuild } from '../compatibility/CompatibilityEngine';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BuildCompatibility } from '../components/CompatibilityPanel';
import { ConfidenceBadge } from '../components/Badges';
import { KV, ShapeThumb } from '../components/Cards';
import { Icon } from '../components/Icon';
import { Collapsible } from '../components/Panels';
import { PartViewer } from '../components/PartViewer';
import { MeasurementValue, SourcesPanel } from '../components/SourcesPanel';
import ui from '../components/ui.module.css';
import type { AssemblySelection } from '../geometry/3d/KeyboardAssembly';
import { useDocumentTitle } from '../hooks';
import { findSimilar } from '../search/similarity';
import { COMPONENT_LABEL, getKeyboard, resolveKeyboard } from '../services/database';
import { useBuildStore, useCompareStore } from '../stores';
import { cx, mm, PRECISION_LABEL } from '../utils/format';
import styles from './Pages.module.css';
import { NotFound } from './NotFound';
import { ItemCard } from '../components/Cards';
import { catalog } from '../search';

export default function KeyboardPage() {
  const { slug } = useParams();
  const kb = getKeyboard(slug);
  useDocumentTitle(kb ? `${kb.brand} ${kb.model}` : 'Not found');
  const navigate = useNavigate();
  const compare = useCompareStore();
  const loadBuild = useBuildStore((s) => s.loadKeyboard);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [selected, setSelected] = useState<'case' | 'pcb' | 'plate' | 'daughterboard' | null>(null);

  const parts = useMemo(() => (kb ? resolveKeyboard(kb) : null), [kb]);
  const selection = useMemo<AssemblySelection | null>(
    () =>
      kb && parts
        ? {
            case: parts.case,
            pcb: parts.pcb,
            plate: parts.plate,
            daughterboard: parts.daughterboard,
            switch: parts.switch,
            keycap: parts.keycap,
            stabilizer: parts.stabilizer,
            foam: parts.foam,
            layout: kb.layout,
            profile: kb.profile,
          }
        : null,
    [kb, parts],
  );

  if (!kb || !parts || !selection) return <NotFound what="keyboard" />;

  const ref = { kind: 'keyboard', id: kb.id } as const;
  const inCompare = compare.has(ref);
  const shape = kb.shape ?? parts.case?.externalShape;
  const similar = similarOpen ? findSimilar({ kind: 'keyboard', id: kb.id }, 4) : [];
  const items = catalog();
  const componentRows: Array<[string, string | undefined, string | undefined, string | undefined]> = [
    ['case', parts.case?.id, parts.case?.model, parts.case?.slug],
    ['pcb', parts.pcb?.id, parts.pcb?.model, parts.pcb?.slug],
    ['plate', parts.plate?.id, parts.plate?.model, parts.plate?.slug],
    ['daughterboard', parts.daughterboard?.id, parts.daughterboard?.model, parts.daughterboard?.slug],
  ];

  return (
    <div className={styles['page']}>
      <div className={styles['pageHead']}>
        <div>
          <div className={ui['row']} style={{ marginBottom: 6 }}>
            <Link to="/search?kind=keyboard" className={ui['muted']} style={{ fontSize: 13 }}>Keyboards</Link>
            <span className={ui['muted']}>/</span>
            <span className={ui['badge']}>{kb.layout.name}</span>
            <ConfidenceBadge confidence={kb.confidence} />
          </div>
          <h1>{kb.brand} {kb.model}</h1>
        </div>
        <div className={ui['row']}>
          <button className={ui['btn']} aria-pressed={inCompare} onClick={() => compare.toggle(ref)}>
            <Icon name="compare" size={16} /> {inCompare ? 'In compare' : 'Compare'}
          </button>
          {inCompare && <Link to="/compare" className={ui['btn']}>Open compare</Link>}
          <button className={ui['btn']} aria-pressed={similarOpen} onClick={() => setSimilarOpen(!similarOpen)}>
            <Icon name="target" size={16} /> Find similar
          </button>
          {parts.pcb && (
            <Link to={`/component/pcb/${parts.pcb.slug}#compatible`} className={ui['btn']}>
              <Icon name="link" size={16} /> Find compatible
            </Link>
          )}
          <button className={cx(ui['btn'], ui['primary'])} onClick={() => { loadBuild(kb); navigate('/build'); }}>
            <Icon name="build" size={16} /> Build with this
          </button>
        </div>
      </div>

      {kb.sources.some((s) => s.sourceType === 'parametric-reference') && (
        <p className={ui['notice']} style={{ marginBottom: 14 }}>
          <Icon name="info" size={16} />
          <span>Illustrative parametric reference: dimensions are generated from the {kb.layout.name} key map and nominal values. They are <strong>not</strong> measurements of a commercial product.</span>
        </p>
      )}

      {!kb.sources.some((s) => s.sourceType === 'parametric-reference') && kb.confidence.level !== 'official' && kb.confidence.level !== 'cad' && kb.confidence.level !== 'measured' && kb.confidence.notes && (
        <p className={ui['noticeWarn']} style={{ marginBottom: 14 }} role="note">
          <Icon name="warning" size={16} />
          <span><strong>{kb.confidence.level === 'reconstructed' ? 'Reconstructed' : 'Estimated'} outline.</strong> {kb.confidence.notes}</span>
        </p>
      )}

      <div className={styles['split']}>
        <div className={styles['stack']}>
          <PartViewer
            selection={selection}
            modelKey={kb.id}
            defaultView="top"
            selectedTop={selected}
            onSelectTop={setSelected}
            extra3d={{ title: 'Compatibility', node: parts.case && parts.pcb ? <BuildCompatibility evaluation={buildEval(selection)} /> : <p className={ui['muted']}>Not enough parts.</p> }}
          />
          {selected && (
            <p className={ui['notice']} role="status">
              Selected: <strong>{COMPONENT_LABEL[selected]}</strong>{' — '}
              <Link to={`/component/${selected}/${(parts[selected] as { slug: string } | undefined)?.slug ?? ''}`}>open component page</Link>
            </p>
          )}

          <section className={ui['cardPad']} aria-labelledby="h-compat">
            <h2 id="h-compat" className={ui['sectionTitle']} style={{ marginBottom: 10 }}>Compatibility of its own parts</h2>
            <BuildCompatibility evaluation={buildEval(selection)} />
          </section>

          {similarOpen && (
            <section className={ui['cardPad']} aria-labelledby="h-sim">
              <h2 id="h-sim" className={ui['sectionTitle']} style={{ marginBottom: 6 }}>Similar by shape</h2>
              <p className={ui['muted']} style={{ fontSize: 13, marginBottom: 12 }}>Outline, dimensions, aspect ratio, corner radius, layout, angle and key positions. Similarity says nothing about whether parts fit each other.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
                {similar.map((s) => {
                  const it = items.find((i) => i.kind === 'keyboard' && i.id === s.item.id);
                  return it ? (
                    <div key={s.item.id} style={{ display: 'grid', gap: 6 }}>
                      <ItemCard item={it} compact />
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {Math.round(s.breakdown.total * 100)}% similar · outline {Math.round(s.breakdown.outline * 100)}% · size {Math.round(s.breakdown.dimensions * 100)}%
                      </span>
                    </div>
                  ) : null;
                })}
              </div>
            </section>
          )}
        </div>

        <aside className={cx(ui['cardPad'])} style={{ display: 'grid', gap: 4 }} aria-label="Details">
          <div style={{ aspectRatio: '16/9', display: 'grid', placeItems: 'center', padding: 8, marginBottom: 6 }}>
            <ShapeThumb shape={shape} extra={parts.case?.internalCavity ? [parts.case.internalCavity.points] : undefined} label={`${kb.model} outline`} />
          </div>
          <Collapsible title="Dimensions">
            <KV
              rows={[
                ['Width', mm(kb.dimensions.width)],
                ['Depth', mm(kb.dimensions.depth)],
                ['Height', mm(kb.dimensions.height)],
                ...(parts.case?.angle !== undefined ? ([['Typing angle', `${parts.case.angle.toFixed(1)}°`]] as Array<[string, string]>) : []),
                ...(kb.weight ? ([['Weight', <MeasurementValue key="w" m={kb.weight} />]] as Array<[string, React.ReactNode]>) : []),
              ]}
            />
            <p className={ui['muted']} style={{ fontSize: 12, marginTop: 8 }}>Precision: {PRECISION_LABEL[kb.confidence.level]}</p>
          </Collapsible>
          <Collapsible title="Layout">
            <KV rows={[['Layout', kb.layout.name], ['Keys', String(kb.layout.keyCount)], ['Width', `${kb.layout.widthU}u`], ['Rows', String(new Set(kb.layout.keys.map((k) => k.row)).size)]]} />
          </Collapsible>
          <Collapsible title="Components">
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
              {componentRows.map(([type, id, model, cslug]) =>
                id ? (
                  <li key={type} style={{ display: 'grid' }}>
                    <span className={ui['muted']} style={{ fontSize: 12 }}>{COMPONENT_LABEL[type as 'case']}</span>
                    <Link to={`/component/${type}/${cslug}`}>{model}</Link>
                  </li>
                ) : null,
              )}
              {parts.switch && <li><span className={ui['muted']} style={{ fontSize: 12 }}>Switch</span><br />{parts.switch.model}</li>}
              {parts.keycap && <li><span className={ui['muted']} style={{ fontSize: 12 }}>Keycaps</span><br />{parts.keycap.model}</li>}
            </ul>
          </Collapsible>
          <Collapsible title="Sources & precision" defaultOpen={false}>
            <SourcesPanel sources={kb.sources} confidence={kb.confidence} />
          </Collapsible>
        </aside>
      </div>
    </div>
  );
}

const evalCache = new WeakMap<object, ReturnType<typeof evaluateBuild>>();
function buildEval(sel: AssemblySelection) {
  let e = evalCache.get(sel);
  if (!e) {
    e = evaluateBuild(sel);
    evalCache.set(sel, e);
  }
  return e;
}
