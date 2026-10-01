import { useMemo } from 'react';
import { evaluateBuild } from '../compatibility/CompatibilityEngine';
import { BuildCompatibility } from '../components/CompatibilityPanel';
import { Icon } from '../components/Icon';
import { PartViewer } from '../components/PartViewer';
import ui from '../components/ui.module.css';
import type { AssemblySelection } from '../geometry/3d/KeyboardAssembly';
import { LAYOUT_BUILDERS, buildLayout } from '../geometry/layouts';
import { useDocumentTitle } from '../hooks';
import { COMPONENT_LABEL, db, getComponent, type AnyComponent } from '../services/database';
import { inferLayout } from '../services/layout';
import { useBuildStore } from '../stores';
import type { Case, ComponentType, Daughterboard, Foam, Keycap, LayoutName, PCB, Plate, Stabilizer, Switch, Verdict } from '../types/keyboard';
import { VERDICT_LABEL, cx } from '../utils/format';
import styles from './Pages.module.css';

type Slot = { type: ComponentType; key: 'caseId' | 'pcbId' | 'plateId' | 'daughterboardId' | 'switchId' | 'keycapId' | 'stabilizerId' | 'foamId'; list: AnyComponent[]; required?: boolean };

const SLOTS: Slot[] = [
  { type: 'case', key: 'caseId', list: db.cases },
  { type: 'pcb', key: 'pcbId', list: db.pcbs },
  { type: 'plate', key: 'plateId', list: db.plates },
  { type: 'daughterboard', key: 'daughterboardId', list: db.daughterboards },
  { type: 'switch', key: 'switchId', list: db.switches },
  { type: 'keycap', key: 'keycapId', list: db.keycaps },
  { type: 'stabilizer', key: 'stabilizerId', list: db.stabilizers },
  { type: 'foam', key: 'foamId', list: db.foams },
];

const nameOf = (c: AnyComponent) => `${(c as { brand?: string }).brand ?? ''} ${(c as { model?: string }).model ?? c.id}`.trim();

export default function BuildPage() {
  useDocumentTitle('Build your keyboard');
  const state = useBuildStore();

  const selection = useMemo<AssemblySelection>(() => {
    const c = getComponent<Case>('case', state.caseId);
    const pcb = getComponent<PCB>('pcb', state.pcbId);
    const plate = getComponent<Plate>('plate', state.plateId);
    return {
      case: c,
      pcb,
      plate,
      daughterboard: getComponent<Daughterboard>('daughterboard', state.daughterboardId),
      switch: getComponent<Switch>('switch', state.switchId) ?? db.switches[0],
      keycap: getComponent<Keycap>('keycap', state.keycapId) ?? db.keycaps[0],
      stabilizer: getComponent<Stabilizer>('stabilizer', state.stabilizerId),
      foam: getComponent<Foam>('foam', state.foamId),
      layout: inferLayout({ pcb, plate, case: c }, state.layoutName),
    };
  }, [state.caseId, state.pcbId, state.plateId, state.daughterboardId, state.switchId, state.keycapId, state.stabilizerId, state.foamId, state.layoutName]);

  const evaluation = useMemo(() => evaluateBuild(selection), [selection]);

  // verdict of every option if it replaced the current choice of that slot (so the dropdowns guide you)
  const hints = useMemo(() => {
    const out: Record<string, Verdict | undefined> = {};
    for (const slot of SLOTS) {
      if (!['case', 'pcb', 'plate', 'daughterboard'].includes(slot.type)) continue;
      const others = Object.entries({ case: selection.case, pcb: selection.pcb, plate: selection.plate, daughterboard: selection.daughterboard }).filter(([t, v]) => t !== slot.type && v);
      if (others.length === 0) continue;
      for (const opt of slot.list) {
        const e = evaluateBuild({ ...selection, [slot.type]: opt });
        out[`${slot.type}:${opt.id}`] = e.verdict;
      }
    }
    return out;
  }, [selection]);

  const modelKey = JSON.stringify([state.caseId, state.pcbId, state.plateId, state.daughterboardId, state.switchId, state.keycapId, state.foamId, selection.layout?.name]);
  const hasAny = !!(selection.case || selection.pcb || selection.plate || selection.daughterboard);
  const layoutNames = Object.keys(LAYOUT_BUILDERS) as LayoutName[];

  const selects = (
    <div style={{ display: 'grid', gap: 12 }}>
      {SLOTS.map((slot) => {
        const value = state[slot.key] ?? '';
        return (
          <label key={slot.type} style={{ display: 'grid', gap: 4 }}>
            <span className={ui['label']} style={{ margin: 0 }}>{slot.type === 'keycap' ? 'Keycaps' : COMPONENT_LABEL[slot.type]}</span>
            <select className={ui['field']} value={value} onChange={(e) => state.set(slot.type, e.target.value || undefined)}>
              <option value="">— none —</option>
              {slot.list.map((opt) => {
                const v = hints[`${slot.type}:${opt.id}`];
                return (
                  <option key={opt.id} value={opt.id}>
                    {nameOf(opt)}
                    {v ? `  ·  ${v === 'compatible' ? '✓' : v === 'tight' ? '⚠' : v === 'incompatible' ? '✕' : '?'} ${VERDICT_LABEL[v]}` : ''}
                  </option>
                );
              })}
            </select>
          </label>
        );
      })}
      <label style={{ display: 'grid', gap: 4 }}>
        <span className={ui['label']} style={{ margin: 0 }}>Layout (for keycaps)</span>
        <select className={ui['field']} value={state.layoutName ?? ''} onChange={(e) => state.setLayout((e.target.value || undefined) as LayoutName | undefined)}>
          <option value="">Auto{selection.layout ? ` (${selection.layout.name})` : ' (unknown)'}</option>
          {layoutNames.map((n) => (
            <option key={n} value={n}>{n} · {buildLayout(n)?.keyCount} keys</option>
          ))}
        </select>
      </label>
      <button className={ui['btn']} onClick={() => state.reset()}>
        <Icon name="reset" size={16} /> Reset
      </button>
    </div>
  );

  return (
    <div className={styles['page']}>
      <div className={styles['pageHead']}>
        <div>
          <h1>Build your keyboard</h1>
          <p className={styles['lead']}>Pick parts and see — in 2D and 3D — whether they fit. The summary uses the same geometry checks as the “Find compatible” search.</p>
        </div>
      </div>

      <div className={styles['split']} style={{ gridTemplateColumns: undefined }}>
        <div className={styles['stack']}>
          {hasAny ? (
            <PartViewer
              selection={selection}
              modelKey={modelKey}
              defaultView="top"
              extra3d={{ title: 'Compatibility', node: <BuildCompatibility evaluation={evaluation} /> }}
            />
          ) : (
            <div className={styles['empty']}>
              <strong>Start with a case or a PCB</strong>
              <span>Choose parts on the right (or below on a phone). Everything you pick appears here.</span>
            </div>
          )}
          <section className={ui['cardPad']} aria-labelledby="h-b-compat">
            <h2 id="h-b-compat" className={ui['sectionTitle']} style={{ marginBottom: 10 }}>Compatibility</h2>
            <BuildCompatibility evaluation={evaluation} />
          </section>
        </div>
        <aside className={cx(ui['cardPad'])} aria-label="Parts">
          <h2 className={ui['sectionTitle']} style={{ marginBottom: 12 }}>Parts</h2>
          {selects}
        </aside>
      </div>
    </div>
  );
}
