import { LIVE_FEED_URL, LIVE_FRESH_MS, readCache, writeCache } from '../lib/live-cache';
import type { SectionSpec } from '../worker/protocol';
import { app, data, type EventInfo } from './app.svelte';
import { DataClient } from './data-client';
import type { PickHit } from './engine';

let client: DataClient | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function startData() {
  client?.terminate();
  app.status = 'loading';
  app.error = null;
  app.progress = { loaded: 0, total: 0 };
  client = new DataClient({
    onProgress(loaded, total) {
      app.progress = { loaded, total };
    },
    onCatalog(columns, meta) {
      data.catalog = columns;
      data.meta = meta;
      app.catalogVersion++;
      app.status = 'ready';
    },
    onLayers(coast, plates) {
      data.coast = coast;
      data.plates = plates;
      app.layersVersion++;
    },
    onDetailsReady() {
      app.detailsReady = true;
      app.detailsError = null;
    },
    onError(scope, message) {
      if (scope === 'catalog') {
        app.status = 'error';
        app.error = message;
      } else if (scope === 'details') {
        app.detailsError = message;
      }
      // A missing map layer only costs the coastlines; the data still works.
    },
  });
  client.init(`${import.meta.env.BASE_URL}data/`);
}

// ------------------------------------------------------------------ statistics & sections

let statsSeq = 0;
export async function refreshStats() {
  if (!client || app.status !== 'ready') return;
  const seq = ++statsSeq;
  const filter = { ...app.filter };
  if (app.playYear !== null) filter.yearMax = Math.min(filter.yearMax, Math.floor(app.playYear));
  try {
    const result = await client.stats(filter);
    if (seq === statsSeq) app.stats = result;
  } catch {
    /* superseded or failed: keep the previous numbers */
  }
}

let sectionSeq = 0;
export async function refreshSection() {
  if (!client || app.status !== 'ready') return;
  const s = app.section;
  const seq = ++sectionSeq;
  if (!s) {
    app.sectionResult = null;
    app.sectionBusy = false;
    return;
  }
  const spec: SectionSpec = {
    a: s.a,
    b: s.b,
    halfWidthKm: s.halfWidthKm,
    fitMinDepthKm: app.fitMinDepth,
  };
  const filter = { ...app.filter };
  if (app.playYear !== null) filter.yearMax = Math.min(filter.yearMax, Math.floor(app.playYear));
  app.sectionBusy = true;
  try {
    const result = await client.section(filter, spec);
    if (seq === sectionSeq) app.sectionResult = result;
  } catch {
    if (seq === sectionSeq) app.sectionResult = null;
  } finally {
    if (seq === sectionSeq) app.sectionBusy = false;
  }
}

// ------------------------------------------------------------------ event details

export function describeIndex(
  kind: 'catalog' | 'live',
  index: number,
  x: number | null = null,
  y: number | null = null,
): EventInfo | null {
  if (kind === 'catalog') {
    const c = data.catalog;
    if (!c || index < 0 || index >= c.count) return null;
    return {
      kind,
      index,
      time: c.time[index],
      lat: c.lat[index],
      lon: c.lon[index],
      depthKm: c.depth10[index] / 10,
      mag: c.mag100[index] / 100,
      magType: c.magTypes[c.magType[index]] ?? '',
      id: null,
      place: null,
      x,
      y,
    };
  }
  const l = data.live;
  if (!l || index < 0 || index >= l.count) return null;
  return {
    kind,
    index,
    time: l.time[index],
    lat: l.lat[index],
    lon: l.lon[index],
    depthKm: l.depthKm[index],
    mag: l.mag[index],
    magType: l.magTypes[index],
    id: l.ids[index],
    place: l.places[index],
    x,
    y,
  };
}

export function describeHit(hit: PickHit | null): EventInfo | null {
  return hit ? describeIndex(hit.kind, hit.index, hit.x, hit.y) : null;
}

/** Place names and ids load lazily in the worker; ask for them for the given catalogue rows. */
export async function fetchDetails(indices: number[]): Promise<{ id: string; place: string }[]> {
  if (!client || indices.length === 0) return [];
  try {
    return await client.details(indices);
  } catch {
    return indices.map(() => ({ id: '', place: '' }));
  }
}

/** Fills in id/place for an event shown in the hover or selection card. */
export async function completeEvent(info: EventInfo, target: 'hover' | 'selected') {
  if (info.kind !== 'catalog' || info.place !== null) return;
  const [d] = await fetchDetails([info.index]);
  const current = app[target];
  if (current && current.kind === info.kind && current.index === info.index) {
    app[target] = { ...current, id: d?.id || null, place: d?.place ?? '' };
  }
}

// ------------------------------------------------------------------ live layer

let liveSeq = 0;

export async function loadLive(force = false) {
  if (!client) return;
  const seq = ++liveSeq;
  const cached = readCache(storage());
  const now = Date.now();
  if (cached) {
    data.live = cached.data;
    app.liveFetchedAt = cached.fetchedAt;
    app.liveCount = cached.data.count;
    app.liveVersion++;
    if (!force && now - cached.fetchedAt <= LIVE_FRESH_MS) {
      app.liveStatus = 'fresh';
      app.liveError = null;
      return;
    }
  }
  app.liveStatus = 'loading';
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('You appear to be offline.');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let text: string;
    try {
      const res = await fetch(LIVE_FEED_URL, { signal: ctrl.signal, cache: 'no-cache' });
      if (!res.ok) throw new Error(`USGS feed answered HTTP ${res.status}.`);
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const parsed = await client.parseLive(text);
    if (seq !== liveSeq || !app.liveEnabled) return;
    const fetchedAt = Date.now();
    data.live = parsed;
    writeCache(storage(), parsed, fetchedAt);
    app.liveFetchedAt = fetchedAt;
    app.liveCount = parsed.count;
    app.liveStatus = 'fresh';
    app.liveError = null;
    app.liveVersion++;
  } catch (err) {
    if (seq !== liveSeq) return;
    const message =
      (err as Error).name === 'AbortError'
        ? 'The USGS feed did not answer within 15 seconds.'
        : (err as Error).message || 'The USGS feed could not be reached.';
    app.liveError = message.startsWith('Failed to fetch')
      ? 'The USGS feed could not be reached.'
      : message;
    app.liveStatus = cached ? 'stale' : 'error';
  }
}

export function setLiveEnabled(on: boolean) {
  app.liveEnabled = on;
  if (on) {
    void loadLive(false);
  } else {
    liveSeq++;
    app.liveStatus = 'off';
    data.live = null;
    app.liveVersion++;
    if (app.hover?.kind === 'live') app.hover = null;
    if (app.selected?.kind === 'live') app.selected = null;
  }
}
