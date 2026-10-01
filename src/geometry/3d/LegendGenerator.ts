/**
 * Keycap legends.
 *
 * One quad per labelled key, merged into a single geometry (one draw call) with UVs into a text atlas. The atlas
 * itself (a canvas) is drawn in the browser by `legendTexture`; this module is pure so it can be unit-tested and
 * keeps the 3D assembly buildable in Node (the GLB export simply skips legends).
 *
 * Legends are drawn from the key map's labels — for imported keyboards that is the generic ANSI reference map,
 * and the record says so.
 */
import * as THREE from 'three';
import { KEY_PITCH_MM } from '../layouts';
import type { Keycap, KeyboardLayout, Point2D } from '../../types/keyboard';
import { KEYCAP_GAP } from './KeycapGenerator';
import { keycapHeight } from './stack';

export const LEGEND_CELL = { w: 128, h: 64 } as const;
export const LEGEND_COLS = 8;

const SHORT: Record<string, string> = {
  Backspace: 'Bksp',
  Bksp: 'Bksp',
  Space: '',
  Enter: 'Enter',
  Ent: 'Ent',
  Pause: 'Pause',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};

/** Text drawn on a key ('' = no legend, e.g. the space bar). */
export function legendText(label: string): string {
  return SHORT[label] ?? label;
}

export interface LegendBuild {
  geometry: THREE.BufferGeometry;
  /** Distinct texts, in atlas order (index → cell). */
  atlas: string[];
  quads: number;
}

export function atlasRows(count: number): number {
  return Math.max(1, Math.ceil(count / LEGEND_COLS));
}

/**
 * @param centers key centres in the case frame (same indexing as the layout)
 * @param baseZ   height of the keycap base above the plate (stack.keycapBase)
 */
export function generateLegends(layout: KeyboardLayout, keycap: Keycap | undefined, centers: Point2D[], baseZ: number): LegendBuild | null {
  const atlas: string[] = [];
  const index = new Map<string, number>();
  const labelled: Array<{ i: number; text: string }> = [];
  layout.keys.forEach((k, i) => {
    const text = legendText(k.label);
    if (!text || !centers[i]) return;
    if (!index.has(text)) {
      index.set(text, atlas.length);
      atlas.push(text);
    }
    labelled.push({ i, text });
  });
  if (labelled.length === 0) return null;

  const rows = atlasRows(atlas.length);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const taper = keycap?.taper ?? 3;
  const dish = 0.7;

  for (const { i, text } of labelled) {
    const k = layout.keys[i];
    const c = centers[i];
    if (!k || !c) continue;
    const topW = k.width * KEY_PITCH_MM - KEYCAP_GAP - 2 * taper;
    const W = Math.max(5, Math.min(topW * 0.86, 13));
    const hw = W / 2;
    const hh = W / 4; // 2:1 cell
    // just above the dished top, below the rim, nudged towards the back like the sculpted top
    const y = baseZ + keycapHeight(keycap, layout, k) * 0.97 - dish * 0.3 + 0.03;
    const z0 = c.y - 0.4; // keycap tops are shifted slightly to the back (see sculptedKeycap)
    const cell = index.get(text) as number;
    const col = cell % LEGEND_COLS;
    const row = Math.floor(cell / LEGEND_COLS);
    const u0 = col / LEGEND_COLS;
    const u1 = (col + 1) / LEGEND_COLS;
    const v1 = 1 - row / rows; // canvas y runs downwards
    const v0 = 1 - (row + 1) / rows;
    const base = pos.length / 3;
    // text reads left → right along +X, its top points to the back (−Z)
    pos.push(c.x - hw, y, z0 - hh, c.x + hw, y, z0 - hh, c.x + hw, y, z0 + hh, c.x - hw, y, z0 + hh);
    uv.push(u0, v1, u1, v1, u1, v0, u0, v0);
    idx.push(base, base + 3, base + 2, base, base + 2, base + 1); // normal +Y
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, atlas, quads: labelled.length };
}

/** Pick a legend colour that contrasts with the keycap colour (a rendering rule, not data). */
export function legendColorFor(keycapHex: string | undefined): string {
  if (!keycapHex || !/^#[0-9a-f]{6}$/i.test(keycapHex)) return '#2b2b2b';
  const r = parseInt(keycapHex.slice(1, 3), 16);
  const g = parseInt(keycapHex.slice(3, 5), 16);
  const b = parseInt(keycapHex.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.5 ? '#f1f1f1' : '#2b2b2b';
}

/** Draws the atlas in the browser. Not used in Node. */
export function legendTexture(atlas: string[], color: string): THREE.CanvasTexture {
  const rows = atlasRows(atlas.length);
  const canvas = document.createElement('canvas');
  canvas.width = LEGEND_COLS * LEGEND_CELL.w;
  canvas.height = rows * LEGEND_CELL.h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    atlas.forEach((text, i) => {
      const x = (i % LEGEND_COLS) * LEGEND_CELL.w + LEGEND_CELL.w / 2;
      const y = Math.floor(i / LEGEND_COLS) * LEGEND_CELL.h + LEGEND_CELL.h / 2;
      let size = text.length === 1 ? 54 : 44;
      ctx.font = `700 ${size}px system-ui, "Segoe UI", Arial, sans-serif`;
      // shrink long labels until they fit the cell
      while (ctx.measureText(text).width > LEGEND_CELL.w * 0.9 && size > 14) {
        size -= 2;
        ctx.font = `700 ${size}px system-ui, "Segoe UI", Arial, sans-serif`;
      }
      ctx.fillText(text, x, y + 2);
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
