/**
 * Spherical-Earth geodesy for cross-sections.
 *
 * The Earth is treated as a sphere of the IUGG mean radius R1 = 6371.0088 km (Moritz 2000).
 * Over the few thousand kilometres of a cross-section this differs from the WGS84 ellipsoid by
 * at most ~0.5 %, far below the epicentre uncertainty of the catalogue.
 */
export const EARTH_RADIUS_KM = 6371.0088;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type Vec3 = [number, number, number];

export function toUnit(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * D2R;
  const lon = lonDeg * D2R;
  const c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}

export function toLatLon(v: Vec3): [number, number] {
  const [x, y, z] = v;
  const lat = Math.atan2(z, Math.hypot(x, y)) * R2D;
  const lon = Math.atan2(y, x) * R2D;
  return [lat, lon];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l === 0 ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l];
}

/** Central angle between two unit vectors, robust for tiny and near-antipodal angles. */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));
}

/**
 * Great-circle distance by the haversine formula (Sinnott 1984), in km for radius `r`.
 * Uses the atan2 form, 2·atan2(√h, √(1−h)), which stays accurate near antipodal points where
 * 2·asin(√h) loses precision.
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  r = EARTH_RADIUS_KM,
): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north in [0, 360). */
export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point reached from (lat, lon) travelling `distKm` along a great circle with `bearingDeg`. */
export function destination(
  latDeg: number,
  lonDeg: number,
  bearingDeg: number,
  distKm: number,
): [number, number] {
  const d = distKm / EARTH_RADIUS_KM;
  const t = bearingDeg * D2R;
  const p1 = latDeg * D2R;
  const l1 = lonDeg * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 =
    l1 +
    Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 * R2D, ((((l2 * R2D + 180) % 360) + 360) % 360) - 180];
}

/** 16-point compass name for a bearing, e.g. 292.5° → "WNW". */
export function compassPoint(bearingDeg: number): string {
  const names = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return names[Math.round((((bearingDeg % 360) + 360) % 360) / 22.5) % 16];
}

/** A great-circle cross-section from A to A′. */
export interface SectionGeometry {
  a: Vec3;
  b: Vec3;
  /** Unit normal of the great-circle plane, a × b normalised (points to the left of A→A′). */
  n: Vec3;
  /** Unit vector in the plane, perpendicular to a, pointing towards b. */
  t: Vec3;
  /** Central angle A→A′ in radians. */
  angle: number;
  lengthKm: number;
}

export function makeSection(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): SectionGeometry {
  const a = toUnit(latA, lonA);
  const b = toUnit(latB, lonB);
  const angle = angleBetween(a, b);
  if (angle < 1e-9 || Math.PI - angle < 1e-9) {
    throw new Error('Section endpoints must be distinct and not antipodal');
  }
  const n = normalize(cross(a, b));
  const t = cross(n, a);
  return { a, b, n, t, angle, lengthKm: angle * EARTH_RADIUS_KM };
}

/**
 * Projects a point onto the section's great circle.
 *
 *   cross-track  δ = asin(p · n)                         (signed, + to the left of A→A′)
 *   along-track  θ = atan2(p · t, p · a)                 (signed, 0 at A, increasing to A′)
 *
 * Both are returned as surface distances in km (R·δ, R·θ). This is the vector form of the
 * classic cross-track / along-track formulas (e.g. Williams' Aviation Formulary).
 */
export function projectOntoSection(
  g: SectionGeometry,
  latDeg: number,
  lonDeg: number,
): { alongKm: number; crossKm: number } {
  const p = toUnit(latDeg, lonDeg);
  const s = Math.max(-1, Math.min(1, dot(p, g.n)));
  const crossAngle = Math.asin(s);
  const along = Math.atan2(dot(p, g.t), dot(p, g.a));
  return { alongKm: along * EARTH_RADIUS_KM, crossKm: crossAngle * EARTH_RADIUS_KM };
}

/** Point at fraction f ∈ [0, 1] along the section (spherical linear interpolation). */
export function pointAlong(g: SectionGeometry, f: number): Vec3 {
  const th = g.angle * f;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [g.a[0] * c + g.t[0] * s, g.a[1] * c + g.t[1] * s, g.a[2] * c + g.t[2] * s];
}

/** Point at along-track θ (radians) and cross-track δ (radians) relative to the section. */
export function offsetPoint(g: SectionGeometry, alongRad: number, crossRad: number): Vec3 {
  const ca = Math.cos(alongRad);
  const sa = Math.sin(alongRad);
  const base: Vec3 = [
    g.a[0] * ca + g.t[0] * sa,
    g.a[1] * ca + g.t[1] * sa,
    g.a[2] * ca + g.t[2] * sa,
  ];
  const cd = Math.cos(crossRad);
  const sd = Math.sin(crossRad);
  return normalize([
    base[0] * cd + g.n[0] * sd,
    base[1] * cd + g.n[1] * sd,
    base[2] * cd + g.n[2] * sd,
  ]);
}
