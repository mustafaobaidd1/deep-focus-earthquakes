import { describe, expect, it } from 'vitest';
import {
  LIVE_CACHE_KEY,
  LIVE_FRESH_MS,
  cacheVerdict,
  deserializeLive,
  readCache,
  serializeLive,
  writeCache,
} from './live-cache';
import type { LiveData } from '../worker/protocol';

const sample: LiveData = {
  count: 2,
  time: Float64Array.from([1790000000, 1790003600]),
  lat: Float32Array.from([54.684, -20.5]),
  lon: Float32Array.from([-156.792, -175.25]),
  depthKm: Float32Array.from([20.8, 512.3]),
  mag: Float32Array.from([3.5, 5.1]),
  magTypes: ['ml', 'mb'],
  ids: ['aka2026tvbgrt', 'us7000abcd'],
  places: ['202 km SE of Perryville, Alaska', 'Tonga Islands'],
};

describe('live-feed cache', () => {
  it('round-trips the compact form', () => {
    const back = deserializeLive(serializeLive(sample, 123))!;
    expect(back.fetchedAt).toBe(123);
    expect(back.data.count).toBe(2);
    expect(back.data.ids).toEqual(sample.ids);
    expect(back.data.places[0]).toBe('202 km SE of Perryville, Alaska');
    expect(back.data.lat[1]).toBeCloseTo(-20.5, 4);
    expect(back.data.depthKm[1]).toBeCloseTo(512.3, 2);
    expect(Array.from(back.data.time)).toEqual([1790000000, 1790003600]);
  });

  it('rejects missing, foreign or inconsistent data instead of showing garbage', () => {
    expect(deserializeLive(null)).toBeNull();
    expect(deserializeLive('not json')).toBeNull();
    expect(deserializeLive('{"v":2}')).toBeNull();
    const broken = JSON.parse(serializeLive(sample, 1));
    broken.la.pop();
    expect(deserializeLive(JSON.stringify(broken))).toBeNull();
  });

  it('survives storage that throws (private mode, quota)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readCache(throwing)).toBeNull();
    expect(() => writeCache(throwing, sample, 1)).not.toThrow();
  });

  it('reads back what it wrote', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    writeCache(storage, sample, 42);
    expect(store.has(LIVE_CACHE_KEY)).toBe(true);
    expect(readCache(storage)?.data.count).toBe(2);
  });

  it('labels a cached copy fresh, refreshing or stale', () => {
    expect(cacheVerdict(LIVE_FRESH_MS - 1, false)).toBe('fresh');
    expect(cacheVerdict(LIVE_FRESH_MS + 1, false)).toBe('loading');
    expect(cacheVerdict(10, true)).toBe('stale');
  });
});
