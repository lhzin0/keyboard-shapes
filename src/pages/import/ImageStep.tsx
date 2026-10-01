import { useState } from 'react';
import { ConfidenceBadge } from '../../components/Badges';
import { Segmented } from '../../components/Panels';
import ui from '../../components/ui.module.css';
import { classifyImage, isAutoPickable, tokenize } from '../../import/ImageExtractor';
import { loadImageData } from '../../import/imageLoader';
import { holesToMountingPoints, reconstructProfile, reconstructShape, type ReconstructResult, type ProfileResult } from '../../import/ShapeReconstructor';
import type { ImageCandidate, ImageType } from '../../import/types';
import { cx } from '../../utils/format';
import { SvgStage } from '../../viewer2d/SvgStage';
import vstyles from '../../viewer2d/Viewer2D.module.css';
import styles from '../Pages.module.css';

export interface PickedImage {
  /** True when the page declares it as the product's own image AND its name confidently says top/blueprint/side. */
  pickable?: boolean;
  id: string;
  url: string;
  /** Present for uploads — always readable; remote images may be blocked by CORS. */
  file?: File;
  type: ImageType;
  note?: string;
  uploaded?: boolean;
}

const TYPES: ImageType[] = ['TOP', 'SIDE', 'FRONT', 'BACK', 'BLUEPRINT', 'DETAIL', 'UNKNOWN'];

export function candidatesToPicked(c: ImageCandidate[], productName = ''): PickedImage[] {
  const tokens = tokenize(productName);
  return c.slice(0, 18).map((i, n) => ({ id: `r${n}`, url: i.url, type: i.type, note: i.reasons[0], pickable: isAutoPickable(i, ['TOP', 'BLUEPRINT', 'SIDE'], tokens) }));
}

interface Props {
  images: PickedImage[];
  onImages(next: PickedImage[]): void;
  widthMm?: number;
  depthMm?: number;
  shape: ReconstructResult | null;
  profile: ProfileResult | null;
  onShape(r: ReconstructResult | null): void;
  onProfile(r: ProfileResult | null): void;
}

