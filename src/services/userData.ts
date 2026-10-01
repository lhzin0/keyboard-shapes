/**
 * Imports confirmed in the browser live in localStorage (GitHub Pages has no backend).
 * They are merged into the in-memory database at start-up and can be exported as JSON
 * to be committed under /data via a pull request.
 */
import { resetCatalog } from '../search';
import type { Case, Keyboard } from '../types/keyboard';
import { db, resetGraph } from './database';

const KEY = 'ks-user-data-v1';

export interface UserData {
  keyboards: Keyboard[];
  cases: Case[];
}

function read(): UserData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { keyboards: [], cases: [] };
    const parsed = JSON.parse(raw) as Partial<UserData>;
    return { keyboards: parsed.keyboards ?? [], cases: parsed.cases ?? [] };
  } catch {
    return { keyboards: [], cases: [] };
  }
}

function write(d: UserData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch {
    return false; // storage full or blocked
  }
}

/** Merge saved imports into the in-memory database (idempotent). */
export function loadUserData(): void {
  const d = read();
  for (const c of d.cases) if (!db.cases.some((x) => x.id === c.id)) db.cases.push(c);
  for (const k of d.keyboards) if (!db.keyboards.some((x) => x.id === k.id)) db.keyboards.push(k);
  resetCatalog();
  resetGraph();
}

export function saveImport(keyboard: Keyboard, c: Case): boolean {
  const d = read();
  d.keyboards = [...d.keyboards.filter((k) => k.id !== keyboard.id), keyboard];
  d.cases = [...d.cases.filter((x) => x.id !== c.id), c];
  const ok = write(d);
  loadUserData();
  return ok;
}

export function listImports(): Keyboard[] {
  return read().keyboards;
}

export function removeImport(keyboardId: string): void {
  const d = read();
  const kb = d.keyboards.find((k) => k.id === keyboardId);
  d.keyboards = d.keyboards.filter((k) => k.id !== keyboardId);
  if (kb?.components.caseId) d.cases = d.cases.filter((c) => c.id !== kb.components.caseId);
  write(d);
  // mutate in place: other modules hold references to these arrays
  const drop = <T extends { id: string }>(list: T[], id: string | undefined) => {
    const i = id ? list.findIndex((x) => x.id === id) : -1;
    if (i >= 0) list.splice(i, 1);
  };
  drop(db.keyboards, keyboardId);
  drop(db.cases, kb?.components.caseId);
  resetCatalog();
  resetGraph();
}
