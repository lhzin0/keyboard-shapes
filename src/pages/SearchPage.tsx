import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FEATURES } from '../app/features';
import { ItemCard } from '../components/Cards';
import { Icon } from '../components/Icon';
import { BottomSheet, Segmented } from '../components/Panels';
import { SearchBar } from '../components/SearchBar';
import ui from '../components/ui.module.css';
import { activeFilterCount, applyFilters, emptyFilters, facets, type FilterState, type Range, type Tri } from '../filters';
import { useDocumentTitle, useIsMobile } from '../hooks';
import { catalog, parseQuery, search, type ItemKind } from '../search';
import { COMPONENT_LABEL } from '../services/database';
import { cx } from '../utils/format';
import { Link } from 'react-router-dom';
import styles from './Pages.module.css';

const KINDS: Array<{ id: ItemKind; label: string }> = [
  { id: 'keyboard', label: 'Keyboards' },
  { id: 'case', label: 'Cases' },
  { id: 'pcb', label: 'PCBs' },
  { id: 'plate', label: 'Plates' },
  { id: 'daughterboard', label: 'Daughterboards' },
  { id: 'switch', label: 'Switches' },
  { id: 'keycap', label: 'Keycaps' },
  { id: 'stabilizer', label: 'Stabilizers' },
];

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function RangeFilter({ label, bounds, value, onChange, unit }: { label: string; bounds: Range; value: Range | null; onChange(v: Range | null): void; unit?: string }) {
  if (bounds[0] === bounds[1]) return null;
  const [lo, hi] = value ?? bounds;
  return (
    <div className={styles['filterGroup']}>
      <div className={ui['row']} style={{ justifyContent: 'space-between' }}>
        <span className={ui['label']} style={{ margin: 0 }}>{label}</span>
        <span className="mono" style={{ fontSize: 12 }}>
          {lo}–{hi} {unit}
        </span>
      </div>
      <input type="range" aria-label={`${label} minimum`} min={bounds[0]} max={bounds[1]} value={lo} style={{ accentColor: 'var(--accent)' }} onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])} />
      <input type="range" aria-label={`${label} maximum`} min={bounds[0]} max={bounds[1]} value={hi} style={{ accentColor: 'var(--accent)' }} onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])} />
      {value && (
        <button className={cx(ui['btn'], ui['small'], ui['ghost'])} onClick={() => onChange(null)}>
          Reset
        </button>
      )}
    </div>
  );
}

