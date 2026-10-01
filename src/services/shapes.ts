import type { ComponentType, Keyboard, Point2D, Shape } from '../types/keyboard';
import { getComponent, getKeyboard, resolveKeyboard, type AnyComponent } from './database';
import type { Case, Daughterboard, PCB, Plate } from '../types/keyboard';
import type { CompareItem } from '../stores';

export interface ShapeEntry {
  key: string;
  label: string;
  kind: 'keyboard' | ComponentType;
  shape: Shape;
  /** Where the USB port/cutout is, in the shape's own frame (for "align by USB"). */
  usb?: Point2D;
  dimensions: { width: number; depth: number; height?: number };
  /** Weight in grams, when known. */
  weight?: number;
  confidence: { level: string; score: number };
}

const keyOf = (i: CompareItem) => `${i.kind}:${i.id}`;

/** Resolve any comparable item to its outline. Returns undefined when the item has no geometry. */
export function shapeEntry(item: CompareItem): ShapeEntry | undefined {
  if (item.kind === 'keyboard') {
    const kb = getKeyboard(item.id) as Keyboard | undefined;
    if (!kb) return undefined;
    const parts = resolveKeyboard(kb);
    const shape = kb.shape ?? parts.case?.externalShape;
    if (!shape) return undefined;
    const usbCut = parts.case?.cutouts.find((c) => c.kind === 'usb');
    return {
      key: keyOf(item),
      label: `${kb.brand} ${kb.model}`,
      kind: 'keyboard',
      shape,
      usb: usbCut ? usbAnchor(usbCut.wall, usbCut.center, parts.case as Case) : undefined,
      dimensions: kb.dimensions,
      weight: kb.weight?.value ?? undefined,
      confidence: kb.confidence,
    };
  }
  const c = getComponent(item.kind, item.id) as AnyComponent | undefined;
  if (!c) return undefined;
  const label = `${(c as { brand?: string }).brand ?? ''} ${(c as { model?: string }).model ?? c.id}`.trim();
  switch (item.kind) {
    case 'case': {
      const cs = c as Case;
      const usb = cs.cutouts.find((x) => x.kind === 'usb');
      return { key: keyOf(item), label, kind: 'case', shape: cs.externalShape, usb: usb ? usbAnchor(usb.wall, usb.center, cs) : undefined, dimensions: cs.dimensions, weight: cs.weight?.value ?? undefined, confidence: cs.confidence };
    }
    case 'pcb': {
      const p = c as PCB;
      return { key: keyOf(item), label, kind: 'pcb', shape: p.outline, usb: p.usbPort ? { x: p.usbPort.x, y: p.usbPort.y } : undefined, dimensions: p.dimensions, confidence: p.confidence };
    }
    case 'plate': {
      const p = c as Plate;
      return { key: keyOf(item), label, kind: 'plate', shape: p.outline, dimensions: p.dimensions, confidence: p.confidence };
    }
    case 'daughterboard': {
      const d = c as Daughterboard;
      return { key: keyOf(item), label, kind: 'daughterboard', shape: d.outline, usb: { x: d.usbPort.x, y: d.usbPort.y }, dimensions: d.dimensions, confidence: d.confidence };
    }
    default:
      return undefined;
  }
}

function usbAnchor(wall: string, center: number, c: Case): Point2D {
  const { width: W, depth: D } = c.dimensions;
  switch (wall) {
    case 'back':
      return { x: center, y: 0 };
    case 'front':
      return { x: center, y: D };
    case 'left':
      return { x: 0, y: center };
    default:
      return { x: W, y: center };
  }
}
