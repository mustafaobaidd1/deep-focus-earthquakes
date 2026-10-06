/**
 * Per-selection computations (run in the worker): counts, histograms, b-value, sections.
 */
import type { Catalog } from './codec';
import { LIMITS, accepts, dayNumber, toBounds, type Filter, type Limits } from './filters';
import { makeSection } from './geo';
import { fitSlab, selectSection } from './section';
import { bValueMLE, frequencyMagnitude, mcMaxCurvature } from './stats';
import type { SectionResult, SectionSpec, StatsResult } from '../worker/protocol';

export const DEPTH_BIN_KM = 10;
export const DEPTH_BINS = 70;
export const LARGEST_COUNT = 8;

export function computeStats(cat: Catalog, filter: Filter, limits: Limits = LIMITS): StatsResult {
  const b = toBounds(filter, limits);
  const firstYear = limits.year[0];
  const years = limits.year[1] - firstYear + 1;
  const perYear = new Array<number>(years).fill(0);
  const depthHist = new Array<number>(DEPTH_BINS).fill(0);
  const mags: number[] = [];
  const classes = { shallow: 0, intermediate: 0, deep: 0 };
  const largest: number[] = [];
  let count = 0;
  // Year-independent bounds for the per-year chart.
  const noTime = { ...b, day: [-1e9, 1e9] as [number, number] };

  for (let i = 0; i < cat.count; i++) {
    const m = cat.mag100[i];
    const d = cat.depth10[i];
    const day = dayNumber(cat.time[i]);
    if (!accepts(noTime, m, d, day)) continue;
    const y = new Date(cat.time[i] * 1000).getUTCFullYear() - firstYear;
    if (y >= 0 && y < years) perYear[y]++;
    if (day < b.day[0] || day > b.day[1]) continue;

    count++;
    mags.push(m);
    const km = d / 10;
    depthHist[Math.min(DEPTH_BINS - 1, Math.max(0, Math.floor(km / DEPTH_BIN_KM)))]++;
    if (km < 70) classes.shallow++;
    else if (km < 300) classes.intermediate++;
    else classes.deep++;

    // Keep the largest events (ties: the more recent one wins, as later events come later).
    if (largest.length < LARGEST_COUNT || m >= cat.mag100[largest[largest.length - 1]]) {
      largest.push(i);
      largest.sort((p, q) => cat.mag100[q] - cat.mag100[p] || q - p);
      if (largest.length > LARGEST_COUNT) largest.length = LARGEST_COUNT;
    }
  }

  const fmd = frequencyMagnitude(mags);
  const mc = mcMaxCurvature(fmd);
  const bv = Number.isFinite(mc) ? bValueMLE(mags, mc) : null;
  return {
    count,
    total: cat.count,
    perYear,
    firstYear,
    depthHist,
    fmd,
    mc,
    b: bv,
    classes,
    largest,
  };
}

export function computeSection(
  cat: Catalog,
  filter: Filter,
  spec: SectionSpec,
  limits: Limits = LIMITS,
): SectionResult {
  const g = makeSection(spec.a[0], spec.a[1], spec.b[0], spec.b[1]);
  const b = toBounds(filter, limits);
  const hits = selectSection(
    g,
    spec.halfWidthKm,
    cat.count,
    cat.lat,
    cat.lon,
    (i) => cat.depth10[i] / 10,
    (i) => cat.mag100[i] / 100,
    (i) => accepts(b, cat.mag100[i], cat.depth10[i], dayNumber(cat.time[i])),
  );
  const fit = fitSlab(hits.along, hits.depth, spec.fitMinDepthKm);
  return { spec, lengthKm: g.lengthKm, ...hits, fit };
}
