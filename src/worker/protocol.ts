import type { Filter } from '../lib/filters';
import type { SlabFitResult } from '../lib/section';
import type { BValue, Fmd } from '../lib/stats';

/** Columns sent to the main thread for rendering and picking (copies; the worker keeps its own). */
export interface CatalogColumns {
  count: number;
  time: Float64Array;
  day: Float32Array;
  lat: Float32Array;
  lon: Float32Array;
  depth10: Int16Array;
  mag100: Uint16Array;
  magType: Uint8Array;
  magTypes: string[];
}

export interface PolylineColumns {
  /** All points as [lon, lat, lon, lat, ...]. */
  coords: Float32Array;
  /** Start offset (in points) of each line, plus a final sentinel. */
  offsets: Uint32Array;
  kinds: Uint8Array;
  kindNames: string[];
}

export interface DataMeta {
  fetchedAt: string;
  total: number;
  firstYear: number;
  lastYear: number;
}

export interface SectionSpec {
  a: [number, number];
  b: [number, number];
  halfWidthKm: number;
  fitMinDepthKm: number;
}

export interface StatsResult {
  count: number;
  total: number;
  /** Events per year for the magnitude and depth filters (the time filter is drawn on top). */
  perYear: number[];
  firstYear: number;
  /** Events per 10 km depth bin from 0 to 700 km (negative depths count in the first bin). */
  depthHist: number[];
  fmd: Fmd;
  mc: number;
  b: BValue | null;
  classes: { shallow: number; intermediate: number; deep: number };
  /** Catalogue indices of the largest matching events, largest first. */
  largest: number[];
}

export interface SectionResult {
  spec: SectionSpec;
  lengthKm: number;
  index: Int32Array;
  along: Float32Array;
  cross: Float32Array;
  depth: Float32Array;
  mag: Float32Array;
  fit: SlabFitResult;
}

export interface LiveData {
  count: number;
  /** Origin time, whole seconds since 1970. */
  time: Float64Array;
  lat: Float32Array;
  lon: Float32Array;
  depthKm: Float32Array;
  mag: Float32Array;
  magTypes: string[];
  ids: string[];
  places: string[];
}

export type WorkerRequest =
  | { type: 'init'; dataUrl: string }
  | { type: 'stats'; id: number; filter: Filter }
  | { type: 'section'; id: number; filter: Filter; spec: SectionSpec }
  | { type: 'details'; id: number; indices: number[] }
  | { type: 'parse-live'; id: number; text: string };

export type WorkerResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'catalog'; columns: CatalogColumns; meta: DataMeta }
  | { type: 'layers'; coast: PolylineColumns; plates: PolylineColumns | null }
  | { type: 'details-ready' }
  | { type: 'stats'; id: number; result: StatsResult }
  | { type: 'section'; id: number; result: SectionResult }
  | { type: 'details'; id: number; items: { id: string; place: string }[] }
  | { type: 'live'; id: number; result: LiveData }
  | {
      type: 'error';
      id?: number;
      scope: 'catalog' | 'details' | 'layers' | 'request';
      message: string;
    };
