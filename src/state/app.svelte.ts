import { LIMITS, dayOfYearStart, defaultFilter, type Filter } from '../lib/filters';
import type { LiveStatus } from '../lib/live-cache';
import { FEATURED_PRESET, type Preset } from '../lib/presets';
import type {
  CatalogColumns,
  DataMeta,
  LiveData,
  PolylineColumns,
  SectionResult,
  StatsResult,
} from '../worker/protocol';

export type LoadStatus = 'loading' | 'ready' | 'error';
export type ViewKind = 'globe' | 'map';
export type PanelTab = 'section' | 'stats' | 'filters';

export interface SectionState {
  a: [number, number];
  b: [number, number];
  halfWidthKm: number;
  presetId: string | null;
}

export interface EventInfo {
  kind: 'catalog' | 'live';
  index: number;
  time: number;
  lat: number;
  lon: number;
  depthKm: number;
  mag: number;
  magType: string;
  id: string | null;
  place: string | null;
  /** Screen position (CSS px within the map) when picked on the map; null from lists/charts. */
  x: number | null;
  y: number | null;
}

/** Large, non-reactive data. Components react to the version counters in `app`. */
export const data: {
  catalog: CatalogColumns | null;
  meta: DataMeta | null;
  coast: PolylineColumns | null;
  plates: PolylineColumns | null;
  live: LiveData | null;
} = { catalog: null, meta: null, coast: null, plates: null, live: null };

export function sectionFromPreset(p: Preset): SectionState {
  return { a: [...p.a], b: [...p.b], halfWidthKm: p.halfWidthKm, presetId: p.id };
}

class AppState {
  status = $state<LoadStatus>('loading');
  progress = $state({ loaded: 0, total: 0 });
  error = $state<string | null>(null);
  catalogVersion = $state(0);
  layersVersion = $state(0);
  detailsReady = $state(false);
  detailsError = $state<string | null>(null);

  filter = $state<Filter>(defaultFilter());
  depthMode = $state(false);
  exaggeration = $state(2);
  autoRotate = $state(true);
  showPlates = $state(true);
  view = $state<ViewKind>('globe');
  webgl = $state(true);
  reducedMotion = $state(false);
  drawMode = $state(false);
  drawing = $state(false);
  interacted = $state(false);

  section = $state.raw<SectionState | null>(sectionFromPreset(FEATURED_PRESET));
  /** Bumped when the camera should fly to the section (presets, endpoint edits). */
  flyRequest = $state(0);
  fitMinDepth = $state(70);
  trueAspect = $state(false);
  sectionResult = $state.raw<SectionResult | null>(null);
  sectionBusy = $state(false);
  stats = $state.raw<StatsResult | null>(null);

  hover = $state.raw<EventInfo | null>(null);
  selected = $state.raw<EventInfo | null>(null);

  liveEnabled = $state(false);
  liveStatus = $state<LiveStatus>('off');
  liveFetchedAt = $state<number | null>(null);
  liveCount = $state(0);
  liveError = $state<string | null>(null);
  liveVersion = $state(0);

  playing = $state(false);
  /** Playback head in fractional years, or null when not playing/paused. */
  playYear = $state<number | null>(null);

  tab = $state<PanelTab>('section');
  howOpen = $state(false);
  howSection = $state<string | null>(null);

  /** Day number of the playback head (the shader shows events up to it). */
  get playDay(): number | null {
    if (this.playYear === null) return null;
    const y = Math.floor(this.playYear);
    const f = this.playYear - y;
    const start = dayOfYearStart(y);
    return start + f * (dayOfYearStart(y + 1) - start);
  }
}

export const app = new AppState();

// ------------------------------------------------------------------ playback

const YEARS_PER_SECOND = 2.2;
/** Under reduced motion the head jumps one whole year per step instead of sweeping. */
const STEP_SECONDS = 0.7;
let playRaf = 0;
let lastTick = 0;
let stepAcc = 0;

function tick(now: number) {
  playRaf = 0;
  if (!app.playing || app.playYear === null) return;
  const dt = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 0;
  lastTick = now;
  let next = app.playYear;
  if (app.reducedMotion) {
    stepAcc += dt;
    if (stepAcc >= STEP_SECONDS) {
      stepAcc = 0;
      next = Math.floor(app.playYear) + 1.999;
    }
  } else {
    next = app.playYear + dt * YEARS_PER_SECOND;
  }
  if (next >= app.filter.yearMax + 1) {
    app.playYear = null;
    app.playing = false;
    return;
  }
  app.playYear = next;
  playRaf = requestAnimationFrame(tick);
}

export function startPlayback() {
  const first = Math.max(app.filter.yearMin, LIMITS.year[0]);
  if (app.playYear === null || app.playYear >= app.filter.yearMax + 1) {
    app.playYear = app.reducedMotion ? first + 0.999 : first;
  }
  app.playing = true;
  lastTick = 0;
  stepAcc = 0;
  if (!playRaf) playRaf = requestAnimationFrame(tick);
}

export function pausePlayback() {
  app.playing = false;
  if (playRaf) cancelAnimationFrame(playRaf);
  playRaf = 0;
}

export function stopPlayback() {
  pausePlayback();
  app.playYear = null;
}

/** Steps the (paused) playback head by whole years. */
export function stepPlayback(delta: number) {
  pausePlayback();
  const start = app.playYear === null ? app.filter.yearMax : Math.floor(app.playYear);
  const next = Math.min(app.filter.yearMax, Math.max(app.filter.yearMin, start + delta));
  app.playYear = next + 0.999;
}
