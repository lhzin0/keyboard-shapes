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
