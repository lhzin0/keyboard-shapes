import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { catalog, parseQuery, search } from '../search';
import styles from '../layouts/Shell.module.css';
import { cx } from '../utils/format';

/**
 * Global search. Typing a product URL offers the importer instead of a text search.
 * Examples that work: "65%", "tkl", "pcb", "case", "327mm", "reference 75".
 */
export function SearchBar({ big, placeholder, initial = '' }: { big?: boolean; placeholder?: string; initial?: string }) {
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const navigate = useNavigate();
  const listId = useId();
  const parsed = useMemo(() => parseQuery(q), [q]);
  const hits = useMemo(() => (q.trim() && !parsed.isUrl ? search(catalog(), q).slice(0, 6) : []), [q, parsed.isUrl]);

  const go = (target: string) => {
    setOpen(false);
    navigate(target);
  };
  const submit = () => {
    if (!q.trim()) return;
    if (parsed.isUrl) go(`/import?url=${encodeURIComponent(q.trim())}`);
    else if (active >= 0 && hits[active]) go(hits[active].item.href);
    else go(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className={cx(styles['search'], big && styles['big'])} role="search">
      <Icon name={parsed.isUrl ? 'link' : 'search'} className={styles['searchIcon']} size={big ? 20 : 17} />
      <input
        className={styles['searchInput']}
        type="search"
        value={q}
        placeholder={placeholder ?? 'Search keyboards, cases, PCBs… or paste a URL'}
        aria-label="Search"
        aria-expanded={open && (hits.length > 0 || parsed.isUrl)}
        aria-controls={listId}
        aria-autocomplete="list"
        role="combobox"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, -1));
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (hits.length > 0 || parsed.isUrl) && (
        <ul id={listId} className={styles['suggest']} role="listbox">
          {parsed.isUrl && (
            <li role="option" aria-selected={false}>
              <button onMouseDown={(e) => e.preventDefault()} onClick={submit}>
                <span>Import this product page</span>
                <small>URL</small>
              </button>
            </li>
          )}
          {hits.map((h, i) => (
            <li key={`${h.item.kind}:${h.item.id}`} role="option" aria-selected={i === active}>
              <a
                href={h.item.href}
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  go(h.item.href);
                }}
              >
                <span>{h.item.title}</span>
                <small>{h.item.kind === 'keyboard' ? h.item.layout : h.item.kind}</small>
              </a>
            </li>
          ))}
          {!parsed.isUrl && q.trim() && (
            <li>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => go(`/search?q=${encodeURIComponent(q.trim())}`)}>
                <span>See all results for “{q.trim()}”</span>
                <small>↵</small>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
