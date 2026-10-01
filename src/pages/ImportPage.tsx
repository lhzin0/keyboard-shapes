import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { PartViewer } from '../components/PartViewer';
import { PrecisionBadge } from '../components/Badges';
import ui from '../components/ui.module.css';
import { buildDraft, type Draft } from '../import/DraftBuilder';
import { browserFetcher } from '../import/fetcher';
import { detectLayoutFromText } from '../import/LayoutDetector';
import { deriveBrandModel } from '../import/naming';
import { ProductImporter, buildChecklist, type ImportResult } from '../import/ProductImporter';
import { holesToMountingPoints, type ProfileResult, type ReconstructResult } from '../import/ShapeReconstructor';
import { ImportFetchError, type ProductData } from '../import/types';
import { KEY_PITCH_MM, LAYOUT_BUILDERS, buildLayout } from '../geometry/layouts';
import { useDocumentTitle } from '../hooks';
import { db } from '../services/database';
import { listImports, removeImport, saveImport } from '../services/userData';
import type { LayoutName, SourceInfo } from '../types/keyboard';
import { cx } from '../utils/format';
import type { LookupResult } from '../import/lookup';
import { CrossCheckStep } from './import/CrossCheckStep';
import { ImageStep, candidatesToPicked, type PickedImage } from './import/ImageStep';
import styles from './Pages.module.css';

const LAYOUTS: LayoutName[] = ['40%', '50%', '60%', '65%', '70%', '75%', '80%', 'TKL', '96%', '1800', 'Full Size', 'Alice', 'Split', 'Ergo', 'Custom'];

interface Form {
  brand: string;
  model: string;
  layout: LayoutName;
  width: string;
  depth: string;
  height: string;
  frontHeight: string;
  rearHeight: string;
}
const emptyForm: Form = { brand: '', model: '', layout: 'Custom', width: '', depth: '', height: '', frontHeight: '', rearHeight: '' };

function formFromProduct(p: ProductData): Form {
  const { brand, model } = deriveBrandModel(p);
  return {
    brand,
    model,
    layout: p.layoutHint?.layout ?? 'Custom',
    width: p.dimensions?.width?.value?.toString() ?? '',
    depth: p.dimensions?.depth?.value?.toString() ?? '',
    height: p.dimensions?.height?.value?.toString() ?? '',
    frontHeight: p.dimensions?.frontHeight?.value?.toString() ?? '',
    rearHeight: p.dimensions?.rearHeight?.value?.toString() ?? '',
  };
}

const errorHelp: Record<string, string> = {
  'network-or-cors': 'Browsers can only read pages that explicitly allow it (CORS), and most shops do not. Nothing is wrong with the URL.',
  blocked: 'The site answered with an access challenge, CAPTCHA, login wall or rate limit. KeyboardShapes does not bypass protections.',
  'robots-disallowed': 'The site’s robots.txt asks automated tools not to fetch this page.',
  'not-found': 'The page does not exist (404).',
  'not-html': 'The URL does not point to a web page.',
  'invalid-url': 'That does not look like a valid http(s) URL.',
  'http-error': 'The site returned an error.',
};

