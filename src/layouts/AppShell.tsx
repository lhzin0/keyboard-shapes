import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { SearchBar } from '../components/SearchBar';
import { useCompareStore, useUiStore } from '../stores';
import { cx } from '../utils/format';
import ui from '../components/ui.module.css';
import styles from './Shell.module.css';

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/build', label: 'Build', icon: 'build' },
  { to: '/compare', label: 'Compare', icon: 'compare' },
  { to: '/import', label: 'Import', icon: 'import' },
];

function Logo() {
  return (
    <NavLink to="/" className={styles['logo']} aria-label="KeyboardShapes home">
      <span className={styles['logoMark']} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
          <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
          <path d="M7 10.5h.01M11 10.5h.01M15 10.5h.01M7 14h10" />
        </svg>
      </span>
      KeyboardShapes
    </NavLink>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const compareCount = useCompareStore((s) => s.items.length);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className={cx(styles['shell'], pathname === '/compare' && styles['immersive'])}>
      <header className={styles['nav']}>
        <Logo />
        <nav className={styles['links']} aria-label="Main">
          {NAV.slice(1).map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cx(styles['link'], isActive && styles['active'])}>
              {n.label}
              {n.to === '/compare' && compareCount > 0 && <span className={styles['count']}>{compareCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className={styles['spacer']} />
        <div className={styles['navSearch']}>
          <SearchBar />
        </div>
        <button className={ui['iconBtn']} onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </header>

      <main className={styles['main']} id="main">
        <Outlet />
      </main>

      <footer className={styles['footer']}>
        KeyboardShapes · geometry-first keyboard analysis. Values marked <em>estimated</em> are not measurements.
      </footer>

      <nav className={styles['bottomNav']} aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx(styles['bottomLink'], isActive && styles['bottomActive'])}>
            <Icon name={n.icon} size={22} />
            {n.label}
            {n.to === '/compare' && compareCount > 0 && <span className={cx(styles['count'], styles['bottomCount'])}>{compareCount}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
