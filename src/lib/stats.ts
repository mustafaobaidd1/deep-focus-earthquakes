/**
 * Magnitude–frequency statistics.
 *
 *  Gutenberg–Richter law:  log10 N(≥M) = a − b·M
 *
 *  b by maximum likelihood (Aki 1965) with Utsu's (1965) correction for magnitudes rounded to
 *  bins of width ΔM:
 *
 *      b = log10(e) / ( M̄ − (Mc − ΔM/2) )
 *
 *  standard error (Shi & Bolt 1982):
 *
 *      σ_b = 2.30 · b² · sqrt( Σ (Mᵢ − M̄)² / (n (n − 1)) )
 *
 *  (we use ln 10 = 2.302585 for their rounded 2.30), and Aki's simpler b / √n for comparison.
 *
 *  Magnitude of completeness Mc by maximum curvature (MAXC; Wiemer & Wyss 2000): the magnitude
 *  bin with the most events in the non-cumulative frequency–magnitude distribution.
 */

/** Magnitudes in hundredths are binned to `bin100` (10 = 0.1 magnitude units) by rounding. */
export function binIndex(mag100: number, bin100 = 10): number {
  return Math.round(mag100 / bin100);
}

export interface Fmd {
  /** Bin centres in magnitude units, ascending. */
  mags: number[];
  /** Number of events in each bin. */
  counts: number[];
  /** Number of events in this bin or above (cumulative from the top). */
  cumulative: number[];
  binWidth: number;
  total: number;
}

/** Frequency–magnitude distribution of binned magnitudes. */
export function frequencyMagnitude(mag100: ArrayLike<number>, binWidth = 0.1): Fmd {
  const bin100 = Math.round(binWidth * 100);
  if (mag100.length === 0) return { mags: [], counts: [], cumulative: [], binWidth, total: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < mag100.length; i++) {
    const k = binIndex(mag100[i], bin100);
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  const counts = new Array<number>(hi - lo + 1).fill(0);
  for (let i = 0; i < mag100.length; i++) counts[binIndex(mag100[i], bin100) - lo]++;
  const mags = counts.map((_, j) => ((lo + j) * bin100) / 100);
  const cumulative = new Array<number>(counts.length);
  let run = 0;
  for (let j = counts.length - 1; j >= 0; j--) {
    run += counts[j];
    cumulative[j] = run;
  }
  return { mags, counts, cumulative, binWidth, total: mag100.length };
}

/** Mc by maximum curvature: the most populated bin (lowest one if tied). NaN when empty. */
export function mcMaxCurvature(fmd: Fmd): number {
  if (fmd.total === 0) return Number.NaN;
  let best = 0;
  for (let j = 1; j < fmd.counts.length; j++) if (fmd.counts[j] > fmd.counts[best]) best = j;
  return fmd.mags[best];
}

export interface BValue {
  b: number;
  /** a-value of log10 N(≥M) = a − bM for this selection (not normalised per year). */
  a: number;
  mc: number;
  /** Number of events with M ≥ Mc that entered the estimate. */
  n: number;
  meanMag: number;
  /** Shi & Bolt (1982) standard error. */
  sigma: number;
  /** Aki (1965) standard error b/√n, for comparison. */
  sigmaAki: number;
}

/** Smallest sample this tool will fit; below it the estimate is reported as unavailable. */
export const MIN_EVENTS_FOR_B = 50;

/**
 * Maximum-likelihood b-value for magnitudes (in hundredths) rounded to `binWidth`, using the
 * events at or above `mc`. Returns null with fewer than `minEvents` events or no spread.
 */
export function bValueMLE(
  mag100: ArrayLike<number>,
  mc: number,
  binWidth = 0.1,
  minEvents = MIN_EVENTS_FOR_B,
): BValue | null {
  const bin100 = Math.round(binWidth * 100);
  const mcBin = Math.round((mc * 100) / bin100);
  let n = 0;
  let sum = 0;
  for (let i = 0; i < mag100.length; i++) {
    const k = binIndex(mag100[i], bin100);
    if (k >= mcBin) {
      n++;
      sum += (k * bin100) / 100;
    }
  }
  if (n < Math.max(2, minEvents)) return null;
  const meanMag = sum / n;
  const mcValue = (mcBin * bin100) / 100;
  const denom = meanMag - (mcValue - binWidth / 2);
  if (!(denom > 0)) return null;
  const b = Math.LOG10E / denom;
  let ss = 0;
  for (let i = 0; i < mag100.length; i++) {
    const k = binIndex(mag100[i], bin100);
    if (k >= mcBin) {
      const m = (k * bin100) / 100;
      ss += (m - meanMag) ** 2;
    }
  }
  if (!(ss > 0)) return null;
  const sigma = Math.LN10 * b * b * Math.sqrt(ss / (n * (n - 1)));
  const a = Math.log10(n) + b * mcValue;
  return { b, a, mc: mcValue, n, meanMag, sigma, sigmaAki: b / Math.sqrt(n) };
}

/** Counts per bin for values on a regular grid starting at `start` with width `width`. */
export function histogram(
  values: ArrayLike<number>,
  start: number,
  width: number,
  bins: number,
): number[] {
  const out = new Array<number>(bins).fill(0);
  for (let i = 0; i < values.length; i++) {
    const k = Math.floor((values[i] - start) / width);
    if (k >= 0 && k < bins) out[k]++;
    else if (k >= bins) out[bins - 1]++;
    else out[0]++;
  }
  return out;
}

/** Deterministic PRNG (mulberry32), used for synthetic catalogues and bootstrap resampling. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthetic Gutenberg–Richter catalogue: continuous magnitudes above `mMin` drawn from the
 * exponential distribution with β = b·ln10 (inverse-CDF sampling), returned in hundredths and
 * rounded to `binWidth` like a real catalogue.
 */
export function syntheticGR(
  n: number,
  b: number,
  mMin: number,
  seed: number,
  binWidth = 0.1,
): Uint16Array {
  const rnd = mulberry32(seed);
  const out = new Uint16Array(n);
  const bin100 = Math.round(binWidth * 100);
  for (let i = 0; i < n; i++) {
    const u = 1 - rnd(); // (0, 1]
    const m = mMin - Math.log10(u) / b;
    out[i] = Math.round((m * 100) / bin100) * bin100;
  }
  return out;
}
