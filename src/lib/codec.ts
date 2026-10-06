/**
 * Compact columnar encoding of the earthquake catalogue.
 *
 * Layout (little-endian), version 1:
 *
 *   0  "DFQ1"                magic
 *   4  u32 count             number of events
 *   8  f64 baseTime          origin time of the first event, whole seconds since 1970 (UTC)
 *  16  u32 magTypeBytes      length of the UTF-8 JSON array of magnitude-type names at the end
 *  20  u32 reserved
 *  24  columns, each byte-plane shuffled (all low bytes, then the next byte, ...):
 *        dt     u32 × count  seconds since the previous event (events are sorted by time)
 *        lat    i16 × count  latitude  × 360  (0.0028° ≈ 310 m steps)
 *        lon    i16 × count  longitude × 180  (0.0056° ≈ 620 m steps at the equator)
 *        depth  i16 × count  depth in units of 0.1 km (negative = above sea level)
 *        mag    u16 × count  magnitude × 100
 *        type   u8  × count  index into the magnitude-type table
 *      magnitude-type table as JSON
 *
 * Quantisation is far below the catalogue's own uncertainty: global M ≥ 5 epicentres are
 * typically uncertain by 5–15 km and depths by several km.
 *
 * Byte-plane shuffling puts the mostly-zero high bytes of the time deltas, depths and magnitudes
 * next to each other, which roughly halves the gzip size compared with interleaved bytes.
 */

export const LAT_SCALE = 360;
export const LON_SCALE = 180;
export const DEPTH_SCALE = 10;
export const MAG_SCALE = 100;
const MAGIC = 0x31514644; // "DFQ1" read as little-endian u32
const HEADER_BYTES = 24;

export interface EncodableEvent {
  timeMs: number;
  lat: number;
  lon: number;
  depth: number;
  mag: number;
  magType: string;
}

/** The decoded catalogue: parallel typed arrays, one entry per event, sorted by time. */
export interface Catalog {
  count: number;
  /** Origin time, whole seconds since 1970-01-01T00:00:00Z. */
  time: Float64Array;
  /** Latitude, degrees (quantised). */
  lat: Float32Array;
  /** Longitude, degrees in [-180, 180] (quantised). */
  lon: Float32Array;
  /** Depth in tenths of a kilometre — integers, so filters compare exactly on CPU and GPU. */
  depth10: Int16Array;
  /** Magnitude × 100 — integers, for the same reason. */
  mag100: Uint16Array;
  magType: Uint8Array;
  magTypes: string[];
}

export function quantizeLat(lat: number): number {
  return Math.max(-32400, Math.min(32400, Math.round(lat * LAT_SCALE)));
}

export function normalizeLon(lon: number): number {
  let x = ((((lon + 180) % 360) + 360) % 360) - 180;
  if (x === -180 && lon > 0) x = 180;
  return x;
}

export function quantizeLon(lon: number): number {
  return Math.max(-32400, Math.min(32400, Math.round(normalizeLon(lon) * LON_SCALE)));
}

export function quantizeDepth(depthKm: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(depthKm * DEPTH_SCALE)));
}

