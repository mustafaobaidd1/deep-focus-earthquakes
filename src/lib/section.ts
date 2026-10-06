import { EARTH_RADIUS_KM, toUnit, dot, type SectionGeometry } from './geo';
import { mulberry32 } from './stats';

/** Events inside a section corridor, in section coordinates. */
export interface SectionHits {
  /** Catalogue index of each hit. */
  index: Int32Array;
  /** Distance along the profile from A, km. */
  along: Float32Array;
  /** Signed distance from the profile line, km (+ = left of A→A′). */
  cross: Float32Array;
  /** Depth, km. */
  depth: Float32Array;
  /** Magnitude. */
  mag: Float32Array;
}

/**
 * Selects the events whose epicentre lies within `halfWidthKm` of the great circle A→A′ and
 * between A and A′ along it. `accept(i)` applies the other filters (magnitude, depth, time).
 */
export function selectSection(
  g: SectionGeometry,
  halfWidthKm: number,
  count: number,
  lat: ArrayLike<number>,
  lon: ArrayLike<number>,
  depthKm: (i: number) => number,
  magnitude: (i: number) => number,
  accept: (i: number) => boolean,
): SectionHits {
  const maxCross = Math.sin(halfWidthKm / EARTH_RADIUS_KM);
  const idx: number[] = [];
  const al: number[] = [];
  const cr: number[] = [];
  const [ax, ay, az] = g.a;
  const [tx, ty, tz] = g.t;
  const [nx, ny, nz] = g.n;
  const D2R = Math.PI / 180;
  for (let i = 0; i < count; i++) {
    // Cheap rejection first: |p · n| > sin(w/R) means outside the corridor.
    const la = lat[i] * D2R;
    const lo = lon[i] * D2R;
    const c = Math.cos(la);
    const px = c * Math.cos(lo);
    const py = c * Math.sin(lo);
    const pz = Math.sin(la);
    const s = px * nx + py * ny + pz * nz;
    if (s > maxCross || s < -maxCross) continue;
    const along = Math.atan2(px * tx + py * ty + pz * tz, px * ax + py * ay + pz * az);
    if (along < 0 || along > g.angle) continue;
    if (!accept(i)) continue;
    idx.push(i);
    al.push(along * EARTH_RADIUS_KM);
    cr.push(Math.asin(Math.max(-1, Math.min(1, s))) * EARTH_RADIUS_KM);
  }
  const n = idx.length;
  const out: SectionHits = {
    index: Int32Array.from(idx),
    along: Float32Array.from(al),
    cross: Float32Array.from(cr),
    depth: new Float32Array(n),
    mag: new Float32Array(n),
  };
  for (let k = 0; k < n; k++) {
    out.depth[k] = depthKm(idx[k]);
    out.mag[k] = magnitude(idx[k]);
  }
  return out;
}

/** Convenience for tests and one-off checks: unit vector dot with the section normal. */
export function crossTrackKm(g: SectionGeometry, latDeg: number, lonDeg: number): number {
  return Math.asin(Math.max(-1, Math.min(1, dot(toUnit(latDeg, lonDeg), g.n)))) * EARTH_RADIUS_KM;
}

export interface LineFit {
  /** Centroid of the fitted points (along km, depth km). */
  cx: number;
  cz: number;
  /** Unit direction of the principal axis (dx, dz), with dx ≥ 0. */
  dx: number;
  dz: number;
  /** Dip below horizontal in degrees, 0–90, at true scale (km against km). */
  dipDeg: number;
  /** Eigenvalues of the covariance matrix (largest first), km². */
  lambda1: number;
  lambda2: number;
}

/**
 * Total-least-squares (orthogonal) line through points: the principal axis of their covariance.
 * Unlike regressing depth on distance, it treats both coordinates alike and stays well-behaved
 * for near-vertical slabs (e.g. the Hindu Kush or the Marianas).
 */
export function fitLineTLS(
  x: ArrayLike<number>,
  z: ArrayLike<number>,
  use?: Uint8Array,
): LineFit | null {
  let n = 0;
  let sx = 0;
  let sz = 0;
  for (let i = 0; i < x.length; i++) {
    if (use && !use[i]) continue;
    n++;
    sx += x[i];
    sz += z[i];
  }
  if (n < 2) return null;
  const cx = sx / n;
  const cz = sz / n;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (let i = 0; i < x.length; i++) {
    if (use && !use[i]) continue;
    const ddx = x[i] - cx;
    const ddz = z[i] - cz;
    sxx += ddx * ddx;
    szz += ddz * ddz;
    sxz += ddx * ddz;
  }
  sxx /= n;
  szz /= n;
  sxz /= n;
  const tr = sxx + szz;
  const det = sxx * szz - sxz * sxz;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const lambda1 = tr / 2 + disc;
  const lambda2 = Math.max(0, tr / 2 - disc);
  const phi = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let dx = Math.cos(phi);
  let dz = Math.sin(phi);
  if (dx < 0 || (dx === 0 && dz < 0)) {
    dx = -dx;
    dz = -dz;
  }
  const dipDeg = (Math.atan2(Math.abs(dz), Math.abs(dx)) * 180) / Math.PI;
  return { cx, cz, dx, dz, dipDeg, lambda1, lambda2 };
}

