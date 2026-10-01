import type { ImageLike } from './vision/mask';

export class ImageReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageReadError';
  }
}

function toImageData(source: CanvasImageSource, w: number, h: number, maxSize: number): ImageLike {
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new ImageReadError('Canvas is not available in this browser.');
  ctx.drawImage(source, 0, 0, cw, ch);
  try {
    const d = ctx.getImageData(0, 0, cw, ch);
    return { width: d.width, height: d.height, data: d.data };
  } catch {
    throw new ImageReadError('The browser blocked reading the pixels of this image (cross-origin). Download it and use “Upload” instead.');
  }
}

/** Decode an uploaded file (always readable) or a remote URL (readable only when the host sends CORS headers). */
export async function loadImageData(src: string | Blob, maxSize = 1600): Promise<ImageLike> {
  if (typeof src !== 'string') {
    const bmp = await createImageBitmap(src);
    const out = toImageData(bmp, bmp.width, bmp.height, maxSize);
    bmp.close();
    return out;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'no-referrer';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new ImageReadError('The image could not be loaded (blocked by the site or not an image). Download it and use “Upload” instead.'));
    img.src = src;
  });
  return toImageData(img, img.naturalWidth, img.naturalHeight, maxSize);
}
