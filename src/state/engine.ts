import type { Bounds } from '../lib/filters';
import type { CatalogColumns, LiveData, PolylineColumns } from '../worker/protocol';

export interface PickHit {
  kind: 'catalog' | 'live';
  index: number;
  /** CSS pixels relative to the map canvas. */
  x: number;
  y: number;
}

export interface EngineCallbacks {
  onHover(hit: PickHit | null): void;
  onSelect(hit: PickHit | null): void;
  onSectionDrawn(a: [number, number], b: [number, number]): void;
  onDrawStateChange(drawing: boolean): void;
  onInteract(kind: 'drag' | 'zoom' | 'key' | 'draw'): void;
}

export interface SectionOverlay {
  a: [number, number];
  b: [number, number];
  halfWidthKm: number;
}

/** What the app needs from a map renderer: the WebGL globe or the Canvas 2D flat map. */
export interface MapEngine {
  setCatalog(columns: CatalogColumns): void;
  setLayers(coast: PolylineColumns, plates: PolylineColumns | null): void;
  setFilter(bounds: Bounds): void;
  setPlayback(day: number | null, windowDays?: number): void;
  setLive(data: LiveData | null): void;
  setSection(section: SectionOverlay | null, fly?: boolean): void;
  setDrawMode(on: boolean): void;
  setHighlight(hit: PickHit | null): void;
  setShowPlates(show: boolean): void;
  projectEvent(hit: PickHit): { x: number; y: number; front: boolean } | null;
  dispose(): void;
  // Globe-only capabilities.
  setDepthMode?(on: boolean, animate?: boolean): void;
  setExaggeration?(x: number): void;
  setAutoRotate?(on: boolean): void;
  setReducedMotion?(reduced: boolean): void;
  setLabelElements?(a: HTMLElement, b: HTMLElement): void;
  flyTo?(lat: number, lon: number, distance?: number): void;
  flyToSection?(): void;
  resetView?(): void;
  setInsets?(top: number, bottom: number): void;
}
