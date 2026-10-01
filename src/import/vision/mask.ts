/**
 * Pixel-level segmentation used by the shape reconstructor.
 * Works on plain RGBA buffers, so it runs unchanged in the browser (ImageData),
 * in Web Workers and in Node (pngjs / jpeg-js output).
 */

export interface ImageLike {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface Mask {
  width: number;
  height: number;
  /** 1 = object, 0 = background. */
  data: Uint8Array;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Box-average downscale so that the longest side is ≤ maxSize. */
export function downscale(img: ImageLike, maxSize: number): { image: ImageLike; factor: number } {
  const longest = Math.max(img.width, img.height);
  if (longest <= maxSize) return { image: img, factor: 1 };
  const factor = longest / maxSize;
  const w = Math.max(1, Math.floor(img.width / factor));
  const h = Math.max(1, Math.floor(img.height / factor));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * factor);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * factor)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * factor);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * factor)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i] as number;
          g += img.data[i + 1] as number;
          b += img.data[i + 2] as number;
          a += img.data[i + 3] as number;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { image: { width: w, height: h, data: out }, factor };
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Median colour of the image border — the assumed background. */
export function estimateBackground(img: ImageLike): { color: Rgb; transparent: boolean } {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  let transparent = 0;
  let count = 0;
  const border = Math.max(1, Math.round(Math.min(img.width, img.height) * 0.015));
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (x >= border && x < img.width - border && y >= border && y < img.height - border) {
        x = img.width - border - 1; // jump across the interior
        continue;
      }
      const i = (y * img.width + x) * 4;
      count++;
      if ((img.data[i + 3] as number) < 128) transparent++;
      rs.push(img.data[i] as number);
      gs.push(img.data[i + 1] as number);
      bs.push(img.data[i + 2] as number);
    }
  }
  return { color: { r: median(rs), g: median(gs), b: median(bs) }, transparent: transparent > count * 0.8 };
}

/** Otsu threshold over a 0..255 histogram. */
export function otsu(hist: number[]): number {
  const total = hist.reduce((a, b) => a + b, 0);
  let sum = 0;
  for (let i = 0; i < hist.length; i++) sum += i * (hist[i] as number);
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 0;
  for (let t = 0; t < hist.length; t++) {
    wB += hist[t] as number;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * (hist[t] as number);
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

export interface SegmentOptions {
  /** Colour distance (0..441) above which a pixel is object. Auto (Otsu) when omitted. */
  threshold?: number;
}

/** Foreground mask: transparent background → alpha, otherwise colour distance to the border colour. */
export function segment(img: ImageLike, opts: SegmentOptions = {}): { mask: Mask; method: string; threshold: number } {
  const bg = estimateBackground(img);
  const n = img.width * img.height;
  const data = new Uint8Array(n);
  if (bg.transparent) {
    for (let i = 0; i < n; i++) data[i] = (img.data[i * 4 + 3] as number) >= 128 ? 1 : 0;
    return { mask: { width: img.width, height: img.height, data }, method: 'alpha-channel', threshold: 128 };
  }
  const dist = new Float32Array(n);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) {
    const dr = (img.data[i * 4] as number) - bg.color.r;
    const dg = (img.data[i * 4 + 1] as number) - bg.color.g;
    const db = (img.data[i * 4 + 2] as number) - bg.color.b;
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    dist[i] = d;
    const bin = Math.min(255, Math.round((d / 441.7) * 255));
    hist[bin] = (hist[bin] ?? 0) + 1;
  }
  const threshold = opts.threshold ?? Math.max(18, (otsu(hist) / 255) * 441.7 * 0.8);
  for (let i = 0; i < n; i++) data[i] = (dist[i] as number) > threshold ? 1 : 0;
  return { mask: { width: img.width, height: img.height, data }, method: 'border-colour-distance', threshold };
}

/** Label 4-connected components of `value` pixels; returns labels (0 = other) and sizes. */
export function label(mask: Mask, value: 0 | 1 = 1): { labels: Int32Array; sizes: number[] } {
  const { width: w, height: h, data } = mask;
  const labels = new Int32Array(w * h);
  const sizes: number[] = [0];
  const stack: number[] = [];
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (data[start] !== value || labels[start] !== 0) continue;
    let size = 0;
    stack.push(start);
    labels[start] = next;
    while (stack.length) {
      const p = stack.pop() as number;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && data[p - 1] === value && labels[p - 1] === 0) {
        labels[p - 1] = next;
        stack.push(p - 1);
      }
      if (x < w - 1 && data[p + 1] === value && labels[p + 1] === 0) {
        labels[p + 1] = next;
        stack.push(p + 1);
      }
      if (y > 0 && data[p - w] === value && labels[p - w] === 0) {
        labels[p - w] = next;
        stack.push(p - w);
      }
      if (y < h - 1 && data[p + w] === value && labels[p + w] === 0) {
        labels[p + w] = next;
        stack.push(p + w);
      }
    }
    sizes.push(size);
    next++;
  }
  return { labels, sizes };
}

