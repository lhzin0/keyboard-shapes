import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { findCompatible } from '../compatibility/CompatibilityEngine';
import { VerdictBadge } from '../components/Badges';
import { ItemCard } from '../components/Cards';
import { Icon } from '../components/Icon';
import { SearchBar } from '../components/SearchBar';
import ui from '../components/ui.module.css';
import { useDocumentTitle } from '../hooks';
import { catalog } from '../search';
import { compatDb, db } from '../services/database';
import { cx } from '../utils/format';
import styles from './Pages.module.css';

export default function HomePage() {
  useDocumentTitle('');
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const items = useMemo(() => catalog(), []);
  const keyboards = items.filter((i) => i.kind === 'keyboard');
  const recent = useMemo(() => [...db.keyboards].sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '')).slice(0, 4), []);

  const layouts = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of db.keyboards) m.set(k.layout.name, (m.get(k.layout.name) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  // live examples of the engine: what fits the 65% reference PCB?
  const pairs = useMemo(() => {
    const groups = findCompatible({ type: 'pcb', id: 'ref-65-pcb-a' }, compatDb);
    const cases = groups.find((g) => g.type === 'case')?.matches ?? [];
    const pick = ['ref-65-case-a', 'ref-65-case-b', 'ref-60-case-a'];
    return pick.map((id) => cases.find((m) => m.item.id === id)).filter((m): m is NonNullable<typeof m> => !!m);
  }, []);

  return (
    <div className={styles['page']}>
      <section className={styles['hero']}>
        <h1>
          Compare keyboards by <span>shape</span> and <span>compatibility</span>.
        </h1>
        <p className={styles['lead']}>
          Not just keyboards: every case, PCB, plate and daughterboard as real geometry in millimetres — so you can see whether the parts actually fit.
        </p>
        <div className={styles['heroSearch']}>
          <SearchBar big placeholder="Search “65%”, “tkl”, “pcb”, “327mm”…" />
        </div>
        <form
          className={cx(styles['heroSearch'], ui['row'])}
          style={{ flexWrap: 'nowrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) navigate(`/import?url=${encodeURIComponent(url.trim())}`);
          }}
        >
          <input className={ui['field']} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a product URL" aria-label="Product URL to import" inputMode="url" />
          <button className={cx(ui['btn'], ui['primary'])} type="submit">
            <Icon name="import" size={16} />
            Import
          </button>
        </form>
        <div className={styles['heroActions']}>
          <Link to="/build" className={ui['btn']}>
            <Icon name="build" size={16} /> Build your keyboard
          </Link>
          <Link to="/compare" className={ui['btn']}>
            <Icon name="compare" size={16} /> Compare shapes
          </Link>
        </div>
      </section>

      <p className={ui['notice']} role="note">
        <Icon name="info" size={16} />
        <span>
          The catalog ships with an <strong>illustrative parametric reference set</strong> (generated from standard ANSI layouts and nominal dimensions). It is not data about commercial products — import real ones with their sources and precision level.
        </span>
      </p>

      <section className={styles['section']} aria-labelledby="h-feat">
        <div className={styles['sectionHead']}>
          <h2 id="h-feat">Featured keyboards</h2>
          <Link to="/search?kind=keyboard">All keyboards →</Link>
        </div>
        <div className={cx('grid')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
          {keyboards.slice(0, 5).map((i) => (
            <ItemCard key={i.id} item={i} />
          ))}
        </div>
      </section>

      <section className={styles['section']} aria-labelledby="h-recent">
        <div className={styles['sectionHead']}>
          <h2 id="h-recent">Recently added</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
          {recent.map((k) => {
            const item = items.find((i) => i.kind === 'keyboard' && i.id === k.id);
            return item ? <ItemCard key={k.id} item={item} compact /> : null;
          })}
        </div>
      </section>

      <section className={styles['section']} aria-labelledby="h-layouts">
        <div className={styles['sectionHead']}>
          <h2 id="h-layouts">Popular layouts</h2>
        </div>
        <div className={styles['layoutChips']}>
          {layouts.map(([name, n]) => (
            <Link key={name} to={`/search?layout=${encodeURIComponent(name)}`} className={ui['chip']} style={{ color: 'var(--text)' }}>
              {name} <span className={ui['muted']} style={{ marginLeft: 6 }}>{n}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles['section']} aria-labelledby="h-compat">
        <div className={styles['sectionHead']}>
          <h2 id="h-compat">Compatible components</h2>
          <Link to="/component/pcb/ref-65-pcb-a">Find compatible cases →</Link>
        </div>
        <p className={ui['muted']} style={{ marginBottom: 12 }}>Live results of the geometry engine for the reference 65% PCB:</p>
        <div className={styles['pairs']}>
          {pairs.map((m) => (
            <Link key={m.item.id} to={`/component/case/${m.item.id}`} className={styles['pair']} style={{ color: 'var(--text)', textDecoration: 'none' }}>
              <span className={styles['pairTitle']}>
                PCB 65% A → {(m.item as { model?: string }).model}
              </span>
              <VerdictBadge verdict={m.result.verdict} />
              <span className={ui['muted']} style={{ fontSize: 13 }}>{m.result.conclusion}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles['section']} aria-labelledby="h-compare">
        <div className={styles['sectionHead']}>
          <h2 id="h-compare">Compare shapes</h2>
        </div>
        <div className={ui['cardPad']} style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <p className={ui['muted']} style={{ maxWidth: '60ch' }}>
            Overlay up to four outlines, align them by front, back or USB, and see exactly where they differ — then check physical compatibility separately. “Similar” never means “compatible”.
          </p>
          <Link className={cx(ui['btn'], ui['primary'])} to="/compare?items=keyboard:ref-60,keyboard:ref-65">
            Try: 60% vs 65%
          </Link>
        </div>
      </section>
    </div>
  );
}
