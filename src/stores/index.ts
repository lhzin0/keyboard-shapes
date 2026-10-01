import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayerId } from '../geometry/3d/KeyboardAssembly';
import { LAYER_ORDER } from '../geometry/3d/KeyboardAssembly';
import type { ComponentType, Keyboard, LayoutName } from '../types/keyboard';

/* -------------------------------------------------------------------- ui */

export type Theme = 'dark' | 'light';

/** CSS reference pixels per millimetre (96 dpi). Real screens differ → user-calibratable. */
export const CSS_PX_PER_MM = 96 / 25.4;

interface UiState {
  theme: Theme;
  /** Calibrated screen scale for the 1:1 view. */
  pxPerMm: number;
  setTheme(t: Theme): void;
  toggleTheme(): void;
  setPxPerMm(v: number): void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: (typeof document !== 'undefined' && (document.documentElement.dataset['theme'] as Theme)) || 'dark',
      pxPerMm: CSS_PX_PER_MM,
      setTheme: (theme) => {
        document.documentElement.dataset['theme'] = theme;
        set({ theme });
      },
      toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
      setPxPerMm: (pxPerMm) => set({ pxPerMm }),
    }),
    {
      name: 'ks-ui',
      partialize: (s) => ({ pxPerMm: s.pxPerMm }),
    },
  ),
);

// keep the `ks-theme` key (read by the inline script in index.html) in sync
useUiStore.subscribe((s) => {
  try {
    localStorage.setItem('ks-theme', s.theme);
  } catch {
    /* storage unavailable */
  }
});

/* --------------------------------------------------------------- compare */

export type CompareKind = 'keyboard' | ComponentType;
export interface CompareItem {
  kind: CompareKind;
  id: string;
}
export const MAX_COMPARE = 4;

interface CompareState {
  items: CompareItem[];
  add(item: CompareItem): boolean;
  remove(item: CompareItem): void;
  toggle(item: CompareItem): void;
  has(item: CompareItem): boolean;
  clear(): void;
}

export const useCompareStore = create<CompareState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item) => {
        const { items } = get();
        if (items.some((i) => i.kind === item.kind && i.id === item.id)) return true;
        if (items.length >= MAX_COMPARE) return false;
        set({ items: [...items, item] });
        return true;
      },
      remove: (item) => set({ items: get().items.filter((i) => !(i.kind === item.kind && i.id === item.id)) }),
      toggle: (item) => (get().has(item) ? get().remove(item) : void get().add(item)),
      has: (item) => get().items.some((i) => i.kind === item.kind && i.id === item.id),
      clear: () => set({ items: [] }),
    }),
    { name: 'ks-compare' },
  ),
);

/* ----------------------------------------------------------------- build */

export interface BuildState {
  caseId?: string;
  pcbId?: string;
  plateId?: string;
  daughterboardId?: string;
  switchId?: string;
  keycapId?: string;
  stabilizerId?: string;
  foamId?: string;
  layoutName?: LayoutName;
  set(type: ComponentType, id: string | undefined): void;
  setLayout(name: LayoutName | undefined): void;
  loadKeyboard(kb: Keyboard): void;
  reset(): void;
}

const BUILD_KEY: Record<ComponentType, keyof BuildState> = {
  case: 'caseId',
  pcb: 'pcbId',
  plate: 'plateId',
  daughterboard: 'daughterboardId',
  switch: 'switchId',
  keycap: 'keycapId',
  stabilizer: 'stabilizerId',
  foam: 'foamId',
};

export const useBuildStore = create<BuildState>()((set) => ({
  set: (type, id) => set({ [BUILD_KEY[type]]: id } as Partial<BuildState>),
  setLayout: (layoutName) => set({ layoutName }),
  loadKeyboard: (kb) =>
    set({
      caseId: kb.components.caseId,
      pcbId: kb.components.pcbId,
      plateId: kb.components.plateId,
      daughterboardId: kb.components.daughterboardId,
      switchId: kb.components.switchId,
      keycapId: kb.components.keycapId,
      stabilizerId: kb.components.stabilizerId,
      foamId: kb.components.foamId,
      layoutName: kb.layout.name,
    }),
  reset: () =>
    set({
      caseId: undefined,
      pcbId: undefined,
      plateId: undefined,
      daughterboardId: undefined,
      switchId: undefined,
      keycapId: undefined,
      stabilizerId: undefined,
      foamId: undefined,
      layoutName: undefined,
    }),
}));

/* ------------------------------------------------------------- 3D viewer */

export interface LayerState {
  visible: boolean;
  opacity: number;
}

export type RenderMode = 'solid' | 'transparent' | 'wireframe';
export type ViewName = 'iso' | 'top' | 'front' | 'side' | 'reset';

export interface SectionState {
  enabled: boolean;
  axis: 'x' | 'y' | 'z';
  /** 0..1 along the model's extent. */
  position: number;
  flip: boolean;
}

interface Viewer3DState {
  layers: Record<LayerId, LayerState>;
  isolated: LayerId | null;
  renderMode: RenderMode;
  projection: 'perspective' | 'orthographic';
  explode: number;
  section: SectionState;
  measure: boolean;
  showCollisions: boolean;
  command: { view: ViewName; n: number };
  setLayer(id: LayerId, patch: Partial<LayerState>): void;
  isolate(id: LayerId | null): void;
  setRenderMode(m: RenderMode): void;
  setProjection(p: 'perspective' | 'orthographic'): void;
  setExplode(v: number): void;
  setSection(patch: Partial<SectionState>): void;
  setMeasure(v: boolean): void;
  setShowCollisions(v: boolean): void;
  goTo(view: ViewName): void;
  resetAll(): void;
}

const defaultLayers = (): Record<LayerId, LayerState> =>
  Object.fromEntries(LAYER_ORDER.map((l) => [l, { visible: true, opacity: 1 }])) as Record<LayerId, LayerState>;

export const useViewer3D = create<Viewer3DState>()((set, get) => ({
  layers: defaultLayers(),
  isolated: null,
  renderMode: 'solid',
  projection: 'perspective',
  explode: 0,
  section: { enabled: false, axis: 'x', position: 0.5, flip: false },
  measure: false,
  showCollisions: true,
  command: { view: 'iso', n: 0 },
  setLayer: (id, patch) => set({ layers: { ...get().layers, [id]: { ...get().layers[id], ...patch } } }),
  isolate: (id) => set({ isolated: get().isolated === id ? null : id }),
  setRenderMode: (renderMode) => set({ renderMode }),
  setProjection: (projection) => set({ projection }),
  setExplode: (explode) => set({ explode }),
  setSection: (patch) => set({ section: { ...get().section, ...patch } }),
  setMeasure: (measure) => set({ measure }),
  setShowCollisions: (showCollisions) => set({ showCollisions }),
  goTo: (view) => set({ command: { view, n: get().command.n + 1 } }),
  resetAll: () =>
    set({
      layers: defaultLayers(),
      isolated: null,
      renderMode: 'solid',
      explode: 0,
      section: { enabled: false, axis: 'x', position: 0.5, flip: false },
      measure: false,
      command: { view: 'reset', n: get().command.n + 1 },
    }),
}));
