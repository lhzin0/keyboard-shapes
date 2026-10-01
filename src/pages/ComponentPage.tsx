import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { findCompatible } from '../compatibility/CompatibilityEngine';
import { ConfidenceBadge, VerdictBadge } from '../components/Badges';
import { ItemCard, KV, ShapeThumb, outlineOf } from '../components/Cards';
import { PairResult } from '../components/CompatibilityPanel';
import { Icon } from '../components/Icon';
import { Collapsible } from '../components/Panels';
import { PartViewer } from '../components/PartViewer';
import { SourcesPanel } from '../components/SourcesPanel';
import ui from '../components/ui.module.css';
import { useDocumentTitle } from '../hooks';
import { catalog } from '../search';
import { findSimilar } from '../search/similarity';
import { COMPONENT_LABEL, compatDb, getComponent, isComponentType, keyboardsUsing, relationsOf, type AnyComponent } from '../services/database';
import { selectionOfItem } from '../services/selection';
import { useBuildStore, useCompareStore } from '../stores';
import type { Case, ComponentType, Daughterboard, Keycap, PCB, Plate, Stabilizer, Switch, Foam } from '../types/keyboard';
import { cx, mm } from '../utils/format';
import { NotFound } from './NotFound';
import styles from './Pages.module.css';

const COMPAT_TARGETS: ComponentType[] = ['case', 'pcb', 'plate', 'daughterboard'];

function specRows(type: ComponentType, c: AnyComponent): Array<[string, React.ReactNode]> {
  switch (type) {
    case 'case': {
      const x = c as Case;
      return [
        ['Width', mm(x.dimensions.width)],
        ['Depth', mm(x.dimensions.depth)],
        ['Height (front/rear)', `${mm(x.frontHeight)} / ${mm(x.rearHeight)}`],
        ['Angle', x.angle !== undefined ? `${x.angle}°` : '—'],
        ['Wall', mm(x.wallThickness)],
        ['Mounting posts', String(x.mountingPoints.length)],
        ['Cutouts', x.cutouts.map((k) => `${k.kind} (${k.wall}, ${k.width} mm)`).join(', ') || '—'],
        ['Floor → PCB', mm(x.clearance?.floorToPcb)],
        ['Material', x.material ?? '—'],
      ];
    }
    case 'pcb': {
      const x = c as PCB;
      return [
        ['Width', mm(x.dimensions.width)],
        ['Depth', mm(x.dimensions.depth)],
        ['Thickness', mm(x.thickness)],
        ['Underside components', mm(x.undersideHeight)],
        ['Mounting holes', String(x.mountingPoints.length)],
        ['Switch positions', String(x.switchPositions.length)],
        ['USB', x.usbPort ? `${x.usbPort.type ?? 'port'} on ${x.usbPort.facing}` : x.daughterboard ? `via daughterboard (${x.daughterboard.connectorType})` : 'unknown'],
      ];
    }
    case 'plate': {
      const x = c as Plate;
      return [
        ['Width', mm(x.dimensions.width)],
        ['Depth', mm(x.dimensions.depth)],
        ['Thickness', mm(x.thickness)],
        ['Material', x.material ?? '—'],
        ['Switch cutouts', String(x.switchCutouts.length)],
        ['Stabilizer cutouts', String(x.stabilizerCutouts?.length ?? 0)],
        ['Screw holes', String(x.mountingPoints.length)],
      ];
    }
    case 'daughterboard': {
      const x = c as Daughterboard;
      return [
        ['Width', mm(x.dimensions.width)],
        ['Depth', mm(x.dimensions.depth)],
        ['Connector', x.connectorType],
        ['USB', `${x.usbPort.type ?? 'port'} facing ${x.usbPort.facing}`],
        ['Mounting holes', String(x.mountingPoints.length)],
      ];
    }
    case 'switch': {
      const x = c as Switch;
      return [['Style', x.style], ['Plate → PCB', mm(x.plateToPcb)], ['Height above plate', mm(x.topHeight)], ['Plate cutout', `${x.cutout.width} × ${x.cutout.depth} mm`]];
    }
    case 'keycap': {
      const x = c as Keycap;
      return [['Profile', x.profileName], ['Row heights', x.rowHeights.join(', ') + ' mm'], ['Material', x.material ?? '—']];
    }
    case 'stabilizer': {
      const x = c as Stabilizer;
      return [['Mount', x.mount], ['Spacing', Object.entries(x.cutoutSpacing).map(([k, v]) => `${k}: ${v} mm`).join(', ')]];
    }
    case 'foam': {
      const x = c as Foam;
      return [['Thickness', mm(x.thickness)], ['Location', x.location]];
    }
  }
}