function Chips({ label, options, selected, onToggle }: { label: string; options: string[]; selected: string[]; onToggle(v: string): void }) {
  if (options.length === 0) return null;
  return (
    <div className={styles['filterGroup']}>
      <span className={ui['label']} style={{ margin: 0 }}>{label}</span>
      <div className={styles['chipWrap']}>
        {options.map((o) => (
          <button key={o} className={ui['chip']} aria-pressed={selected.includes(o)} onClick={() => onToggle(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SearchPage() {
  useDocumentTitle('Search');
  const [params] = useSearchParams();
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  const q = params.get('q') ?? '';
  const [sort, setSort] = useState<'relevance' | 'name' | 'width'>('relevance');

  const all = useMemo(() => catalog(), []);
  const fac = useMemo(() => facets(all), [all]);

  const [filters, setFilters] = useState<FilterState>(() => {
    const f = emptyFilters();
    const kind = params.get('kind');
    if (kind) f.kinds = [kind as ItemKind];
    const layout = params.get('layout');
    if (layout) f.layouts = [layout];
    return f;
  });
  useEffect(() => {
    const kind = params.get('kind');
    const layout = params.get('layout');
    setFilters((f) => ({ ...f, kinds: kind ? [kind as ItemKind] : f.kinds, layouts: layout ? [layout] : f.layouts }));
  }, [params]);

  const results = useMemo(() => {
    const hits = search(all, q);
    const allowed = new Set(applyFilters(hits.map((h) => h.item), filters).map((i) => `${i.kind}:${i.id}`));
    const kept = hits.filter((h) => allowed.has(`${h.item.kind}:${h.item.id}`));
    if (sort === 'name') kept.sort((a, b) => a.item.title.localeCompare(b.item.title));
    if (sort === 'width') kept.sort((a, b) => (b.item.width ?? 0) - (a.item.width ?? 0));
    return kept;
  }, [all, q, filters, sort]);

  const parsed = parseQuery(q);
  const set = (patch: Partial<FilterState>) => setFilters((f) => ({ ...f, ...patch }));
  const n = activeFilterCount(filters);

  const panel = (
    <div className={styles['filters']}>
      <div className={styles['filterGroup']}>
        <span className={ui['label']} style={{ margin: 0 }}>Component type</span>
        <div className={styles['chipWrap']}>
          {KINDS.map((k) => (
            <button key={k.id} className={ui['chip']} aria-pressed={filters.kinds.includes(k.id)} onClick={() => set({ kinds: toggle(filters.kinds, k.id) })}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      <Chips label="Brand" options={fac.brands} selected={filters.brands} onToggle={(v) => set({ brands: toggle(filters.brands, v) })} />
      <Chips label="Layout" options={fac.layouts} selected={filters.layouts} onToggle={(v) => set({ layouts: toggle(filters.layouts, v) })} />
      <RangeFilter label="Width" unit="mm" bounds={fac.width} value={filters.width} onChange={(width) => set({ width })} />
      <RangeFilter label="Depth" unit="mm" bounds={fac.depth} value={filters.depth} onChange={(depth) => set({ depth })} />
      <RangeFilter label="Height" unit="mm" bounds={fac.height} value={filters.height} onChange={(height) => set({ height })} />
      <RangeFilter label="Angle" unit="°" bounds={fac.angle} value={filters.angle} onChange={(angle) => set({ angle })} />
      <RangeFilter label="Keys" bounds={fac.keys} value={filters.keys} onChange={(keys) => set({ keys })} />
      <div className={styles['filterGroup']}>
        <span className={ui['label']} style={{ margin: 0 }}>Wireless</span>
        <Segmented<Tri> label="Wireless" value={filters.wireless} onChange={(wireless) => set({ wireless })} options={[{ value: 'any', label: 'Any' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
      </div>
      <div className={styles['filterGroup']}>
        <span className={ui['label']} style={{ margin: 0 }}>Knob</span>
        <Segmented<Tri> label="Knob" value={filters.knob} onChange={(knob) => set({ knob })} options={[{ value: 'any', label: 'Any' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
      </div>
      <Chips label="Mounting" options={fac.mounting} selected={filters.mounting} onToggle={(v) => set({ mounting: toggle(filters.mounting, v) })} />
      <Chips label="Material" options={fac.materials} selected={filters.materials} onToggle={(v) => set({ materials: toggle(filters.materials, v) })} />
      {FEATURES.compatibility && (
      <div className={styles['filterGroup']}>
        <label className={ui['label']} htmlFor="compat-with" style={{ margin: 0 }}>Compatible with…</label>
        <select
          id="compat-with"
          className={ui['field']}
          value={filters.compatibleWith ? `${filters.compatibleWith.type}:${filters.compatibleWith.id}` : ''}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return set({ compatibleWith: null });
            const [type, ...rest] = v.split(':');
            set({ compatibleWith: { type: type as 'pcb', id: rest.join(':') } });
          }}
        >
          <option value="">Anything</option>
          <optgroup label="PCBs">
            {all.filter((i) => i.kind === 'pcb').map((i) => (
              <option key={i.id} value={`pcb:${i.id}`}>{i.title}</option>
            ))}
          </optgroup>
          <optgroup label="Cases">
            {all.filter((i) => i.kind === 'case').map((i) => (
              <option key={i.id} value={`case:${i.id}`}>{i.title}</option>
            ))}
          </optgroup>
          <optgroup label="Plates">
            {all.filter((i) => i.kind === 'plate').map((i) => (
              <option key={i.id} value={`plate:${i.id}`}>{i.title}</option>
            ))}
          </optgroup>
        </select>
        {filters.compatibleWith && <p className={ui['muted']} style={{ fontSize: 12 }}>Hides everything proven incompatible by the geometry engine. Unknown results stay visible.</p>}
      </div>
      )}
      <button className={ui['btn']} onClick={() => setFilters(emptyFilters())} disabled={n === 0}>
        Clear filters
      </button>
    </div>
  );

  return (
    <div className={styles['page']}>
      <div className={styles['pageHead']}>
        <div>
          <h1>Search</h1>
          <p className={styles['lead']}>{results.length} result{results.length === 1 ? '' : 's'}{q ? ` for “${q}”` : ''}{parsed.mm.length ? ' (dimensions matched within 1 mm)' : ''}</p>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
        <SearchBar key={q} initial={q} placeholder="Try “65%”, “pcb”, “case”, “327mm”, “reference tkl”" />
        <div className={ui['row']}>
          {mobile && (
            <button className={ui['btn']} onClick={() => setSheet(true)}>
              <Icon name="sliders" size={16} /> Filters{n > 0 ? ` (${n})` : ''}
            </button>
          )}
          <label className={ui['row']} style={{ marginLeft: 'auto', gap: 8 }}>
            <span className={ui['muted']} style={{ fontSize: 13 }}>Sort</span>
            <select className={ui['field']} style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="relevance">Relevance</option>
              <option value="name">Name</option>
              <option value="width">Width</option>
            </select>
          </label>
        </div>
      </div>
      <div className={styles['searchLayout']}>
        {!mobile && <aside aria-label="Filters" className={ui['cardPad']}>{panel}</aside>}
        <div>
          {results.length === 0 ? (
            <div className={styles['empty']}>
              <strong>No match</strong>
              <span>Nothing in the catalog matches.{FEATURES.importer && <> {parsed.isUrl ? 'Looks like a URL — ' : 'Have a product page? '}<Link to={`/import${parsed.isUrl ? `?url=${encodeURIComponent(q)}` : ''}`}>import it</Link>.</>}</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
              {results.map((h) => (
                <ItemCard key={`${h.item.kind}:${h.item.id}`} item={h.item} />
              ))}
            </div>
          )}
        </div>
      </div>
      {mobile && (
        <BottomSheet open={sheet} title="Filters" onClose={() => setSheet(false)}>
          {panel}
        </BottomSheet>
      )}
    </div>
  );
}

export { COMPONENT_LABEL };
