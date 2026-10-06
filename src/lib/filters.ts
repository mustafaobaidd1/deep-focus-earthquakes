/**
 * Filter semantics, shared by the worker (counts, statistics, sections) and the GPU (which hides
 * filtered-out points with uniforms). Both sides compare the same integers — magnitude × 100,
 * depth × 10 and whole days since 1970 — so the globe never disagrees with the counts.
 */

export interface Filter {
  magMin: number;
  magMax: number;
  depthMin: number;
  depthMax: number;
  yearMin: number;
  yearMax: number;
}

export interface Limits {
  mag: [number, number];
  depth: [number, number];
  year: [number, number];
}

/** Slider extents. A handle resting on an extent means "no limit on this side". */
export const LIMITS: Limits = {
  mag: [5, 9.2],
  depth: [0, 700],
  year: [1973, 2025],
};

export function defaultFilter(limits: Limits = LIMITS): Filter {
  return {
    magMin: limits.mag[0],
    magMax: limits.mag[1],
    depthMin: limits.depth[0],
    depthMax: limits.depth[1],
    yearMin: limits.year[0],
    yearMax: limits.year[1],
  };
}

/** Inclusive integer bounds; open ends become ±1e9 so nothing outside the sliders is lost. */
export interface Bounds {
  mag100: [number, number];
  depth10: [number, number];
  day: [number, number];
}

const OPEN = 1e9;
const DAY_S = 86400;

export function dayOfYearStart(year: number): number {
  return Date.UTC(year, 0, 1) / 1000 / DAY_S;
}

export function toBounds(f: Filter, limits: Limits = LIMITS): Bounds {
  const lo = (v: number, edge: number, scale: number) =>
    v <= edge ? -OPEN : Math.round(v * scale);
  const hi = (v: number, edge: number, scale: number) => (v >= edge ? OPEN : Math.round(v * scale));
  return {
    mag100: [lo(f.magMin, limits.mag[0], 100), hi(f.magMax, limits.mag[1], 100)],
    depth10: [lo(f.depthMin, limits.depth[0], 10), hi(f.depthMax, limits.depth[1], 10)],
    day: [
      f.yearMin <= limits.year[0] ? -OPEN : dayOfYearStart(f.yearMin),
      f.yearMax >= limits.year[1] ? OPEN : dayOfYearStart(f.yearMax + 1) - 1,
    ],
  };
}

/** Day number (whole days since 1970-01-01 UTC) of an origin time in seconds. */
export function dayNumber(timeSeconds: number): number {
  return Math.floor(timeSeconds / DAY_S);
}

export function accepts(b: Bounds, mag100: number, depth10: number, day: number): boolean {
  return (
    mag100 >= b.mag100[0] &&
    mag100 <= b.mag100[1] &&
    depth10 >= b.depth10[0] &&
    depth10 <= b.depth10[1] &&
    day >= b.day[0] &&
    day <= b.day[1]
  );
}

export function isDefault(f: Filter, limits: Limits = LIMITS): boolean {
  const d = defaultFilter(limits);
  return (
    f.magMin <= d.magMin &&
    f.magMax >= d.magMax &&
    f.depthMin <= d.depthMin &&
    f.depthMax >= d.depthMax &&
    f.yearMin <= d.yearMin &&
    f.yearMax >= d.yearMax
  );
}