function Thumb({ img, onType, onRemove }: { img: PickedImage; onType(t: ImageType): void; onRemove?(): void }) {
  return (
    <div className={ui['card']} style={{ padding: 8, display: 'grid', gap: 6 }}>
      <img src={img.url} alt={img.note ?? `${img.type} view`} referrerPolicy="no-referrer" loading="lazy" style={{ width: '100%', height: 110, objectFit: 'contain', background: '#fff', borderRadius: 6 }} />
      <select className={ui['field']} style={{ minHeight: 34, padding: '4px 8px' }} value={img.type} aria-label="Image type" onChange={(e) => onType(e.target.value as ImageType)}>
        {TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      {onRemove && (
        <button className={cx(ui['btn'], ui['small'], ui['ghost'])} onClick={onRemove}>Remove</button>
      )}
    </div>
  );
}

/** Image selection, calibration and reconstruction (top → outline, side → profile). */
export function ImageStep({ images, onImages, widthMm, depthMm, shape, profile, onShape, onProfile }: Props) {
  const [busy, setBusy] = useState<'shape' | 'profile' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perspective, setPerspective] = useState<'none' | 'auto'>('none');
  const [useDepth, setUseDepth] = useState(false);
  const [knownW, setKnownW] = useState<string>(widthMm ? String(widthMm) : '');
  const [knownD, setKnownD] = useState<string>(depthMm ? String(depthMm) : '');
  const [frontSide, setFrontSide] = useState<'left' | 'right'>('left');
  const [topId, setTopId] = useState<string | null>(null);
  const [sideId, setSideId] = useState<string | null>(null);

  // never pre-select a guess: only images the page declares as the product's own and that are confidently named
  const top = images.find((i) => i.id === topId) ?? images.find((i) => i.pickable && (i.type === 'TOP' || i.type === 'BLUEPRINT'));
  const side = images.find((i) => i.id === sideId) ?? images.find((i) => i.pickable && i.type === 'SIDE');

  const onUpload = (type: ImageType) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const id = `u${Date.now()}`;
    onImages([...images, { id, url: URL.createObjectURL(f), file: f, type, uploaded: true, note: f.name }]);
    if (type === 'TOP' || type === 'BLUEPRINT') setTopId(id);
    if (type === 'SIDE') setSideId(id);
    e.target.value = '';
  };

  const runShape = async () => {
    setError(null);
    if (!top) return setError('Choose the image to use (button “Use for outline”). Nothing is pre-selected unless the page names it as a top view of this product.');
    const w = Number(knownW.replace(',', '.'));
    const d = Number(knownD.replace(',', '.'));
    if (!(w > 0)) return setError('Enter a known width in mm — an image alone has no scale.');
    setBusy('shape');
    try {
      const data = await loadImageData(top.file ?? top.url);
      const r = reconstructShape(data, { knownWidthMm: w, knownDepthMm: useDepth && d > 0 ? d : undefined, expectedDepthMm: !useDepth && d > 0 ? d : undefined, perspective });
      onShape(r);
    } catch (e) {
      onShape(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runProfile = async () => {
    setError(null);
    if (!side) return setError('Choose the side image (button “Use for profile”) first.');
    const d = Number((knownD || String(shape?.shape.depth ?? '')).replace(',', '.'));
    if (!(d > 0)) return setError('Enter the keyboard depth (front → back) in mm to calibrate the side image.');
    setBusy('profile');
    try {
      const data = await loadImageData(side.file ?? side.url);
      onProfile(reconstructProfile(data, { knownDepthMm: d, frontSide }));
    } catch (e) {
      onProfile(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const bounds = shape ? { minX: -10, minY: -10, maxX: shape.shape.width + 10, maxY: shape.shape.depth + 10 } : { minX: 0, minY: 0, maxX: 100, maxY: 60 };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p className={ui['muted']} style={{ fontSize: 13 }}>
        Images are classified from file names and alt text only — correct the type if it is wrong. Pixel analysis happens here, in your browser; remote images can only be read when their host allows it, otherwise upload the file.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {images.map((img) => (
          <div key={img.id} style={{ outline: img.id === top?.id || img.id === side?.id ? '2px solid var(--accent)' : undefined, borderRadius: 10 }}>
            <Thumb
              img={img}
              onType={(t) => onImages(images.map((i) => (i.id === img.id ? { ...i, type: t } : i)))}
              onRemove={img.uploaded ? () => onImages(images.filter((i) => i.id !== img.id)) : undefined}
            />
            <div className={ui['row']} style={{ gap: 4, marginTop: 4 }}>
              <button className={cx(ui['btn'], ui['small'])} aria-pressed={top?.id === img.id} onClick={() => setTopId(img.id)}>Use for outline</button>
              <button className={cx(ui['btn'], ui['small'])} aria-pressed={side?.id === img.id} onClick={() => setSideId(img.id)}>Use for profile</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {(['TOP', 'SIDE', 'FRONT', 'BLUEPRINT'] as const).map((t) => (
          <label key={t} className={styles['dropzone']} style={{ cursor: 'pointer' }}>
            <span>Upload {t.toLowerCase()}</span>
            <input type="file" accept="image/*" onChange={onUpload(t)} className="sr-only" />
            <span className={cx(ui['btn'], ui['small'])}>Choose file</span>
          </label>
        ))}
      </div>

      <div className={ui['cardPad']} style={{ display: 'grid', gap: 12 }}>
        <h3 className={ui['sectionTitle']}>Calibration</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <label>
            <span className={ui['label']}>Known width (mm)</span>
            <input className={ui['field']} inputMode="decimal" value={knownW} onChange={(e) => setKnownW(e.target.value)} placeholder="e.g. 327" />
          </label>
          <label>
            <span className={ui['label']}>Known depth (mm)</span>
            <input className={ui['field']} inputMode="decimal" value={knownD} onChange={(e) => setKnownD(e.target.value)} placeholder="optional" />
          </label>
        </div>
        <div className={ui['row']}>
          <label className={ui['row']} style={{ gap: 6 }}>
            <input type="checkbox" checked={useDepth} onChange={(e) => setUseDepth(e.target.checked)} /> Use depth too (checks the aspect ratio)
          </label>
          <Segmented<'none' | 'auto'> label="Perspective" value={perspective} onChange={setPerspective} options={[{ value: 'none', label: 'No correction' }, { value: 'auto', label: 'Auto-correct' }]} />
        </div>
        <div className={ui['row']}>
          <button className={cx(ui['btn'], ui['primary'])} disabled={busy !== null} onClick={runShape}>
            {busy === 'shape' ? <span className={ui['spin']} /> : null} Reconstruct outline
          </button>
          <Segmented<'left' | 'right'> label="Front side of the side image" value={frontSide} onChange={setFrontSide} options={[{ value: 'left', label: 'Front = left' }, { value: 'right', label: 'Front = right' }]} />
          <button className={ui['btn']} disabled={busy !== null} onClick={runProfile}>
            {busy === 'profile' ? <span className={ui['spin']} /> : null} Reconstruct side profile
          </button>
        </div>
        {error && <p className={ui['noticeFail']} role="alert">{error}</p>}
      </div>

      {shape && (
        <div className={styles['preview']}>
          <div className={ui['card']} style={{ height: 300, overflow: 'hidden' }}>
            <SvgStage label="Reconstructed outline" bounds={bounds} ruler={false}>
              <path d={`M${shape.shape.points.map((p) => `${p.x},${p.y}`).join('L')}Z`} className={vstyles['caseOutline']} />
              {holesToMountingPoints(shape.holes).map((h) => (
                <circle key={h.id} cx={h.x} cy={h.y} r={(h.diameter ?? 3) / 2} className={vstyles['hole']} />
              ))}
            </SvgStage>
          </div>
          <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
            <div className={ui['row']}>
              <ConfidenceBadge confidence={shape.confidence} />
              <span className="mono">{shape.shape.width.toFixed(1)} × {shape.shape.depth.toFixed(1)} mm</span>
            </div>
            <ul className={styles['stepList']}>
              {shape.steps.map((s) => (
                <li key={s}><span aria-hidden="true">✓</span>{s}</li>
              ))}
            </ul>
            {shape.warnings.map((w) => (
              <p key={w} className={ui['noticeWarn']}>⚠ {w}</p>
            ))}
            <button className={ui['btn']} onClick={() => onShape(null)}>Discard outline</button>
          </div>
        </div>
      )}

      {profile && (
        <div className={ui['cardPad']}>
          <div className={ui['row']}>
            <ConfidenceBadge confidence={profile.confidence} />
            <span className="mono">front {profile.profile.frontHeight} mm · rear {profile.profile.rearHeight} mm · {profile.profile.angle}°</span>
            <button className={cx(ui['btn'], ui['small'])} onClick={() => onProfile(null)}>Discard profile</button>
          </div>
          <ul className={styles['stepList']} style={{ marginTop: 8 }}>
            {profile.steps.map((s) => (
              <li key={s}><span aria-hidden="true">✓</span>{s}</li>
            ))}
          </ul>
          {profile.warnings.map((w) => (
            <p key={w} className={ui['noticeWarn']}>⚠ {w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export { classifyImage };