export function largestComponent(mask: Mask): { mask: Mask; bbox: BBox; area: number } | null {
  const { labels, sizes } = label(mask, 1);
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if ((sizes[i] as number) > (sizes[best] as number)) best = i;
  if (best === 0) return null;
  const { width: w, height: h } = mask;
  const data = new Uint8Array(w * h);
  const bbox: BBox = { minX: w, minY: h, maxX: 0, maxY: 0 };
  for (let i = 0; i < w * h; i++) {
    if (labels[i] === best) {
      data[i] = 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x < bbox.minX) bbox.minX = x;
      if (x > bbox.maxX) bbox.maxX = x;
      if (y < bbox.minY) bbox.minY = y;
      if (y > bbox.maxY) bbox.maxY = y;
    }
  }
  return { mask: { width: w, height: h, data }, bbox, area: sizes[best] as number };
}

export interface Hole {
  /** Pixel centroid. */
  x: number;
  y: number;
  areaPx: number;
  /** Diameter of the circle with the same area (px). */
  diameterPx: number;
  /** 1 = perfect circle. */
  circularity: number;
}

/**
 * Enclosed background regions of an object mask (not connected to the image border).
 * These are screw holes / cutouts on a technical drawing or a top-down photo.
 */
export function findHoles(mask: Mask): Hole[] {
  const bgMask: Mask = { width: mask.width, height: mask.height, data: mask.data.map((v) => (v ? 0 : 1)) as Uint8Array };
  const { labels, sizes } = label(bgMask, 1);
  const { width: w, height: h } = mask;
  const touchesBorder = new Set<number>();
  for (let x = 0; x < w; x++) {
    touchesBorder.add(labels[x] as number);
    touchesBorder.add(labels[(h - 1) * w + x] as number);
  }
  for (let y = 0; y < h; y++) {
    touchesBorder.add(labels[y * w] as number);
    touchesBorder.add(labels[y * w + w - 1] as number);
  }
  const acc = new Map<number, { sx: number; sy: number; minX: number; maxX: number; minY: number; maxY: number }>();
  for (let i = 0; i < w * h; i++) {
    const l = labels[i] as number;
    if (l === 0 || touchesBorder.has(l)) continue;
    const x = i % w;
    const y = (i - x) / w;
    const a = acc.get(l) ?? { sx: 0, sy: 0, minX: x, maxX: x, minY: y, maxY: y };
    a.sx += x;
    a.sy += y;
    a.minX = Math.min(a.minX, x);
    a.maxX = Math.max(a.maxX, x);
    a.minY = Math.min(a.minY, y);
    a.maxY = Math.max(a.maxY, y);
    acc.set(l, a);
  }
  const holes: Hole[] = [];
  for (const [l, a] of acc) {
    const areaPx = sizes[l] as number;
    if (areaPx < 6) continue; // noise
    const bboxD = Math.max(a.maxX - a.minX + 1, a.maxY - a.minY + 1);
    holes.push({
      x: a.sx / areaPx,
      y: a.sy / areaPx,
      areaPx,
      diameterPx: 2 * Math.sqrt(areaPx / Math.PI),
      circularity: Math.min(1, areaPx / (Math.PI * (bboxD / 2) ** 2)),
    });
  }
  return holes;
}

