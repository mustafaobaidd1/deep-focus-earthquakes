/**
 * Reproducible data build for Deep Focus.
 *
 *   npm run fetch-data              # uses cached downloads in .cache/ when present
 *   npm run fetch-data -- --refresh # re-downloads everything
 *
 * 1. USGS ComCat via the FDSN event web service: every earthquake with M ≥ 5.0 from
 *    1973-01-01 to 2025-12-31 (UTC), one request per calendar year (the service caps a query at
 *    20,000 events; the busiest year, 2011, has under 3,000). Requests are sequential with a pause
 *    in between, and each year's event count is cross-checked against the service's /count
 *    endpoint.
 * 2. Natural Earth 1:50m coastlines (public domain), simplified to ~3 km.
 * 3. PB2002 plate boundaries (Bird 2003), GeoJSON by Hugo Ahlenius / Nordpil, ODC-By 1.0.
 *
 * Outputs (all under public/data/): catalog.bin.gz, details.tsv.gz, coast.bin.gz,
 * plates.bin.gz and fetch-log.json (query, date, per-year counts, file sizes and hashes).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { parseComcatCsv, type QuakeRow } from '../src/lib/csv';
import { encodeCatalog, encodeDetails } from '../src/lib/codec';
import { encodePolylines, simplifyLine } from '../src/lib/polyline';

const FIRST_YEAR = 1973;
const LAST_YEAR = 2025;
const MIN_MAG = 5;
const API = 'https://earthquake.usgs.gov/fdsnws/event/1';
const NE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson';
const PB_URL =
  'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json';
const USER_AGENT =
  'deep-focus-earthquakes data build (+https://github.com/mustafaobaidd1/deep-focus-earthquakes)';
const PAUSE_MS = 600;
const COAST_TOLERANCE_DEG = 0.03;

const refresh = process.argv.includes('--refresh');
const CACHE = '.cache';
const OUT = 'public/data';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function politeGet(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const text = await res.text();
      await sleep(PAUSE_MS);
      return text;
    }
    if (attempt >= 5 || (res.status < 500 && res.status !== 429)) {
      throw new Error(`GET ${url} failed: HTTP ${res.status} ${await res.text()}`);
    }
    const wait = 2000 * 2 ** (attempt - 1);
    console.warn(`  HTTP ${res.status}, retrying in ${wait / 1000}s…`);
    await sleep(wait);
  }
}

async function cached(file: string, url: string): Promise<string> {
  const path = `${CACHE}/${file}`;
  if (!refresh && existsSync(path)) return readFile(path, 'utf8');
  const text = await politeGet(url);
  await writeFile(path, text);
  return text;
}

function yearParams(year: number): URLSearchParams {
  return new URLSearchParams({
    starttime: `${year}-01-01T00:00:00`,
    endtime: `${year}-12-31T23:59:59.999`,
    minmagnitude: String(MIN_MAG),
    eventtype: 'earthquake',
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface YearLog {
  apiCount: number;
  rows: number;
}

async function fetchCatalogue(): Promise<{ rows: QuakeRow[]; years: Record<string, YearLog> }> {
  await mkdir(`${CACHE}/usgs`, { recursive: true });
  const all: QuakeRow[] = [];
  const years: Record<string, YearLog> = {};
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const params = yearParams(year);
    const countJson = await cached(
      `usgs/${year}.count.json`,
      `${API}/count?format=geojson&${params}`,
    );
    const apiCount = (JSON.parse(countJson) as { count: number; maxAllowed: number }).count;
    if (apiCount > 20000) throw new Error(`${year} has ${apiCount} events; split the request`);
    const csv = await cached(
      `usgs/${year}.csv`,
      `${API}/query?format=csv&orderby=time-asc&${params}`,
    );
    const { rows, skipped } = parseComcatCsv(csv);
    if (skipped > 0) console.warn(`  ${year}: skipped ${skipped} rows without time/location/mag`);
    const quakes = rows.filter((r) => r.type === 'earthquake' && r.mag >= MIN_MAG);
    years[year] = { apiCount, rows: quakes.length };
    const flag = quakes.length === apiCount ? '' : `  (count endpoint says ${apiCount})`;
    console.log(`${year}: ${quakes.length} earthquakes${flag}`);
    all.push(...quakes);
  }
  // Defensive de-duplication by event id (year windows do not overlap, but be safe).
  const seen = new Set<string>();
  const unique = all.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  if (unique.length !== all.length)
    console.warn(`removed ${all.length - unique.length} duplicates`);
  unique.sort((a, b) => a.timeMs - b.timeMs);
  return { rows: unique, years };
}

interface GeoFeature {
  geometry: { type: string; coordinates: number[][] | number[][][] };
  properties: Record<string, string>;
}

function linesOf(f: GeoFeature): [number, number][][] {
  const c = f.geometry.coordinates;
  const raw = (f.geometry.type === 'LineString' ? [c] : c) as number[][][];
  return raw.map((line) => line.map((p) => [p[0], p[1]] as [number, number]));
}

async function buildCoast(): Promise<{ bytes: Uint8Array; points: number; lines: number }> {
  const geo = JSON.parse(await cached('src/ne_50m_coastline.geojson', NE_URL)) as {
    features: GeoFeature[];
  };
  const lines: [number, number][][] = [];
  for (const f of geo.features) {
    for (const line of linesOf(f)) {
      const s = simplifyLine(line, COAST_TOLERANCE_DEG);
      if (s.length >= 2) lines.push(s);
    }
  }
  const points = lines.reduce((n, l) => n + l.length, 0);
  return {
    bytes: encodePolylines(lines, new Array(lines.length).fill(0), ['coast']),
    points,
    lines: lines.length,
  };
}

async function buildPlates(): Promise<{ bytes: Uint8Array; points: number; lines: number }> {
  const geo = JSON.parse(await cached('src/PB2002_boundaries.json', PB_URL)) as {
    features: GeoFeature[];
  };
  const kindNames = ['boundary', 'subduction'];
  const lines: [number, number][][] = [];
  const kinds: number[] = [];
  for (const f of geo.features) {
    for (const line of linesOf(f)) {
      lines.push(line);
      kinds.push(f.properties.Type === 'subduction' ? 1 : 0);
    }
  }
  const points = lines.reduce((n, l) => n + l.length, 0);
  return { bytes: encodePolylines(lines, kinds, kindNames), points, lines: lines.length };
}

async function main() {
  await mkdir(`${CACHE}/src`, { recursive: true });
  await mkdir(OUT, { recursive: true });

  const { rows, years } = await fetchCatalogue();
  const catalog = encodeCatalog(rows);
  const details = new TextEncoder().encode(encodeDetails(rows));
  const coast = await buildCoast();
  const plates = await buildPlates();

  const files: Record<string, { bytes: number; gzipBytes: number; sha256: string }> = {};
  const write = async (name: string, raw: Uint8Array) => {
    const gz = gzipSync(raw, { level: 9 });
    await writeFile(`${OUT}/${name}`, gz);
    files[name] = { bytes: raw.length, gzipBytes: gz.length, sha256: sha256(gz) };
    console.log(
      `wrote ${name}: ${(raw.length / 1024).toFixed(0)} kB raw, ${(gz.length / 1024).toFixed(0)} kB gzip`,
    );
  };
  await write('catalog.bin.gz', catalog);
  await write('details.tsv.gz', details);
  await write('coast.bin.gz', coast.bytes);
  await write('plates.bin.gz', plates.bytes);

  const mags = rows.map((r) => r.mag);
  const depths = rows.map((r) => r.depth);
  const log = {
    source: 'USGS ANSS Comprehensive Earthquake Catalog (ComCat), FDSN event web service',
    endpoint: `${API}/query`,
    query: {
      format: 'csv',
      orderby: 'time-asc',
      minmagnitude: MIN_MAG,
      eventtype: 'earthquake',
      window:
        'one request per calendar year, starttime=YYYY-01-01T00:00:00, endtime=YYYY-12-31T23:59:59.999 (UTC)',
      firstYear: FIRST_YEAR,
      lastYear: LAST_YEAR,
    },
    fetchedAt: new Date().toISOString(),
    licence: 'USGS-authored or produced data and information are in the U.S. public domain.',
    total: rows.length,
    magnitude: { min: Math.min(...mags), max: Math.max(...mags) },
    depthKm: { min: Math.min(...depths), max: Math.max(...depths) },
    years,
    coastlines: {
      source: 'Natural Earth 1:50m coastline (public domain)',
      url: NE_URL,
      simplifiedToleranceDeg: COAST_TOLERANCE_DEG,
      lines: coast.lines,
      points: coast.points,
    },
    plateBoundaries: {
      source: 'PB2002 (Bird 2003, G-cubed 4(3), 1027), GeoJSON by Hugo Ahlenius, Nordpil',
      licence: 'Open Data Commons Attribution License (ODC-By) 1.0',
      url: PB_URL,
      lines: plates.lines,
      points: plates.points,
    },
    files,
  };
  await writeFile(`${OUT}/fetch-log.json`, `${JSON.stringify(log, null, 2)}\n`);
  console.log(`total ${rows.length} earthquakes; wrote ${OUT}/fetch-log.json`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
