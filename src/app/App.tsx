import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import HomePage from '../pages/HomePage';
import NotFound from '../pages/NotFound';
import ui from '../components/ui.module.css';

// Code splitting: each page is its own chunk; the 3D viewer is a further lazy chunk inside the pages.
const SearchPage = lazy(() => import('../pages/SearchPage'));
const KeyboardPage = lazy(() => import('../pages/KeyboardPage'));
const ComponentPage = lazy(() => import('../pages/ComponentPage'));
const ComparePage = lazy(() => import('../pages/ComparePage'));
const BuildPage = lazy(() => import('../pages/BuildPage'));
const ImportPage = lazy(() => import('../pages/ImportPage'));

function Loading() {
  return (
    <div className={ui['row']} style={{ padding: 32, justifyContent: 'center' }} role="status">
      <span className={ui['spin']} /> Loading…
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="keyboard/:slug" element={<KeyboardPage />} />
            <Route path="component/:type/:slug" element={<ComponentPage />} />
            <Route path="compare" element={<ComparePage />} />
            <Route path="build" element={<BuildPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
