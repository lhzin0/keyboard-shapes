/**
 * Reference ANSI key maps. Positions are in key units (1u = 19.05 mm).
 *
 * Row DSL: a string "label:width:height" (width/height default to 1) is a key,
 * a number is a horizontal gap (in u) before the next key.
 */
import type { KeyboardLayout, KeyDef, LayoutName } from '../types/keyboard';

export const KEY_PITCH_MM = 19.05;

type Token = string | number;

function row(tokens: Token[], y: number, rowIndex: number, x0 = 0): KeyDef[] {
  const keys: KeyDef[] = [];
  let x = x0;
  for (const t of tokens) {
    if (typeof t === 'number') {
      x += t;
      continue;
    }
    const [label = '', w = '1', h = '1'] = t.split(':');
    const width = Number(w);
    const height = Number(h);
    keys.push({
      x,
      y,
      width,
      height,
      rotation: 0,
      label,
      row: rowIndex,
      keycapSize: sizeLabel(width, height),
    });
    x += width;
  }
  return keys;
}

export function sizeLabel(width: number, height: number): string {
  return height > 1 ? `${width}x${height}u` : `${width}u`;
}

const letters = (s: string): Token[] => s.split('').map((c) => c);

const numberRow = (): Token[] => ['`', ...'1234567890'.split(''), '-', '='];

function finish(name: LayoutName, description: string, keys: KeyDef[]): KeyboardLayout {
  const widthU = Math.max(...keys.map((k) => k.x + k.width));
  const heightU = Math.max(...keys.map((k) => k.y + k.height));
  return { name, description, keys, widthU, heightU, keyCount: keys.length };
}

/** Rows shared by 60/65/75-style boards, differing only in the right edge. */
function alphaBlock(opts: {
  y0: number;
  firstRow: number;
  shiftRight: string;
  bottom: Token[];
}): KeyDef[] {
  const { y0, firstRow, shiftRight, bottom } = opts;
  return [
    ...row([...numberRow(), 'Backspace:2'], y0, firstRow),
    ...row(['Tab:1.5', ...letters('QWERTYUIOP'), '[', ']', '\\:1.5'], y0 + 1, firstRow + 1),
    ...row(['Caps:1.75', ...letters('ASDFGHJKL'), ';', "'", 'Enter:2.25'], y0 + 2, firstRow + 2),
    ...row(['Shift:2.25', ...letters('ZXCVBNM'), ',', '.', '/', shiftRight], y0 + 3, firstRow + 3),
    ...row(bottom, y0 + 4, firstRow + 4),
  ];
}

export function layout40(): KeyboardLayout {
  const keys = [
    ...row(['Tab', ...letters('QWERTYUIOP'), 'Bksp'], 0, 0),
    ...row(['Esc:1.25', ...letters('ASDFGHJKL'), 'Enter:1.75'], 1, 1),
    ...row(['Shift:1.75', ...letters('ZXCVBNM'), ',', '.', 'Shift:1.25'], 2, 2),
    ...row(['Ctrl:1.25', 'Alt:1.25', 'Fn:1.25', 'Space:2.25', 'Space:2.25', 'Fn:1.25', 'Alt:1.25', 'Ctrl:1.25'], 3, 3),
  ];
  return finish('40%', 'Compact 40%', keys);
}

export function layout60(): KeyboardLayout {
  const keys = alphaBlock({
    y0: 0,
    firstRow: 0,
    shiftRight: 'Shift:2.75',
    bottom: ['Ctrl:1.25', 'Win:1.25', 'Alt:1.25', 'Space:6.25', 'Alt:1.25', 'Win:1.25', 'Fn:1.25', 'Ctrl:1.25'],
  });
  return finish('60%', 'ANSI 60%', keys);
}

export function layout65(): KeyboardLayout {
  const keys = [
    ...row([...numberRow(), 'Backspace:2', 'Del'], 0, 0),
    ...row(['Tab:1.5', ...letters('QWERTYUIOP'), '[', ']', '\\:1.5', 'PgUp'], 1, 1),
    ...row(['Caps:1.75', ...letters('ASDFGHJKL'), ';', "'", 'Enter:2.25', 'PgDn'], 2, 2),
    ...row(['Shift:2.25', ...letters('ZXCVBNM'), ',', '.', '/', 'Shift:1.75', 'Up', 'End'], 3, 3),
    ...row(['Ctrl:1.25', 'Win:1.25', 'Alt:1.25', 'Space:6.25', 'Alt', 'Fn', 'Ctrl', 'Left', 'Down', 'Right'], 4, 4),
  ];
  return finish('65%', 'ANSI 65%', keys);
}