export function quantizeMag(mag: number): number {
  return Math.max(0, Math.min(65535, Math.round(mag * MAG_SCALE)));
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

function shuffleInto(src: Uint8Array, elemBytes: number, dst: Uint8Array, dstOffset: number) {
  const count = src.length / elemBytes;
  for (let b = 0; b < elemBytes; b++) {
    const plane = dstOffset + b * count;
    for (let i = 0; i < count; i++) dst[plane + i] = src[i * elemBytes + b];
  }
}

function unshuffle(src: Uint8Array, offset: number, count: number, elemBytes: number): Uint8Array {
  const out = new Uint8Array(count * elemBytes);
  for (let b = 0; b < elemBytes; b++) {
    const plane = offset + b * count;
    for (let i = 0; i < count; i++) out[i * elemBytes + b] = src[plane + i];
  }
  return out;
}

/** Encodes events (any order) into the binary layout above. Events are sorted by time first. */
export function encodeCatalog(events: readonly EncodableEvent[]): Uint8Array {
  const sorted = [...events].sort((a, b) => a.timeMs - b.timeMs);
  const count = sorted.length;
  const magTypes: string[] = [];
  const typeIndex = new Map<string, number>();
  for (const e of sorted) {
    if (!typeIndex.has(e.magType)) {
      typeIndex.set(e.magType, magTypes.length);
      magTypes.push(e.magType);
    }
  }
  if (magTypes.length > 255) throw new Error('Too many magnitude types for a u8 index');

  const dt = new Uint32Array(count);
  const lat = new Int16Array(count);
  const lon = new Int16Array(count);
  const depth = new Int16Array(count);
  const mag = new Uint16Array(count);
  const type = new Uint8Array(count);
  const baseTime = count > 0 ? Math.floor(sorted[0].timeMs / 1000) : 0;
  let prev = baseTime;
  for (let i = 0; i < count; i++) {
    const e = sorted[i];
    const t = Math.floor(e.timeMs / 1000);
    const delta = t - prev;
    if (delta < 0 || delta > 0xffffffff) throw new Error(`Bad time delta at event ${i}`);
    dt[i] = delta;
    prev = t;
    lat[i] = quantizeLat(e.lat);
    lon[i] = quantizeLon(e.lon);
    depth[i] = quantizeDepth(e.depth);
    mag[i] = quantizeMag(e.mag);
    type[i] = typeIndex.get(e.magType)!;
  }

  const typeJson = new TextEncoder().encode(JSON.stringify(magTypes));
  const columns: [Uint8Array, number][] = [
    [new Uint8Array(dt.buffer), 4],
    [new Uint8Array(lat.buffer), 2],
    [new Uint8Array(lon.buffer), 2],
    [new Uint8Array(depth.buffer), 2],
    [new Uint8Array(mag.buffer), 2],
    [type, 1],
  ];
  let size = HEADER_BYTES;
  for (const [bytes] of columns) size = align4(size) + bytes.length;
  size = align4(size) + typeJson.length;

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, count, true);
  view.setFloat64(8, baseTime, true);
  view.setUint32(16, typeJson.length, true);
  view.setUint32(20, 0, true);
  let offset = HEADER_BYTES;
  for (const [bytes, elemBytes] of columns) {
    offset = align4(offset);
    shuffleInto(bytes, elemBytes, out, offset);
    offset += bytes.length;
  }
  offset = align4(offset);
  out.set(typeJson, offset);
  return out;
}

/** Decodes the binary layout. Throws a descriptive error for truncated or foreign files. */
export function decodeCatalog(input: ArrayBuffer | Uint8Array): Catalog {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < HEADER_BYTES) throw new Error('Catalogue file is truncated (no header)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Not a Deep Focus catalogue file');
  const count = view.getUint32(4, true);
  const baseTime = view.getFloat64(8, true);
  const typeBytes = view.getUint32(16, true);

  let offset = HEADER_BYTES;
  const take = (elemBytes: number): Uint8Array => {
    offset = align4(offset);
    if (offset + count * elemBytes > bytes.length) throw new Error('Catalogue file is truncated');
    const plain = unshuffle(bytes, offset, count, elemBytes);
    offset += count * elemBytes;
    return plain;
  };
  const dt = new Uint32Array(take(4).buffer);
  const latQ = new Int16Array(take(2).buffer);
  const lonQ = new Int16Array(take(2).buffer);
  const depth10 = new Int16Array(take(2).buffer);
  const mag100 = new Uint16Array(take(2).buffer);
  const magType = take(1);
  offset = align4(offset);
  if (offset + typeBytes > bytes.length) throw new Error('Catalogue file is truncated');
  const magTypes = JSON.parse(
    new TextDecoder().decode(bytes.subarray(offset, offset + typeBytes)),
  ) as string[];

  const time = new Float64Array(count);
  const lat = new Float32Array(count);
  const lon = new Float32Array(count);
  let t = baseTime;
  for (let i = 0; i < count; i++) {
    t += dt[i];
    time[i] = t;
    lat[i] = latQ[i] / LAT_SCALE;
    lon[i] = lonQ[i] / LON_SCALE;
  }
  return { count, time, lat, lon, depth10, mag100, magType, magTypes };
}

/** True when the bytes start with the gzip magic number (1f 8b). */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Splits the companion details file (one "id<TAB>place" line per event, same order). */
export function decodeDetails(text: string, expected: number): { ids: string[]; places: string[] } {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length !== expected) {
    throw new Error(`Details file has ${lines.length} lines, expected ${expected}`);
  }
  const ids = new Array<string>(expected);
  const places = new Array<string>(expected);
  for (let i = 0; i < expected; i++) {
    const tab = lines[i].indexOf('\t');
    ids[i] = tab < 0 ? lines[i] : lines[i].slice(0, tab);
    places[i] = tab < 0 ? '' : lines[i].slice(tab + 1);
  }
  return { ids, places };
}

/** Builds the details text in the same (time-sorted) order as encodeCatalog. */
export function encodeDetails(
  events: readonly (EncodableEvent & { id: string; place: string })[],
): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();
  return [...events]
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((e) => `${clean(e.id)}\t${clean(e.place)}\n`)
    .join('');
}
