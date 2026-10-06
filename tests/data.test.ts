/**
 * Integrity of the bundled catalogue in public/data against the fetch log written by
 * `npm run fetch-data`, and spot checks against values published by USGS ComCat.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeCatalog, decodeDetails, isGzip } from '../src/lib/codec';
import { decodePolylines } from '../src/lib/polyline';

const dir = new URL('../public/data/', import.meta.url);
const read = (name: string) => new Uint8Array(readFileSync(new URL(name, dir)));
const gz = (name: string) => {
  const raw = read(name);
  expect(isGzip(raw)).toBe(true);
  return new Uint8Array(gunzipSync(raw));
};

interface FetchLog {
  total: number;
  fetchedAt: string;
  query: { minmagnitude: number; eventtype: string; firstYear: number; lastYear: number };
  years: Record<string, { apiCount: number; rows: number }>;
  files: Record<string, { bytes: number; gzipBytes: number; sha256: string }>;
}

const log = JSON.parse(readFileSync(new URL('fetch-log.json', dir), 'utf8')) as FetchLog;
const cat = decodeCatalog(gz('catalog.bin.gz'));
const details = decodeDetails(new TextDecoder().decode(gz('details.tsv.gz')), cat.count);

function findEvent(isoTime: string): number {
  const t = Math.floor(Date.parse(isoTime) / 1000);
  for (let i = 0; i < cat.count; i++) if (cat.time[i] === t) return i;
  return -1;
}

describe('bundled catalogue', () => {
  it('has the total recorded in the fetch log', () => {
    expect(cat.count).toBe(log.total);
    expect(details.ids.length).toBe(log.total);
  });

  it('matches the per-year counts of the fetch log and of the USGS /count endpoint', () => {
    const perYear = new Map<number, number>();
    for (let i = 0; i < cat.count; i++) {
      const y = new Date(cat.time[i] * 1000).getUTCFullYear();
      perYear.set(y, (perYear.get(y) ?? 0) + 1);
    }
    for (let y = log.query.firstYear; y <= log.query.lastYear; y++) {
      const entry = log.years[String(y)];
      expect(entry, `year ${y} in fetch log`).toBeDefined();
      expect(perYear.get(y) ?? 0, `bundled count for ${y}`).toBe(entry.rows);
      expect(entry.rows, `rows vs /count for ${y}`).toBe(entry.apiCount);
    }
    expect([...perYear.keys()].every((y) => y >= 1973 && y <= 2025)).toBe(true);
  });

  it('is sorted by time and holds only M ≥ 5.0', () => {
    for (let i = 1; i < cat.count; i++) expect(cat.time[i]).toBeGreaterThanOrEqual(cat.time[i - 1]);
    expect(Math.min(...cat.mag100)).toBeGreaterThanOrEqual(500);
  });

  it('has unique event ids', () => {
    expect(new Set(details.ids).size).toBe(cat.count);
  });

  // Reference values from https://earthquake.usgs.gov/fdsnws/event/1/query (ComCat), 2026-10-06.
  const known = [
    {
      name: '2011 Tōhoku',
      time: '2011-03-11T05:46:24.120Z',
      id: 'official20110311054624120_30',
      lat: 38.297,
      lon: 142.373,
      depth: 29,
      mag: 9.1,
      magType: 'mww',
    },
    {
      name: '1994 Bolivia deep',
      time: '1994-06-09T00:33:16.230Z',
      id: 'usp0006dzc',
      lat: -13.841,
      lon: -67.553,
      depth: 631.3,
      mag: 8.2,
      magType: 'mw',
    },
    {
      name: '2013 Sea of Okhotsk deep',
      time: '2013-05-24T05:44:48.980Z',
      id: 'usb000h4jh',
      lat: 54.892,
      lon: 153.221,
      depth: 598.1,
      mag: 8.3,
      magType: 'mww',
    },
  ];
  for (const k of known) {
    it(`contains the ${k.name} earthquake with USGS values`, () => {
      const i = findEvent(k.time);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(details.ids[i]).toBe(k.id);
      expect(cat.lat[i]).toBeCloseTo(k.lat, 2); // stored at 1/360°
      expect(Math.abs(cat.lon[i] - k.lon)).toBeLessThan(1 / 180); // stored at 1/180°
      expect(cat.depth10[i] / 10).toBeCloseTo(k.depth, 5);
      expect(cat.mag100[i] / 100).toBeCloseTo(k.mag, 5);
      expect(cat.magTypes[cat.magType[i]]).toBe(k.magType);
    });
  }

  it('has the deep cluster: events between 500 and 700 km exist and nothing below 800 km', () => {
    let deep = 0;
    let max = -Infinity;
    for (let i = 0; i < cat.count; i++) {
      const d = cat.depth10[i] / 10;
      if (d >= 500) deep++;
      if (d > max) max = d;
    }
    expect(deep).toBeGreaterThan(1000);
    expect(max).toBeLessThanOrEqual(800);
  });
});

describe('bundled map layers', () => {
  it('decodes Natural Earth coastlines', () => {
    const coast = decodePolylines(gz('coast.bin.gz'));
    expect(coast.lines.length).toBeGreaterThan(500);
    for (const line of coast.lines) {
      for (let j = 0; j < line.length; j += 2) {
        expect(Math.abs(line[j])).toBeLessThanOrEqual(180.01);
        expect(Math.abs(line[j + 1])).toBeLessThanOrEqual(90.01);
      }
    }
  });

  it('decodes PB2002 plate boundaries with subduction zones tagged', () => {
    const plates = decodePolylines(gz('plates.bin.gz'));
    expect(plates.lines.length).toBe(241);
    expect(plates.kindNames).toEqual(['boundary', 'subduction']);
    expect(Array.from(plates.kinds).filter((k) => k === 1).length).toBe(65);
  });

  it('records sizes that keep the download small', () => {
    const total = Object.values(log.files).reduce((s, f) => s + f.gzipBytes, 0);
    expect(total).toBeLessThan(3 * 1024 * 1024);
  });
});