export function layout75(): KeyboardLayout {
  const keys = [
    ...row(['Esc', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`), 'Prt', 'Ins', 'Del'], 0, 0),
    ...row([...numberRow(), 'Backspace:2', 'Home'], 1, 1),
    ...row(['Tab:1.5', ...letters('QWERTYUIOP'), '[', ']', '\\:1.5', 'PgUp'], 2, 2),
    ...row(['Caps:1.75', ...letters('ASDFGHJKL'), ';', "'", 'Enter:2.25', 'PgDn'], 3, 3),
    ...row(['Shift:2.25', ...letters('ZXCVBNM'), ',', '.', '/', 'Shift:1.75', 'Up', 'End'], 4, 4),
    ...row(['Ctrl:1.25', 'Win:1.25', 'Alt:1.25', 'Space:6.25', 'Alt', 'Fn', 'Ctrl', 'Left', 'Down', 'Right'], 5, 5),
  ];
  return finish('75%', 'ANSI 75%', keys);
}

function tklKeys(): KeyDef[] {
  const fRow: Token[] = [
    'Esc',
    1,
    'F1',
    'F2',
    'F3',
    'F4',
    0.5,
    'F5',
    'F6',
    'F7',
    'F8',
    0.5,
    'F9',
    'F10',
    'F11',
    'F12',
    0.25,
    'Prt',
    'Scr',
    'Pause',
  ];
  return [
    ...row(fRow, 0, 0),
    ...row([...numberRow(), 'Backspace:2', 0.25, 'Ins', 'Home', 'PgUp'], 1.5, 1),
    ...row(['Tab:1.5', ...letters('QWERTYUIOP'), '[', ']', '\\:1.5', 0.25, 'Del', 'End', 'PgDn'], 2.5, 2),
    ...row(['Caps:1.75', ...letters('ASDFGHJKL'), ';', "'", 'Enter:2.25'], 3.5, 3),
    ...row(['Shift:2.25', ...letters('ZXCVBNM'), ',', '.', '/', 'Shift:2.75', 0.25, 1, 'Up'], 4.5, 4),
    ...row(
      ['Ctrl:1.25', 'Win:1.25', 'Alt:1.25', 'Space:6.25', 'Alt:1.25', 'Win:1.25', 'Menu:1.25', 'Ctrl:1.25', 0.25, 'Left', 'Down', 'Right'],
      5.5,
      5,
    ),
  ];
}

export function layoutTKL(): KeyboardLayout {
  return finish('TKL', 'ANSI TKL (87)', tklKeys());
}

export function layoutFull(): KeyboardLayout {
  const nx = 18.5;
  const keys = [
    ...tklKeys(),
    ...row(['Num', '/', '*', '-'], 1.5, 1, nx),
    ...row(['7', '8', '9', '+:1:2'], 2.5, 2, nx),
    ...row(['4', '5', '6'], 3.5, 3, nx),
    ...row(['1', '2', '3', 'Ent:1:2'], 4.5, 4, nx),
    ...row(['0:2', '.'], 5.5, 5, nx),
  ];
  return finish('Full Size', 'ANSI Full Size (104)', keys);
}

export const LAYOUT_BUILDERS: Partial<Record<LayoutName, () => KeyboardLayout>> = {
  '40%': layout40,
  '60%': layout60,
  '65%': layout65,
  '75%': layout75,
  TKL: layoutTKL,
  'Full Size': layoutFull,
};

export function buildLayout(name: LayoutName): KeyboardLayout | null {
  return LAYOUT_BUILDERS[name]?.() ?? null;
}

/** Stabilizer wire spacing (mm) for the key widths that need one. Cherry-style standard values. */
export function stabilizerSpacing(widthU: number): number | null {
  if (widthU >= 6 && widthU < 7) return 100;
  if (widthU >= 7 && widthU < 8) return 114.3;
  if (widthU >= 2 && widthU < 6) return 23.8;
  return null;
}