export interface SlabFit extends LineFit {
  /** Events used (deeper than the threshold, after outlier trimming). */
  n: number;
  /** Events deeper than the threshold before trimming. */
  candidates: number;
  /** Bootstrap standard deviation of the dip, degrees. */
  dipSigma: number;
  /** +1 when the slab deepens towards A′, −1 when it deepens towards A. */
  deepensTowards: 1 | -1;
  /** RMS orthogonal distance of the used events from the line, km (a slab-thickness proxy). */
  rmsKm: number;
  /** Depth range covered by the used events, km. */
  zMin: number;
  zMax: number;
  /** Ends of the fitted segment (along km, depth km), spanning the used events. */
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export type SlabFitResult =
  { ok: true; fit: SlabFit } | { ok: false; reason: 'few-events' | 'no-trend'; candidates: number };

export const MIN_SLAB_EVENTS = 15;

/**
 * Fits the mean dip of the Wadati–Benioff zone: a TLS line through events deeper than
 * `minDepthKm`, refitted once after trimming events more than 3 robust standard deviations
 * (1.4826 × MAD, floored at 10 km) from the first line. The dip uncertainty is the standard
 * deviation over `bootstrap` resamples of the trimmed events, drawn with a fixed seed so the
 * same selection always reports the same number.
 */
export function fitSlab(
  along: ArrayLike<number>,
  depth: ArrayLike<number>,
  minDepthKm = 70,
  bootstrap = 300,
  seed = 20031,
): SlabFitResult {
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < along.length; i++) {
    if (depth[i] >= minDepthKm) {
      xs.push(along[i]);
      zs.push(depth[i]);
    }
  }
  const candidates = xs.length;
  if (candidates < MIN_SLAB_EVENTS) return { ok: false, reason: 'few-events', candidates };

  const first = fitLineTLS(xs, zs);
  if (!first) return { ok: false, reason: 'few-events', candidates };
  const resid = xs.map((x, i) => -first.dz * (x - first.cx) + first.dx * (zs[i] - first.cz));
  const absSorted = resid.map(Math.abs).sort((a, b) => a - b);
  const mad = absSorted[Math.floor(absSorted.length / 2)];
  const limit = Math.max(10, 3 * 1.4826 * mad);
  const keep = new Uint8Array(candidates);
  let kept = 0;
  for (let i = 0; i < candidates; i++) {
    if (Math.abs(resid[i]) <= limit) {
      keep[i] = 1;
      kept++;
    }
  }
  if (kept < MIN_SLAB_EVENTS) return { ok: false, reason: 'few-events', candidates };
  const fit = fitLineTLS(xs, zs, keep);
  if (!fit) return { ok: false, reason: 'few-events', candidates };
  // An isotropic blob has no meaningful dip: require a clearly elongated cloud.
  if (fit.lambda2 / fit.lambda1 > 0.36) return { ok: false, reason: 'no-trend', candidates };

  const ux: number[] = [];
  const uz: number[] = [];
  let zMin = Infinity;
  let zMax = -Infinity;
  let sumSq = 0;
  for (let i = 0; i < candidates; i++) {
    if (!keep[i]) continue;
    ux.push(xs[i]);
    uz.push(zs[i]);
    zMin = Math.min(zMin, zs[i]);
    zMax = Math.max(zMax, zs[i]);
    sumSq += (-fit.dz * (xs[i] - fit.cx) + fit.dx * (zs[i] - fit.cz)) ** 2;
  }
  // Along-profile extent of the used events, projected on the fitted axis.
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let i = 0; i < ux.length; i++) {
    const t = fit.dx * (ux[i] - fit.cx) + fit.dz * (uz[i] - fit.cz);
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
  }

  // Bootstrap the dip.
  const rnd = mulberry32(seed);
  const m = ux.length;
  const bx = new Float64Array(m);
  const bz = new Float64Array(m);
  let s1 = 0;
  let s2 = 0;
  let reps = 0;
  for (let r = 0; r < bootstrap; r++) {
    for (let k = 0; k < m; k++) {
      const j = Math.floor(rnd() * m);
      bx[k] = ux[j];
      bz[k] = uz[j];
    }
    const f = fitLineTLS(bx, bz);
    if (!f) continue;
    s1 += f.dipDeg;
    s2 += f.dipDeg * f.dipDeg;
    reps++;
  }
  const mean = reps > 0 ? s1 / reps : fit.dipDeg;
  const dipSigma = reps > 1 ? Math.sqrt(Math.max(0, (s2 - reps * mean * mean) / (reps - 1))) : 0;

  return {
    ok: true,
    fit: {
      ...fit,
      n: m,
      candidates,
      dipSigma,
      deepensTowards: fit.dz * fit.dx >= 0 ? 1 : -1,
      rmsKm: Math.sqrt(sumSq / m),
      zMin,
      zMax,
      x1: fit.cx + fit.dx * tMin,
      z1: fit.cz + fit.dz * tMin,
      x2: fit.cx + fit.dx * tMax,
      z2: fit.cz + fit.dz * tMax,
    },
  };
}