/** Object mask with its enclosed holes filled: the outer silhouette. */
export function fillHoles(mask: Mask): Mask {
  const bgMask: Mask = { width: mask.width, height: mask.height, data: mask.data.map((v) => (v ? 0 : 1)) as Uint8Array };
  const { labels } = label(bgMask, 1);
  const { width: w, height: h } = mask;
  const border = new Set<number>();
  for (let x = 0; x < w; x++) {
    border.add(labels[x] as number);
    border.add(labels[(h - 1) * w + x] as number);
  }
  for (let y = 0; y < h; y++) {
    border.add(labels[y * w] as number);
    border.add(labels[y * w + w - 1] as number);
  }
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const l = labels[i] as number;
    data[i] = mask.data[i] || (l !== 0 && !border.has(l)) ? 1 : 0;
  }
  return { width: w, height: h, data };
}

/** 3×3 majority smoothing, removes single-pixel noise on edges. */
export function smooth(mask: Mask): Mask {
  const { width: w, height: h, data } = mask;
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += data[(y + dy) * w + x + dx] as number;
      out[y * w + x] = s >= 5 ? 1 : 0;
    }
  }
  return { width: w, height: h, data: out };
}

/** Offsets (dx per dy) of a filled disk of radius r — the structuring element for erode/dilate. */
function diskSpans(r: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (let dy = -r; dy <= r; dy++) spans.push([dy, Math.floor(Math.sqrt(r * r - dy * dy))]);
  return spans;
}

/** Binary erosion with a disk (an object pixel survives only if the whole disk around it is object). */
export function erode(mask: Mask, r: number): Mask {
  const { width: w, height: h, data } = mask;
  const spans = diskSpans(r);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      let keep = true;
      for (const [dy, dx] of spans) {
        const yy = y + dy;
        if (yy < 0 || yy >= h || x - dx < 0 || x + dx >= w) {
          keep = false;
          break;
        }
        const row = yy * w;
        // the span is contiguous: checking its two ends is not enough for arbitrary masks, so scan it
        for (let xx = x - dx; xx <= x + dx; xx++) {
          if (!data[row + xx]) {
            keep = false;
            break;
          }
        }
        if (!keep) break;
      }
      if (keep) out[y * w + x] = 1;
    }
  }
  return { width: w, height: h, data: out };
}

/** Binary dilation with a disk. */
export function dilate(mask: Mask, r: number): Mask {
  const { width: w, height: h, data } = mask;
  const spans = diskSpans(r);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      for (const [dy, dx] of spans) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        const row = yy * w;
        const x0 = Math.max(0, x - dx);
        const x1 = Math.min(w - 1, x + dx);
        for (let xx = x0; xx <= x1; xx++) out[row + xx] = 1;
      }
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Opening (erode then dilate): removes everything thinner than 2r — straps, cables, tabs — while keeping
 * the body and its rounded corners (a disk fits into any arc of radius ≥ r).
 */
export function openMask(mask: Mask, r: number): Mask {
  return r < 1 ? mask : dilate(erode(mask, r), r);
}

/**
 * Median colour of the object's outer rim (the band between the silhouette edge and `bandPx` inside it).
 * This is the colour of the case itself, not of whatever is inside it (white plate, coloured switches).
 */
export function rimColor(img: ImageLike, silhouette: Mask, bandPx: number): { r: number; g: number; b: number } | null {
  const inner = erode(silhouette, Math.max(1, bandPx));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const inset = erode(silhouette, 2); // ignore the anti-aliased edge pixels
  const stride = Math.max(1, Math.floor((silhouette.width * silhouette.height) / 60_000));
  for (let i = 0; i < silhouette.data.length; i += stride) {
    if (inset.data[i] && !inner.data[i]) {
      rs.push(img.data[i * 4] as number);
      gs.push(img.data[i * 4 + 1] as number);
      bs.push(img.data[i * 4 + 2] as number);
    }
  }
  if (rs.length < 20) return null;
  return { r: median(rs), g: median(gs), b: median(bs) };
}

export interface TrimReport {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** First/last row (left, right) or column (top, bottom) that protruded, in mask pixels. */
  spans: Partial<Record<'left' | 'right' | 'top' | 'bottom', { first: number; last: number }>>;
}

