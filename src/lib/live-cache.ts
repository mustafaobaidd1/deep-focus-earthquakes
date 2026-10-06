/**
 * Live layer: USGS real-time feed of M ≥ 2.5 earthquakes in the past 30 days, with a compact
 * copy in localStorage so a reload within 15 minutes needs no network and an offline visit can
 * still show the last feed it saw (clearly labelled as stale).
 */
import type { LiveData } from '../worker/protocol';

/**
 * USGS recommends the real-time feeds (rather than ad-hoc FDSN queries) for displaying recent
 * earthquakes; this CSV has the same columns as the FDSN event service.
 */
export const LIVE_FEED_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.csv';
export const LIVE_CACHE_KEY = 'deep-focus:live:v1';
export const LIVE_FRESH_MS = 15 * 60 * 1000;

interface CachedLive {
  v: 1;
  fetchedAt: number;
  t: number[];
  la: number[];
  lo: number[];
  d: number[];
  m: number[];
  mt: string[];
  id: string[];
  pl: string[];
}

export function serializeLive(data: LiveData, fetchedAt: number): string {
  const round = (x: number, k: number) => Math.round(x * k) / k;
  const c: CachedLive = {
    v: 1,
    fetchedAt,
    t: Array.from(data.time),
    la: Array.from(data.lat, (x) => round(x, 1e4)),
    lo: Array.from(data.lon, (x) => round(x, 1e4)),
    d: Array.from(data.depthKm, (x) => round(x, 100)),
    m: Array.from(data.mag, (x) => round(x, 100)),
    mt: data.magTypes,
    id: data.ids,
    pl: data.places,
  };
  return JSON.stringify(c);
}

export function deserializeLive(text: string | null): { data: LiveData; fetchedAt: number } | null {
  if (!text) return null;
  try {
    const c = JSON.parse(text) as CachedLive;
    if (c.v !== 1 || !Array.isArray(c.t)) return null;
    const n = c.t.length;
    if ([c.la, c.lo, c.d, c.m, c.mt, c.id, c.pl].some((a) => !Array.isArray(a) || a.length !== n)) {
      return null;
    }
    return {
      fetchedAt: c.fetchedAt,
      data: {
        count: n,
        time: Float64Array.from(c.t),
        lat: Float32Array.from(c.la),
        lon: Float32Array.from(c.lo),
        depthKm: Float32Array.from(c.d),
        mag: Float32Array.from(c.m),
        magTypes: c.mt,
        ids: c.id,
        places: c.pl,
      },
    };
  } catch {
    return null;
  }
}

export type LiveStatus = 'off' | 'loading' | 'fresh' | 'stale' | 'error';

/** What to tell the reader about a cached copy of age `ageMs` after a refresh attempt. */
export function cacheVerdict(ageMs: number, refreshFailed: boolean): LiveStatus {
  if (ageMs <= LIVE_FRESH_MS && !refreshFailed) return 'fresh';
  return refreshFailed ? 'stale' : 'loading';
}

export function readCache(storage: Pick<Storage, 'getItem'> | null): {
  data: LiveData;
  fetchedAt: number;
} | null {
  try {
    return deserializeLive(storage?.getItem(LIVE_CACHE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeCache(
  storage: Pick<Storage, 'setItem'> | null,
  data: LiveData,
  fetchedAt: number,
): void {
  try {
    storage?.setItem(LIVE_CACHE_KEY, serializeLive(data, fetchedAt));
  } catch {
    // Storage may be full or disabled (private mode); the live layer still works without it.
  }
}
