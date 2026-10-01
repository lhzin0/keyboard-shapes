import { lazy, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AssemblySelection } from '../geometry/3d/KeyboardAssembly';
import { KeyboardFrontView, KeyboardSideView } from '../viewer2d/ProfileViews';
import { KeyboardTopView } from '../viewer2d/KeyboardTopView';
import { cx } from '../utils/format';
import styles from '../pages/Pages.module.css';
import ui from './ui.module.css';

const KeyboardViewer3D = lazy(() => import('../viewer3d/KeyboardViewer3D'));

export type ViewId = 'top' | 'side' | 'front' | '3d';

const TABS: Array<{ id: ViewId; label: string }> = [
  { id: 'top', label: 'Top' },
  { id: 'side', label: 'Side' },
  { id: 'front', label: 'Front' },
  { id: '3d', label: '3D' },
];

interface Props {
  selection: AssemblySelection;
  /** Changes whenever the 3D model has to be rebuilt. */
  modelKey: string;
  defaultView?: ViewId;
  extra3d?: { title: string; node: ReactNode };
  onSelectTop?(c: 'case' | 'pcb' | 'plate' | 'daughterboard' | null): void;
  selectedTop?: 'case' | 'pcb' | 'plate' | 'daughterboard' | null;
  /** Hide the tab for views that make no sense (e.g. nothing to show from the side). */
  hide?: ViewId[];
  className?: string;
}

export function PartViewer({ selection, modelKey, defaultView = 'top', extra3d, onSelectTop, selectedTop, hide = [], className }: Props) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view') as ViewId | null;
  const view: ViewId = requested && TABS.some((t) => t.id === requested) && !hide.includes(requested) ? requested : defaultView;
  const tabs = TABS.filter((t) => !hide.includes(t.id));

  return (
    <div className={className}>
      <div className={styles['tabs']} role="tablist" aria-label="Views">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={view === t.id}
            aria-controls={`panel-${t.id}`}
            className={styles['tab']}
            onClick={() =>
              setParams(
                (p) => {
                  const n = new URLSearchParams(p);
                  n.set('view', t.id);
                  return n;
                },
                { replace: true },
              )
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`} className={cx(styles['viewerBox'])}>
        {view === 'top' && <KeyboardTopView selection={selection} onSelect={onSelectTop} selected={selectedTop} />}
        {view === 'side' && <KeyboardSideView selection={selection} />}
        {view === 'front' && <KeyboardFrontView selection={selection} />}
        {view === '3d' && (
          <Suspense fallback={<div className={ui['row']} style={{ padding: 24 }}><span className={ui['spin']} /> Loading 3D viewer…</div>}>
            <KeyboardViewer3D selection={selection} modelKey={modelKey} extra={extra3d} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