export default function ComponentPage() {
  const { type, slug } = useParams();
  const component = type && isComponentType(type) ? getComponent(type, slug) : undefined;
  const title = component ? `${(component as { brand?: string }).brand ?? ''} ${(component as { model?: string }).model ?? component.id}`.trim() : 'Not found';
  useDocumentTitle(title);
  const navigate = useNavigate();
  const location = useLocation();
  const compare = useCompareStore();
  const build = useBuildStore();
  const [similarOpen, setSimilarOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const ctype = type as ComponentType;
  const item = useMemo(() => (component ? ({ kind: ctype, id: component.id } as const) : null), [component, ctype]);
  const selection = useMemo(() => (item ? selectionOfItem(item) : null), [item]);
  const groups = useMemo(
    () => (item && COMPAT_TARGETS.includes(ctype) ? findCompatible({ type: ctype, id: item.id }, compatDb) : []),
    [item, ctype],
  );
  const usedBy = useMemo(() => (component ? keyboardsUsing({ type: ctype, id: component.id }) : []), [component, ctype]);
  const declared = useMemo(() => (component ? relationsOf({ type: ctype, id: component.id }).filter((r) => r.kind.startsWith('declared')) : []), [component, ctype]);

  useEffect(() => {
    if (location.hash === '#compatible') document.getElementById('compatible')?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash, component?.id]);

  if (!component || !item) return <NotFound what="component" />;

  const outline = outlineOf(item);
  const similar = similarOpen ? findSimilar(item, 4) : [];
  const items = catalog();
  const comparable = COMPAT_TARGETS.includes(ctype);
  const inCompare = compare.has(item);
  const hasViewer = !!selection && ['case', 'pcb', 'plate', 'daughterboard'].includes(ctype);
  const conf = (component as { confidence: Parameters<typeof ConfidenceBadge>[0]['confidence'] }).confidence;
  const sources = (component as { sources: Parameters<typeof SourcesPanel>[0]['sources'] }).sources;

  const together = (otherType: ComponentType, otherId: string) => {
    build.reset();
    build.set(ctype, component.id);
    build.set(otherType, otherId);
    navigate('/build');
  };

  return (
    <div className={styles['page']}>
      <div className={styles['pageHead']}>
        <div>
          <div className={ui['row']} style={{ marginBottom: 6 }}>
            <Link to="/search" className={ui['muted']} style={{ fontSize: 13 }}>Components</Link>
            <span className={ui['muted']}>/</span>
            <span className={ui['badge']}>{COMPONENT_LABEL[ctype]}</span>
            <ConfidenceBadge confidence={conf} />
          </div>
          <h1>{title}</h1>
        </div>
        <div className={ui['row']}>
          {comparable && (
            <button className={ui['btn']} aria-pressed={inCompare} onClick={() => compare.toggle(item)}>
              <Icon name="compare" size={16} /> {inCompare ? 'In compare' : 'Compare'}
            </button>
          )}
          {comparable && (
            <button className={ui['btn']} onClick={() => setSimilarOpen(!similarOpen)} aria-pressed={similarOpen}>
              <Icon name="target" size={16} /> Find similar
            </button>
          )}
          {groups.length > 0 && (
            <button className={ui['btn']} onClick={() => document.getElementById('compatible')?.scrollIntoView({ behavior: 'smooth' })}>
              <Icon name="link" size={16} /> {ctype === 'pcb' ? 'Find compatible cases' : ctype === 'case' ? 'Find compatible PCBs' : ctype === 'plate' ? 'Find compatible PCBs' : 'Find compatible'}
            </button>
          )}
          {comparable && (
            <button className={cx(ui['btn'], ui['primary'])} onClick={() => { build.reset(); build.set(ctype, component.id); navigate('/build'); }}>
              <Icon name="build" size={16} /> Use in a build
            </button>
          )}
        </div>
      </div>

      <div className={styles['split']}>
        <div className={styles['stack']}>
          {hasViewer && selection && (
            <PartViewer
              selection={selection}
              modelKey={`${ctype}:${component.id}`}
              defaultView="top"
              hide={ctype === 'daughterboard' ? ['side', 'front'] : []}
            />
          )}

          {groups.length > 0 && (
            <section className={ui['cardPad']} id="compatible" aria-labelledby="h-comp">
              <h2 id="h-comp" className={ui['sectionTitle']} style={{ marginBottom: 6 }}>Find compatible</h2>
              <p className={ui['muted']} style={{ fontSize: 13, marginBottom: 12 }}>Each candidate was run through the geometry engine against this {COMPONENT_LABEL[ctype].toLowerCase()}. “Partially verified” means some data is missing — never read it as compatible.</p>
              {groups.map((g) => (
                <div key={g.type} style={{ marginBottom: 18 }}>
                  <h3 style={{ fontSize: 15, marginBottom: 8 }}>{COMPONENT_LABEL[g.type]}s</h3>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {g.matches.map((m) => {
                      const key = `${g.type}:${m.item.id}`;
                      const expanded = open === key;
                      const label = `${(m.item as { brand?: string }).brand ?? ''} ${(m.item as { model?: string }).model ?? m.item.id}`.trim();
                      return (
                        <div key={key} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
                          <div className={ui['row']} style={{ justifyContent: 'space-between' }}>
                            <div className={ui['row']}>
                              <Link to={`/component/${g.type}/${m.item.slug}`}>{label}</Link>
                              <VerdictBadge verdict={m.result.verdict} />
                            </div>
                            <div className={ui['row']}>
                              <button className={cx(ui['btn'], ui['small'])} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                                {expanded ? 'Hide checks' : 'Checks'}
                              </button>
                              {m.result.verdict !== 'incompatible' && (
                                <button className={cx(ui['btn'], ui['small'])} onClick={() => together(g.type, m.item.id)}>
                                  View together
                                </button>
                              )}
                            </div>
                          </div>
                          {expanded && <div style={{ marginTop: 8 }}><PairResult result={m.result} /></div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          )}

          {similarOpen && (
            <section className={ui['cardPad']} aria-labelledby="h-sim">
              <h2 id="h-sim" className={ui['sectionTitle']} style={{ marginBottom: 6 }}>Similar by shape</h2>
              <p className={ui['muted']} style={{ fontSize: 13, marginBottom: 12 }}>Visual similarity only — it does not imply the parts fit.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
                {similar.map((s) => {
                  const it = items.find((i) => i.kind === s.item.kind && i.id === s.item.id);
                  return it ? (
                    <div key={s.item.id} style={{ display: 'grid', gap: 6 }}>
                      <ItemCard item={it} />
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{Math.round(s.breakdown.total * 100)}% similar</span>
                    </div>
                  ) : null;
                })}
              </div>
            </section>
          )}
        </div>

        <aside className={ui['cardPad']} aria-label="Details" style={{ display: 'grid', gap: 4 }}>
          {outline.shape && (
            <div style={{ aspectRatio: '16/9', display: 'grid', placeItems: 'center', padding: 8, marginBottom: 6 }}>
              <ShapeThumb shape={outline.shape} extra={outline.inner ? [outline.inner] : undefined} label="Outline" />
            </div>
          )}
          <Collapsible title="Specifications">
            <KV rows={specRows(ctype, component)} />
          </Collapsible>
          <Collapsible title={`Used by (${usedBy.length})`}>
            {usedBy.length === 0 ? (
              <p className={ui['muted']}>No catalog keyboard ships with this part.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                {usedBy.map((k) => (
                  <li key={k.id}><Link to={`/keyboard/${k.slug}`}>{k.brand} {k.model}</Link></li>
                ))}
              </ul>
            )}
          </Collapsible>
          {declared.length > 0 && (
            <Collapsible title="Declared relations">
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6, fontSize: 13 }}>
                {declared.map((r, i) => (
                  <li key={i}>
                    {r.kind === 'declared-incompatible' ? '✕' : '✓'} {r.from.type} <span className="mono">{r.from.id}</span> → {r.to.type} <span className="mono">{r.to.id}</span>
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
          <Collapsible title="Sources & precision" defaultOpen={false}>
            <SourcesPanel sources={sources} confidence={conf} />
          </Collapsible>
        </aside>
      </div>
    </div>
  );
}
