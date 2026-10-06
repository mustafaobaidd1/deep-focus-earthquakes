import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_KM, makeSection, offsetPoint, toLatLon } from './geo';
import { fitLineTLS, fitSlab, selectSection } from './section';
import { mulberry32 } from './stats';

/** Points scattered around a planar slab dipping `dipDeg` towards A′ (or A when negative). */
function syntheticSlab(dipDeg: number, n: number, noiseKm: number, seed: number) {
  const rnd = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const along: number[] = [];
  const depth: number[] = [];
  const t = (Math.abs(dipDeg) * Math.PI) / 180;
  const sign = Math.sign(dipDeg) || 1;
  for (let i = 0; i < n; i++) {
    const s = 20 + rnd() * 700; // distance down-dip, km
    const off = gauss() * noiseKm; // perpendicular scatter (slab thickness)
    along.push(400 + sign * (s * Math.cos(t) - off * Math.sin(t)));
    depth.push(10 + s * Math.sin(t) + off * Math.cos(t));
  }
  return { along, depth };
}

describe('total-least-squares line fit', () => {
  it('recovers exact lines at any orientation, including vertical', () => {
    for (const deg of [0, 15, 45, 60, 89, 90]) {
      const t = (deg * Math.PI) / 180;
      const xs = Array.from({ length: 20 }, (_, i) => 100 + i * 10 * Math.cos(t));
      const zs = Array.from({ length: 20 }, (_, i) => 50 + i * 10 * Math.sin(t));
      expect(fitLineTLS(xs, zs)!.dipDeg).toBeCloseTo(deg, 9);
    }
  });
});

describe('slab dip fit', () => {
  for (const dip of [20, 45, 60, 80]) {
    it(`recovers a ${dip}° synthetic slab within 1° (30 km thick, 400 events)`, () => {
      const { along, depth } = syntheticSlab(dip, 400, 15, dip);
      const res = fitSlab(along, depth, 70);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(Math.abs(res.fit.dipDeg - dip)).toBeLessThan(1);
      expect(res.fit.dipSigma).toBeGreaterThan(0);
      expect(res.fit.dipSigma).toBeLessThan(2);
      expect(res.fit.deepensTowards).toBe(1);
      expect(res.fit.rmsKm).toBeGreaterThan(8);
      expect(res.fit.rmsKm).toBeLessThan(25);
    });
  }

  it('reports which end the slab deepens towards', () => {
    const { along, depth } = syntheticSlab(-50, 300, 10, 4);
    const res = fitSlab(along, depth, 70);
    expect(res.ok && res.fit.deepensTowards).toBe(-1);
    expect(res.ok && Math.abs(res.fit.dipDeg - 50)).toBeLessThan(1);
  });

  it('is not dragged by a few far outliers (trimmed refit)', () => {
    const { along, depth } = syntheticSlab(45, 300, 10, 8);
    for (let k = 0; k < 15; k++) {
      along.push(50 + k * 3);
      depth.push(600 + k);
    }
    const res = fitSlab(along, depth, 70);
    expect(res.ok && Math.abs(res.fit.dipDeg - 45)).toBeLessThan(1.5);
  });

  it('declines when there are too few deep events (a strike-slip boundary)', () => {
    const rnd = mulberry32(3);
    const along = Array.from({ length: 200 }, () => rnd() * 600);
    const depth = Array.from({ length: 200 }, () => 5 + rnd() * 25);
    depth[0] = 120; // a single stray deep event
    const res = fitSlab(along, depth, 70);
    expect(res).toEqual({ ok: false, reason: 'few-events', candidates: 1 });
  });

  it('declines when deep events form a blob without a linear trend', () => {
    const rnd = mulberry32(12);
    const along = Array.from({ length: 300 }, () => 300 + rnd() * 100);
    const depth = Array.from({ length: 300 }, () => 100 + rnd() * 100);
    const res = fitSlab(along, depth, 70);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('no-trend');
  });

  it('is deterministic for the same input', () => {
    const { along, depth } = syntheticSlab(35, 200, 20, 99);
    expect(fitSlab(along, depth)).toEqual(fitSlab(along, depth));
  });
});

describe('corridor selection', () => {
  const g = makeSection(-15, 170, -25, 190); // crosses the antimeridian
  // Build a small catalogue at known section coordinates.
  const cases = [
    { along: 0.1, crossKm: 0, depth: 10, inside: true },
    { along: 0.5, crossKm: 149, depth: 300, inside: true },
    { along: 0.5, crossKm: -149, depth: 300, inside: true },
    { along: 0.5, crossKm: 151, depth: 300, inside: false },
    { along: -0.01, crossKm: 0, depth: 50, inside: false },
    { along: 1.01, crossKm: 0, depth: 50, inside: false },
    { along: 0.99, crossKm: 10, depth: 600, inside: true },
  ];
  const lat: number[] = [];
  const lon: number[] = [];
  for (const c of cases) {
    const [la, lo] = toLatLon(offsetPoint(g, g.angle * c.along, c.crossKm / EARTH_RADIUS_KM));
    lat.push(la);
    lon.push(lo);
  }

  it('keeps exactly the events within the half-width and between the endpoints', () => {
    const hits = selectSection(
      g,
      150,
      cases.length,
      lat,
      lon,
      (i) => cases[i].depth,
      () => 6,
      () => true,
    );
    const expected = cases.flatMap((c, i) => (c.inside ? [i] : []));
    expect(Array.from(hits.index)).toEqual(expected);
    hits.index.forEach((i, k) => {
      expect(hits.along[k]).toBeCloseTo(cases[i].along * g.lengthKm, 2);
      expect(hits.cross[k]).toBeCloseTo(cases[i].crossKm, 2);
      expect(hits.depth[k]).toBe(cases[i].depth);
    });
  });

  it('applies the extra filter', () => {
    const hits = selectSection(
      g,
      150,
      cases.length,
      lat,
      lon,
      (i) => cases[i].depth,
      () => 6,
      (i) => cases[i].depth >= 300,
    );
    expect(Array.from(hits.index)).toEqual([1, 2, 6]);
  });
});
