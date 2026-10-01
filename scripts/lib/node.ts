/**
 * Shared helpers for the Node CLIs: polite fetching (own, honest User-Agent, robots.txt,
 * timeouts, cache), argument parsing and image decoding. No stealth, no header spoofing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { checkRobots } from '../../src/import/robots';
import { readHtmlResponse } from '../../src/import/fetcher';
import { ImportFetchError, type Fetcher } from '../../src/import/types';
import type { ImageLike } from '../../src/import/vision/mask';

export const USER_AGENT = 'KeyboardShapesBot/0.1 (+https://github.com/keyboard-shapes; respects robots.txt)';
export const root = fileURLToPath(new URL('../../', import.meta.url));
export const dataDir = (name: string) => `${root}data/${name}`;
const cacheDir = `${root}.import-cache/`;

export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  const rest: string[] = [];
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1] as string] = m[2] ?? true;
    else rest.push(a);
  }
  if (rest.length) out['_'] = rest.join(' ');
  return out;
}

async function timeoutFetch(url: string, init: RequestInit = {}, ms = 20_000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,image/*;q=0.8', ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(t);
  }
}

export async function robotsAllows(url: string): Promise<{ checked: boolean; allowed: boolean; reason?: string }> {
  const v = await checkRobots(url, 'KeyboardShapesBot', async (u) => {
    const r = await timeoutFetch(u, {}, 10_000);
    return { status: r.status, text: await r.text() };
  });
  return v.checked ? { checked: true, allowed: v.allowed } : { checked: false, allowed: true, reason: v.reason };
}

export const nodeFetcher: Fetcher = async (url) => {
  let res: Response;
  try {
    res = await timeoutFetch(url);
  } catch (e) {
    throw new ImportFetchError('network-or-cors', `Network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  return readHtmlResponse(res);
};

export function cachePath(url: string, ext = 'html'): string {
  mkdirSync(cacheDir, { recursive: true });
  return `${cacheDir}${createHash('sha1').update(url).digest('hex').slice(0, 16)}.${ext}`;
}

export function writeCache(url: string, content: string): string {
  const p = cachePath(url);
  writeFileSync(p, content);
  return p;
}

export async function downloadImage(url: string): Promise<{ buf: Buffer; type: string }> {
  const robots = await robotsAllows(url);
  if (!robots.allowed) throw new ImportFetchError('robots-disallowed', 'robots.txt disallows fetching this image.');
  const res = await timeoutFetch(url);
  if (!res.ok) throw new ImportFetchError('http-error', `HTTP ${res.status} for the image.`, res.status);
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' };
}

export function decodeImage(buf: Buffer): ImageLike {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { width: j.width, height: j.height, data: j.data };
  }
  throw new Error('Unsupported image format (PNG and JPEG are supported in the CLI; WebP/AVIF: convert first or use the web app).');
}

export function readJsonArray<T>(path: string): T[] {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T[]) : [];
}

export function writeJsonArray(path: string, list: unknown[]): void {
  writeFileSync(path, JSON.stringify(list, null, 1) + '\n');
}

export const c = {
  ok: (s: string) => `\x1b[32m✓\x1b[0m ${s}`,
  warn: (s: string) => `\x1b[33m⚠\x1b[0m ${s}`,
  fail: (s: string) => `\x1b[31m✕\x1b[0m ${s}`,
  unk: (s: string) => `\x1b[90m?\x1b[0m ${s}`,
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
