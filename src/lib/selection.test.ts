import { describe, expect, it } from 'vitest';
import { decodeCatalog, encodeCatalog, type EncodableEvent } from './codec';
import { defaultFilter } from './filters';
import { computeSection, computeStats, LARGEST_COUNT } from './selection';
import { mulberry32 } from './stats';

/** A small synthetic catalogue: a dipping slab along the equator plus scattered shallow events. */
function makeCatalog() {
  const rnd = mulberry32(77);
  const events: EncodableEvent[] = [];
  for (let i = 0; i < 400; i++) {
    const along = rnd() * 6; // degrees of longitude east of 170°E
    events.push({
      timeMs: Date.UTC(1980 + Math.floor(rnd() * 40), 0, 1 + Math.floor(rnd() * 300)),
      lat: (rnd() - 0.5) * 1.5,
      lon: 170 + along,
      depth: 80 + along * 111.2 * Math.tan((45 * Math.PI) / 180) * 0.5 + (rnd() - 0.5) * 20,
      mag: 5 + Math.round(-Math.log10(1 - rnd()) * 10) / 10,
      magType: 'mb',
    });
  }
  for (let i = 0; i < 300; i++) {
    events.push({
      timeMs: Date.UTC(1975 + Math.floor(rnd() * 50), 5, 1),
      lat: (rnd() - 0.5) * 60,
      lon: -60 + rnd() * 40,
      depth: 10,
      mag: 5 + Math.round(-Math.log10(1 - rnd()) * 10) / 10,
      magType: 'mww',
    });
  }
  return decodeCatalog(encodeCatalog(events));
}

const cat = makeCatalog();

describe('selection statistics', () => {
  it('counts everything with the default filter and splits depth classes', () => {
    const s = computeStats(cat, defaultFilter());
    expect(s.count).toBe(700);
    expect(s.total).toBe(700);
    expect(s.classes.shallow + s.classes.intermediate + s.classes.deep).toBe(700);
    expect(s.classes.shallow).toBeGreaterThanOrEqual(300);
    expect(s.perYear.reduce((a, b) => a + b, 0)).toBe(700);
    expect(s.depthHist.reduce((a, b) => a + b, 0)).toBe(700);
    expect(s.largest).toHaveLength(LARGEST_COUNT);
    for (let k = 1; k < s.largest.length; k++) {
      expect(cat.mag100[s.largest[k - 1]]).toBeGreaterThanOrEqual(cat.mag100[s.largest[k]]);
    }
    expect(s.b).not.toBeNull();
  });

  it('applies magnitude, depth and time filters; per-year counts ignore only time', () => {
    const f = { ...defaultFilter(), depthMin: 70, yearMin: 1990, yearMax: 1999 };
    const s = computeStats(cat, f);
    expect(s.classes.shallow).toBe(0);
    const intermediateOrDeep = computeStats(cat, { ...defaultFilter(), depthMin: 70 });
    expect(s.perYear).toEqual(intermediateOrDeep.perYear);
    expect(s.count).toBe(
      intermediateOrDeep.perYear.slice(1990 - 1973, 2000 - 1973).reduce((a, b) => a + b, 0),
    );
  });

  it('reports an empty selection cleanly', () => {
    const s = computeStats(cat, { ...defaultFilter(), magMin: 9.1 });
    expect(s.count).toBe(0);
    expect(s.b).toBeNull();
    expect(Number.isNaN(s.mc)).toBe(true);
    expect(s.largest).toEqual([]);
  });
});

describe('selection sections', () => {
  it('finds the synthetic slab and fits its dip', () => {
    const res = computeSection(cat, defaultFilter(), {
      a: [0, 169],
      b: [0, 177],
      halfWidthKm: 150,
      fitMinDepthKm: 70,
    });
    expect(res.index.length).toBe(400);
    expect(res.lengthKm).toBeCloseTo(8 * 111.195, 0);
    expect(res.fit.ok).toBe(true);
    if (res.fit.ok) {
      // depth grows by 0.5 km per km along the section: dip = atan(0.5) = 26.6°
      expect(res.fit.fit.dipDeg).toBeGreaterThan(24.5);
      expect(res.fit.fit.dipDeg).toBeLessThan(28.5);
      expect(res.fit.fit.deepensTowards).toBe(1);
    }
  });

  it('respects the filters inside the corridor', () => {
    const res = computeSection(
      cat,
      { ...defaultFilter(), depthMax: 200 },
      {
        a: [0, 169],
        b: [0, 177],
        halfWidthKm: 150,
        fitMinDepthKm: 70,
      },
    );
    expect(res.index.length).toBeGreaterThan(0);
    expect(res.index.length).toBeLessThan(400);
    expect(Math.max(...res.depth)).toBeLessThanOrEqual(200);
  });
});
