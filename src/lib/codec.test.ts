import { describe, expect, it } from 'vitest';
import { parseComcatCsv, parseCsv } from './csv';
import {
  decodeCatalog,
  decodeDetails,
  encodeCatalog,
  encodeDetails,
  isGzip,
  normalizeLon,
} from './codec';
import { decodePolylines, encodePolylines, simplifyLine } from './polyline';

const sample = `time,latitude,longitude,depth,mag,magType,nst,gap,dmin,rms,net,id,updated,place,type,horizontalError,depthError,magError,magNst,status,locationSource,magSource
2013-05-24T05:44:48.980Z,54.892,153.221,598.1,8.3,mww,385,10,,1.02,us,usb000h4jh,2025-11-26T18:46:54.263Z,"2013 Sea of Okhotsk Earthquake",earthquake,,4.1,,,reviewed,us,us
1994-06-09T00:33:16.230Z,-13.841,-67.553,631.3,8.2,mw,,,,1.1,us,usp0006dzc,2022-04-28T17:38:56.965Z,"55 km NNW of Reyes, Bolivia",earthquake,,,,,reviewed,us,hrv
2011-03-11T05:46:24.120Z,38.297,142.373,29,9.1,mww,541,9.5,,1.16,official,official20110311054624120_30,2026-09-25T23:08:42.510Z,"2011 Great Tohoku Earthquake, Japan",earthquake,,,,,reviewed,us,official
2020-01-01T00:00:00.000Z,,,10,5.0,mb,,,,,us,broken,2020-01-01T00:00:00.000Z,"no location",earthquake,,,,,reviewed,us,us
`;

describe('CSV parsing', () => {
  it('handles quoted fields, escaped quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('x\n"multi\nline"\n')).toEqual([['x'], ['multi\nline']]);
  });

  it('reads ComCat rows by header name and skips rows without a location', () => {
    const { rows, skipped } = parseComcatCsv(sample);
    expect(skipped).toBe(1);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      lat: -13.841,
      lon: -67.553,
      depth: 631.3,
      mag: 8.2,
      magType: 'mw',
      id: 'usp0006dzc',
      place: '55 km NNW of Reyes, Bolivia',
      type: 'earthquake',
    });
    expect(rows[1].timeMs).toBe(Date.UTC(1994, 5, 9, 0, 33, 16, 230));
  });

  it('throws when a required column is missing', () => {
    expect(() => parseComcatCsv('time,latitude\n2020-01-01,1\n')).toThrow(/longitude/);
  });
});

describe('catalogue codec', () => {
  const { rows } = parseComcatCsv(sample);

  it('round-trips events sorted by time within the quantisation steps', () => {
    const cat = decodeCatalog(encodeCatalog(rows));
    expect(cat.count).toBe(3);
    const sorted = [...rows].sort((a, b) => a.timeMs - b.timeMs);
    sorted.forEach((r, i) => {
      expect(cat.time[i]).toBe(Math.floor(r.timeMs / 1000));
      expect(Math.abs(cat.lat[i] - r.lat)).toBeLessThanOrEqual(0.5 / 360 + 1e-6);
      expect(Math.abs(cat.lon[i] - r.lon)).toBeLessThanOrEqual(0.5 / 180 + 1e-6);
      expect(cat.depth10[i]).toBe(Math.round(r.depth * 10));
      expect(cat.mag100[i]).toBe(Math.round(r.mag * 100));
      expect(cat.magTypes[cat.magType[i]]).toBe(r.magType);
    });
  });

  it('keeps details in the same order', () => {
    const d = decodeDetails(encodeDetails(rows), 3);
    expect(d.ids).toEqual(['usp0006dzc', 'official20110311054624120_30', 'usb000h4jh']);
    expect(d.places[0]).toBe('55 km NNW of Reyes, Bolivia');
    expect(() => decodeDetails(encodeDetails(rows), 4)).toThrow(/expected 4/);
  });

  it('rejects foreign and truncated files', () => {
    expect(() => decodeCatalog(new Uint8Array(10))).toThrow(/truncated/);
    expect(() => decodeCatalog(new Uint8Array(64))).toThrow(/Not a Deep Focus/);
    const good = encodeCatalog(rows);
    expect(() => decodeCatalog(good.subarray(0, 40))).toThrow(/truncated/);
  });

  it('handles an empty catalogue', () => {
    expect(decodeCatalog(encodeCatalog([])).count).toBe(0);
  });

  it('normalises longitudes and detects gzip', () => {
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(normalizeLon(180)).toBe(180);
    expect(isGzip(new Uint8Array([0x1f, 0x8b, 8]))).toBe(true);
    expect(isGzip(new Uint8Array([0x44, 0x46]))).toBe(false);
  });
});

describe('polyline codec', () => {
  it('round-trips lines at 0.01° with kinds', () => {
    const lines: [number, number][][] = [
      [
        [-179.99, -16.5],
        [179.5, -17.25],
        [178.01, -18],
      ],
      [
        [10, 50],
        [10.5, 50.5],
      ],
    ];
    const set = decodePolylines(encodePolylines(lines, [1, 0], ['boundary', 'subduction']));
    expect(set.lines).toHaveLength(2);
    expect(Array.from(set.lines[0])).toEqual(
      lines[0].flat().map((v) => Math.fround(Math.round(v * 100) / 100)),
    );
    expect(Array.from(set.kinds)).toEqual([1, 0]);
    expect(set.kindNames).toEqual(['boundary', 'subduction']);
  });

  it('simplifies with Douglas–Peucker and keeps endpoints', () => {
    const line: [number, number][] = Array.from({ length: 101 }, (_, i) => [i / 10, 0]);
    line[50] = [5, 0.5];
    const s = simplifyLine(line, 0.1);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual([10, 0]);
    expect(s).toContainEqual([5, 0.5]);
    expect(s.length).toBeLessThan(10);
  });
});
