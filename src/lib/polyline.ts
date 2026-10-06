/**
 * Compact encoding for sets of geographic polylines (coastlines, plate boundaries).
 *
 * Layout (little-endian):
 *   0  "DFL1"            magic
 *   4  u32 lineCount
 *   8  u32 pointCount
 *  12  u32 kindCount     number of entries in the kind table (JSON at the end)
 *  16  u32 lengths[lineCount]
 *      u8  kinds[lineCount]            (index into the kind table, e.g. boundary type)
 *      i16 lon deltas (×100), byte-plane shuffled
 *      i16 lat deltas (×100), byte-plane shuffled
 *      kind table as JSON
 *
 * Coordinates are stored at 0.01° (≈1.1 km), delta-coded along each line.
 */

const MAGIC = 0x314c4644; // "DFL1"
const SCALE = 100;

export interface PolylineSet {
  /** Each line as a flat array [lon0, lat0, lon1, lat1, ...] in degrees. */
  lines: Float32Array[];
  /** Per-line kind index into `kindNames`. */
  kinds: Uint8Array;
  kindNames: string[];
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

export function encodePolylines(
  lines: readonly (readonly [number, number][])[],
  kinds: readonly number[],
  kindNames: readonly string[],
): Uint8Array {
  const lineCount = lines.length;
  let pointCount = 0;
  for (const l of lines) pointCount += l.length;
  const lonD = new Int16Array(pointCount);
  const latD = new Int16Array(pointCount);
  let k = 0;
  for (const line of lines) {
    let pLon = 0;
    let pLat = 0;
    for (const [lon, lat] of line) {
      const qLon = Math.round(lon * SCALE);
      const qLat = Math.round(lat * SCALE);
      // Longitude deltas wrap across the antimeridian, so a line may cross ±180°.
      let dLon = qLon - pLon;
      while (dLon > 18000) dLon -= 36000;
      while (dLon < -18000) dLon += 36000;
      const dLat = qLat - pLat;
      if (Math.abs(dLat) > 32767) throw new Error('Delta overflow');
      lonD[k] = dLon;
      latD[k] = dLat;
      pLon += dLon;
      pLat = qLat;
      k++;
    }
  }
  const kindJson = new TextEncoder().encode(JSON.stringify(kindNames));
  let size = 16 + lineCount * 4;
  size += lineCount;
  size = align4(size) + pointCount * 4;
  size = align4(size) + kindJson.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, lineCount, true);
  view.setUint32(8, pointCount, true);
  view.setUint32(12, kindNames.length, true);
  let o = 16;
  for (const l of lines) {
    view.setUint32(o, l.length, true);
    o += 4;
  }
  for (let i = 0; i < lineCount; i++) out[o + i] = kinds[i] ?? 0;
  o = align4(o + lineCount);
  const planes = (arr: Int16Array) => {
    const b = new Uint8Array(arr.buffer);
    for (let i = 0; i < arr.length; i++) {
      out[o + i] = b[i * 2];
      out[o + arr.length + i] = b[i * 2 + 1];
    }
    o += arr.length * 2;
  };
  planes(lonD);
  planes(latD);
  o = align4(o);
  out.set(kindJson, o);
  return out;
}

export function decodePolylines(input: ArrayBuffer | Uint8Array): PolylineSet {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 16 || view.getUint32(0, true) !== MAGIC) {
    throw new Error('Not a Deep Focus polyline file');
  }
  const lineCount = view.getUint32(4, true);
  const pointCount = view.getUint32(8, true);
  let o = 16;
  const lengths = new Uint32Array(lineCount);
  for (let i = 0; i < lineCount; i++) {
    lengths[i] = view.getUint32(o, true);
    o += 4;
  }
  const kinds = bytes.slice(o, o + lineCount);
  o = align4(o + lineCount);
  const readPlanes = (): Int16Array => {
    const b = new Uint8Array(pointCount * 2);
    for (let i = 0; i < pointCount; i++) {
      b[i * 2] = bytes[o + i];
      b[i * 2 + 1] = bytes[o + pointCount + i];
    }
    o += pointCount * 2;
    return new Int16Array(b.buffer);
  };
  const lonD = readPlanes();
  const latD = readPlanes();
  o = align4(o);
  const kindNames = JSON.parse(new TextDecoder().decode(bytes.subarray(o))) as string[];
  const lines: Float32Array[] = [];
  let k = 0;
  for (let i = 0; i < lineCount; i++) {
    const n = lengths[i];
    const flat = new Float32Array(n * 2);
    let qLon = 0;
    let qLat = 0;
    for (let j = 0; j < n; j++) {
      qLon += lonD[k];
      qLat += latD[k];
      let w = qLon;
      while (w > 18000) w -= 36000;
      while (w < -18000) w += 36000;
      flat[j * 2] = w / SCALE;
      flat[j * 2 + 1] = qLat / SCALE;
      k++;
    }
    lines.push(flat);
  }
  return { lines, kinds, kindNames };
}

/**
 * Douglas–Peucker simplification in lon/lat degrees. Good enough at 0.0x° tolerances away
 * from the poles; endpoints are always kept so closed rings stay closed.
 */
export function simplifyLine(points: readonly [number, number][], tol: number): [number, number][] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tol * tol;
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d2: number;
      if (len2 === 0) {
        d2 = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push([points[i][0], points[i][1]]);
  return out;
}