const medianInt = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/**
 * Clip short stretches that stick out of the body's straight edge (strap mounts, hooks, cable tabs glued to a side).
 * For every side, the edge position is the median over the rows/columns; a block of rows that reaches further out than
 * `minDepthPx` and covers at most `maxShare` of that side is a protrusion and is cut back to the median edge.
 * Rounded corners are untouched: there the extent moves *inwards*, never outwards.
 */
export function trimProtrusions(mask: Mask, minDepthPx: number, maxShare = 0.4): { mask: Mask; trimmed: TrimReport } {
  const { width: w, height: h } = mask;
  const data = mask.data.slice();
  const report: TrimReport = { left: 0, right: 0, top: 0, bottom: 0, spans: {} };

  const extents = (lines: number, length: number, at: (line: number, i: number) => number) => {
    const first: number[] = new Array(lines).fill(-1);
    const last: number[] = new Array(lines).fill(-1);
    for (let l = 0; l < lines; l++) {
      for (let i = 0; i < length; i++) if (at(l, i)) {
        first[l] = i;
        break;
      }
      for (let i = length - 1; i >= 0; i--) if (at(l, i)) {
        last[l] = i;
        break;
      }
    }
    return { first, last };
  };

  // rows → left/right sides, columns → top/bottom sides
  const rows = extents(h, w, (y, x) => data[y * w + x] as number);
  const cols = extents(w, h, (x, y) => data[y * w + x] as number);

  const clip = (side: 'left' | 'right' | 'top' | 'bottom') => {
    const horizontal = side === 'left' || side === 'right';
    const ex = horizontal ? rows : cols;
    const lines = horizontal ? h : w;
    const arr = side === 'left' || side === 'top' ? ex.first : ex.last;
    const valid = arr.filter((v) => v >= 0);
    if (valid.length === 0) return;
    const med = medianInt(valid);
    const outward = (v: number) => (side === 'left' || side === 'top' ? med - v : v - med);
    const protruding: number[] = [];
    for (let l = 0; l < lines; l++) if ((arr[l] as number) >= 0 && outward(arr[l] as number) > minDepthPx) protruding.push(l);
    if (protruding.length === 0 || protruding.length / valid.length > maxShare) return;
    let deepest = 0;
    for (const l of protruding) {
      deepest = Math.max(deepest, outward(arr[l] as number));
      // erase everything beyond the median edge on this line
      if (horizontal) {
        const from = side === 'left' ? 0 : med + 1;
        const to = side === 'left' ? med : w - 1;
        for (let x = from; x <= to; x++) data[l * w + x] = 0;
      } else {
        const from = side === 'top' ? 0 : med + 1;
        const to = side === 'top' ? med : h - 1;
        for (let y = from; y <= to; y++) data[y * w + l] = 0;
      }
    }
    report[side] = deepest;
    report.spans[side] = { first: Math.min(...protruding), last: Math.max(...protruding) };
  };
  (['left', 'right', 'top', 'bottom'] as const).forEach(clip);
  return { mask: { width: w, height: h, data }, trimmed: report };
}

/**
 * Median colour of the object's interior: everything inside the bounding box shrunk by `insetFraction` of its height
 * on every side (cheap, and exact enough for the near-rectangular bodies of keyboards). On a photo *with* keycaps this
 * is the colour of the keycaps; on a photo without them it is the plate / switches.
 */
export function interiorColor(img: ImageLike, silhouette: Mask, insetFraction = 0.14): { r: number; g: number; b: number } | null {
  const { width: w, height: h, data } = silhouette;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX <= minX || maxY <= minY) return null;
  const inset = Math.round((maxY - minY) * insetFraction);
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = minY + inset; y <= maxY - inset; y += 2) {
    for (let x = minX + inset; x <= maxX - inset; x += 2) {
      const i = y * w + x;
      if (data[i]) {
        rs.push(img.data[i * 4] as number);
        gs.push(img.data[i * 4 + 1] as number);
        bs.push(img.data[i * 4 + 2] as number);
      }
    }
  }
  if (rs.length < 50) return null;
  return { r: median(rs), g: median(gs), b: median(bs) };
}