export default function ImportPage() {
  useDocumentTitle('Import');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [url, setUrl] = useState(params.get('url') ?? '');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<ImportFetchError | Error | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [html, setHtml] = useState('');
  const [mode, setMode] = useState<'url' | 'html' | 'lookup' | 'manual'>('url');
  /** Provenance when the values come from a multi-site cross-check instead of one page. */
  const [crossSources, setCrossSources] = useState<SourceInfo[]>([]);
  const [form, setForm] = useState<Form>(emptyForm);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [shape, setShape] = useState<ReconstructResult | null>(null);
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [saved, setSaved] = useState(0);
  const [estimatedDims, setEstimatedDims] = useState(false);
  const autoRan = useRef(false);

  const importer = useMemo(
    () =>
      new ProductImporter({
        fetcher: browserFetcher,
        robotsFetch: async (u) => {
          const r = await fetch(u, { credentials: 'omit' });
          return { status: r.status, text: await r.text() };
        },
        userAgent: 'KeyboardShapesBot',
      }),
    [],
  );

  const apply = (r: ImportResult) => {
    setResult(r);
    setForm(formFromProduct(r.product));
    setImages(candidatesToPicked(r.product.images, r.product.name ?? ''));
    setShape(null);
    setProfile(null);
    setStatus('done');
    setError(null);
  };

  const run = async () => {
    setStatus('loading');
    setError(null);
    try {
      apply(await importer.import(url));
    } catch (e) {
      setError(e as Error);
      setStatus('error');
    }
  };

  const runHtml = () => {
    try {
      const base = (() => {
        try {
          return importer.normalizeUrl(url || 'https://pasted.invalid/');
        } catch {
          return 'https://pasted.invalid/';
        }
      })();
      apply(importer.importHtml(html, base));
    } catch (e) {
      setError(e as Error);
      setStatus('error');
    }
  };

  const applyLookup = (lr: LookupResult) => {
    const r = lr.reconciled;
    const { brand, model } = deriveBrandModel({ name: r.name, brand: r.brand, url: r.sources[0]?.sourceUrl ?? '' });
    setResult(null);
    setCrossSources(r.sources);
    setForm({
      brand,
      model,
      layout: r.layout?.value ?? 'Custom',
      width: r.width ? String(r.width.value) : '',
      depth: r.depth ? String(r.depth.value) : '',
      height: r.height ? String(r.height.value) : '',
      frontHeight: r.frontHeight ? String(r.frontHeight.value) : '',
      rearHeight: r.rearHeight ? String(r.rearHeight.value) : '',
    });
    setImages(candidatesToPicked(r.images, r.name ?? ''));
    setShape(null);
    setProfile(null);
    setEstimatedDims(false);
    setStatus('done');
    setError(null);
  };

  const startManual = () => {
    setResult(null);
    setCrossSources([]);
    setForm(emptyForm);
    setImages([]);
    setShape(null);
    setProfile(null);
    setStatus('done');
    setMode('manual');
  };

  useEffect(() => {
    if (params.get('url') && !autoRan.current) {
      autoRan.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const widthN = Number(form.width.replace(',', '.'));
  const depthN = Number(form.depth.replace(',', '.'));
  const heightN = Number(form.height.replace(',', '.'));
  const frontN = Number(form.frontHeight.replace(',', '.'));
  const rearN = Number(form.rearHeight.replace(',', '.'));
  const dimsOk = widthN > 0 && depthN > 0 || !!shape;

  const draft: Draft | null = useMemo(() => {
    if (status !== 'done' || !form.brand.trim() || !form.model.trim() || !dimsOk) return null;
    const sources: SourceInfo[] = [
      ...(result?.product.sources ?? []),
      ...crossSources,
      ...(shape ? [{ sourceName: 'KeyboardShapes shape reconstructor', sourceType: 'photo-reconstruction' as const, retrievedAt: new Date().toISOString(), method: shape.steps.join(' → '), confidence: shape.confidence.score }] : []),
      ...(estimatedDims ? [{ sourceName: 'Estimated from the key map', sourceType: 'parametric-reference' as const, retrievedAt: new Date().toISOString(), method: 'key area of the reference key map + nominal 8 mm bezel (the page publishes no dimensions)', confidence: 0.25 }] : []),
      ...(!result && crossSources.length === 0 ? [{ sourceName: 'Manual entry', sourceType: 'user-measurement' as const, retrievedAt: new Date().toISOString(), method: 'entered by the user', confidence: 0.5 }] : []),
    ];
    return buildDraft({
      brand: form.brand.trim(),
      model: form.model.trim(),
      layout: form.layout,
      widthMm: widthN || shape?.shape.width || 0,
      depthMm: depthN || shape?.shape.depth || 0,
      heightMm: heightN > 0 ? heightN : undefined,
      frontHeightMm: frontN > 0 ? frontN : undefined,
      rearHeightMm: rearN > 0 ? rearN : undefined,
      shape: shape?.shape,
      shapeConfidence: shape?.confidence,
      holes: shape ? holesToMountingPoints(shape.holes, 'ph') : undefined,
      profile: profile?.profile,
      sources,
      imageUrls: images.filter((i) => !i.uploaded).map((i) => i.url),
      existingSlugs: new Set(db.keyboards.map((k) => k.slug)),
    });
  }, [status, form, dimsOk, widthN, depthN, heightN, frontN, rearN, shape, profile, images, result, estimatedDims, crossSources]);

  const checklist = useMemo(() => (result ? buildChecklist(result.product) : []), [result]);
  const cliCmd = `npm run import -- --url="${url || 'https://example.com/product'}"`;
  const layoutHint = useMemo(() => detectLayoutFromText(`${form.brand} ${form.model} ${result?.product.description ?? ''}`), [form.brand, form.model, result]);

  const confirm = () => {
    if (!draft) return;
    const ok = saveImport(draft.keyboard, draft.case);
    setSaved((n) => n + 1);
    if (!ok) alert('Could not save in this browser (storage blocked or full). Use “Download JSON” instead.');
    else navigate(`/keyboard/${draft.keyboard.slug}`);
  };

  const download = () => {
    if (!draft) return;
    const blob = new Blob([JSON.stringify({ keyboards: [draft.keyboard], cases: [draft.case] }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.keyboard.slug}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const myImports = useMemo(() => listImports(), [saved]);
  const pf = <K extends keyof Form>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (k === 'width' || k === 'depth') setEstimatedDims(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  /** Last resort when the page publishes no size: key area of the reference key map + a nominal bezel. Flagged as estimated. */
  const estimateFromLayout = () => {
    const l = buildLayout(form.layout);
    if (!l) return;
    const BEZEL = 8;
    setForm((f) => ({ ...f, width: (l.widthU * KEY_PITCH_MM + 2 * BEZEL).toFixed(1), depth: (l.heightU * KEY_PITCH_MM + 2 * BEZEL + 2).toFixed(1) }));
    setEstimatedDims(true);
  };

  return (
    <div className={styles['page']}>
      <div className={styles['pageHead']}>
        <div>
          <h1>Import a product</h1>
          <p className={styles['lead']}>Paste a product URL; KeyboardShapes extracts what the page publishes (JSON-LD, OpenGraph, spec tables), classifies the images and — with a known dimension to calibrate — reconstructs the outline in millimetres.</p>
        </div>
      </div>

      <div className={ui['notice']} style={{ marginBottom: 16 }} role="note">
        <Icon name="info" size={16} />
        <span>
          Not every URL can be read from a browser. Sites that block cross-origin reads, show a CAPTCHA, require a login or disallow automation in robots.txt are <strong>not</strong> bypassed — use the CLI, paste the page HTML, upload images, or enter data manually. Unknown values stay unknown.
        </span>
      </div>

      <section className={ui['cardPad']} style={{ display: 'grid', gap: 12 }} aria-labelledby="h-src">
        <h2 id="h-src" className={ui['sectionTitle']}>1 · Source</h2>
        <div className={styles['tabs']} role="tablist" style={{ marginBottom: 0 }}>
          {([['url', 'From URL'], ['html', 'Paste page HTML'], ['lookup', 'Cross-check sites'], ['manual', 'Manual / images']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={mode === id} className={styles['tab']} onClick={() => (id === 'manual' ? startManual() : setMode(id))}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'url' && (
          <form onSubmit={(e) => { e.preventDefault(); void run(); }} className={ui['row']} style={{ flexWrap: 'nowrap' }}>
            <input className={ui['field']} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… product page" aria-label="Product URL" inputMode="url" />
            <button className={cx(ui['btn'], ui['primary'])} type="submit" disabled={status === 'loading' || !url.trim()}>
              {status === 'loading' ? <span className={ui['spin']} /> : <Icon name="import" size={16} />} Import
            </button>
          </form>
        )}
        {mode === 'html' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <input className={ui['field']} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Original URL (used to resolve image links, optional)" aria-label="Original URL" />
            <textarea className={ui['field']} rows={6} value={html} onChange={(e) => setHtml(e.target.value)} placeholder="Open the product page, “View source”, copy everything and paste it here." aria-label="Page HTML" />
            <div><button className={cx(ui['btn'], ui['primary'])} onClick={runHtml} disabled={!html.trim()}>Parse HTML</button></div>
          </div>
        )}

        {mode === 'lookup' && <CrossCheckStep onApply={applyLookup} />}

        {status === 'error' && error && (
          <div className={ui['noticeFail']} role="alert" style={{ display: 'grid' }}>
            <strong>{error instanceof ImportFetchError ? 'Could not import this URL' : 'Import failed'}</strong>
            <span>{error.message}</span>
            {error instanceof ImportFetchError && <span>{errorHelp[error.reason]}</span>}
            <div className={ui['row']} style={{ marginTop: 6 }}>
              <button className={ui['btn']} onClick={() => setMode('html')}>Paste the page HTML</button>
              <button className={ui['btn']} onClick={startManual}>Upload images / enter manually</button>
            </div>
            <span>Or run it locally (no CORS limits; still honours robots.txt):</span>
            <code className="mono" style={{ overflowWrap: 'anywhere', background: 'var(--surface-2)', padding: '6px 8px', borderRadius: 6 }}>{cliCmd}</code>
          </div>
        )}
      </section>

      {status === 'done' && (
        <>
          <section className={ui['cardPad']} style={{ marginTop: 16, display: 'grid', gap: 14 }} aria-labelledby="h-prev">
            <h2 id="h-prev" className={ui['sectionTitle']}>2 · What was found</h2>
            {result && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
                {checklist.map((c) => (
                  <div key={c.label} className={ui['row']} style={{ gap: 8, alignItems: 'flex-start' }}>
                    <span className={cx(ui['badge'], ui[c.status === 'ok' ? 'ok' : c.status === 'missing' ? 'fail' : 'unknown'])} aria-hidden="true">{c.status === 'ok' ? '✓' : c.status === 'missing' ? '✕' : '?'}</span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 14 }}>{c.label}</strong>
                      {c.detail && <div className={ui['muted']} style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{c.detail.slice(0, 90)}</div>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {result && result.product.warnings.map((w) => (
              <p key={w} className={ui['noticeWarn']}>⚠ {w}</p>
            ))}
            {result && result.product.sources.length > 0 && (
              <p className={ui['muted']} style={{ fontSize: 12 }}>
                Parsers: {result.parsersUsed.join(', ')} · robots.txt: {result.robots === 'allowed' ? 'checked, allowed' : 'could not be checked from the browser'} · dimension source type:{' '}
                <PrecisionBadge level={result.product.dimensions?.width?.source === 'manufacturer' ? 'official' : 'estimated'} />
              </p>
            )}

            <h3 style={{ fontSize: 15 }}>Correct anything that is wrong</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <label><span className={ui['label']}>Brand</span><input className={ui['field']} value={form.brand} onChange={pf('brand')} /></label>
              <label><span className={ui['label']}>Model</span><input className={ui['field']} value={form.model} onChange={pf('model')} /></label>
              <label>
                <span className={ui['label']}>Layout</span>
                <select className={ui['field']} value={form.layout} onChange={pf('layout')}>
                  {LAYOUTS.map((l) => (
                    <option key={l} value={l}>{l}{LAYOUT_BUILDERS[l] ? '' : ' (no key map)'}</option>
                  ))}
                </select>
              </label>
              <label><span className={ui['label']}>Width (mm)</span><input className={ui['field']} inputMode="decimal" value={form.width} onChange={pf('width')} /></label>
              <label><span className={ui['label']}>Depth (mm)</span><input className={ui['field']} inputMode="decimal" value={form.depth} onChange={pf('depth')} /></label>
              <label><span className={ui['label']}>Height (mm)</span><input className={ui['field']} inputMode="decimal" value={form.height} onChange={pf('height')} /></label>
              <label><span className={ui['label']}>Front height (mm)</span><input className={ui['field']} inputMode="decimal" value={form.frontHeight} onChange={pf('frontHeight')} /></label>
              <label><span className={ui['label']}>Rear height (mm)</span><input className={ui['field']} inputMode="decimal" value={form.rearHeight} onChange={pf('rearHeight')} /></label>
            </div>
            {!(widthN > 0 && depthN > 0) && !shape && LAYOUT_BUILDERS[form.layout] && (
              <p className={ui['noticeWarn']}>
                <span>
                  No dimensions yet. Enter them (a product page usually lists them under “specifications”), calibrate with an image below, or{' '}
                  <button className={cx(ui['btn'], ui['small'])} onClick={estimateFromLayout}>estimate them from the {form.layout} key map</button> — the result is clearly marked <em>estimated</em>.
                </span>
              </p>
            )}
            {estimatedDims && <p className={ui['noticeWarn']}>⚠ Width and depth are estimated from the key map (key area + 8 mm bezel), not taken from the product.</p>}
            {layoutHint.layout !== 'Custom' && layoutHint.layout !== form.layout && (
              <p className={ui['muted']} style={{ fontSize: 13 }}>
                The text suggests <strong>{layoutHint.layout}</strong> ({layoutHint.reasons[0]}).{' '}
                <button className={cx(ui['btn'], ui['small'])} onClick={() => setForm((f) => ({ ...f, layout: layoutHint.layout }))}>Use it</button>
              </p>
            )}
          </section>

          <section className={ui['cardPad']} style={{ marginTop: 16 }} aria-labelledby="h-img">
            <h2 id="h-img" className={ui['sectionTitle']} style={{ marginBottom: 10 }}>3 · Images &amp; reconstruction</h2>
            <ImageStep
              images={images}
              onImages={setImages}
              widthMm={widthN || undefined}
              depthMm={depthN || undefined}
              shape={shape}
              profile={profile}
              onShape={setShape}
              onProfile={setProfile}
            />
          </section>

          <section className={ui['cardPad']} style={{ marginTop: 16, display: 'grid', gap: 12 }} aria-labelledby="h-draft">
            <h2 id="h-draft" className={ui['sectionTitle']}>4 · Preview &amp; confirm</h2>
            {!draft ? (
              <p className={ui['muted']}>Fill in brand, model and dimensions (or reconstruct an outline) to preview the 2D model.</p>
            ) : (
              <>
                <div className={ui['row']}>
                  <PrecisionBadge level={draft.case.confidence.level} score={draft.case.confidence.score} />
                  <span className="mono">{draft.case.dimensions.width.toFixed(1)} × {draft.case.dimensions.depth.toFixed(1)} mm</span>
                  <span className={ui['badge']}>{draft.keyboard.layout.name}{draft.keyboard.layout.keyCount ? ` · ${draft.keyboard.layout.keyCount} keys` : ''}</span>
                </div>
                {draft.warnings.map((w) => (
                  <p key={w} className={ui['noticeWarn']}>⚠ {w}</p>
                ))}
                <div className={styles['viewerBox']} style={{ height: 460 }}>
                  <PartViewer
                    selection={{ case: draft.case, layout: draft.keyboard.layout, profile: draft.keyboard.profile }}
                    modelKey={draft.keyboard.id + JSON.stringify(draft.case.dimensions)}
                    defaultView="top"
                  />
                </div>
                <p className={ui['muted']} style={{ fontSize: 13 }}>
                  Key positions are a reference key map centred in the outline (estimated). Internal parts are unknown, so compatibility checks will answer “unknown” — never “compatible”.
                </p>
                <div className={ui['row']}>
                  <button className={cx(ui['btn'], ui['primary'])} onClick={confirm}>
                    <Icon name="check" size={16} /> Confirm &amp; save in this browser
                  </button>
                  <button className={ui['btn']} onClick={download}>
                    <Icon name="upload" size={16} /> Download JSON (for the repo)
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {myImports.length > 0 && (
        <section className={ui['cardPad']} style={{ marginTop: 16 }} aria-labelledby="h-mine">
          <h2 id="h-mine" className={ui['sectionTitle']} style={{ marginBottom: 10 }}>Saved in this browser</h2>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {myImports.map((k) => (
              <li key={k.id} className={ui['row']} style={{ justifyContent: 'space-between' }}>
                <a href={`${import.meta.env.BASE_URL}keyboard/${k.slug}`} onClick={(e) => { e.preventDefault(); navigate(`/keyboard/${k.slug}`); }}>{k.brand} {k.model}</a>
                <button className={cx(ui['btn'], ui['small'])} onClick={() => { removeImport(k.id); setSaved((n) => n + 1); }}>
                  <Icon name="trash" size={14} /> Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
