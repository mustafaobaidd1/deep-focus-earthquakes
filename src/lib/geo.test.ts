import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_KM,
  angleBetween,
  compassPoint,
  destination,
  haversineKm,
  initialBearing,
  makeSection,
  offsetPoint,
  pointAlong,
  projectOntoSection,
  toLatLon,
  toUnit,
} from './geo';

const R = EARTH_RADIUS_KM;
const D2R = Math.PI / 180;

describe('haversine distance', () => {
  it('matches the Rosetta Code reference values (BNA → LAX)', () => {
    // https://rosettacode.org/wiki/Haversine_formula — N 36°7.2′ W 86°40.2′ → N 33°56.4′
    // W 118°24.0′: 2886.444442837983 km for R = 6371.0 km and 2887.259950607110 km for 6372.8 km.
    expect(haversineKm(36.12, -86.67, 33.94, -118.4, 6371.0)).toBeCloseTo(2886.444442837983, 6);
    expect(haversineKm(36.12, -86.67, 33.94, -118.4, 6372.8)).toBeCloseTo(2887.25995060711, 6);
  });

  it('gives exact arc lengths for constructed cases on the mean-radius sphere', () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo((Math.PI / 180) * R, 9); // 111.195 km
    expect(haversineKm(0, 0, 90, 0)).toBeCloseTo((Math.PI / 2) * R, 6); // pole to equator
    // Antipodes: 1 − h cancels to ~1e-16 in double precision, so even the atan2 form is only
    // good to ~0.1 m here (7e-12 relative) — the reason angleBetween() uses cross/dot instead.
    expect(haversineKm(10, 20, -10, -160)).toBeCloseTo(Math.PI * R, 3);
    expect(angleBetween(toUnit(10, 20), toUnit(-10, -160)) * R).toBeCloseTo(Math.PI * R, 6);
    expect(haversineKm(-33, 151, -33, 151)).toBe(0);
  });

  it('agrees with the vector central angle for random pairs', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let k = 0; k < 200; k++) {
      const [la1, lo1, la2, lo2] = [rnd() * 90, rnd() * 180, rnd() * 90, rnd() * 180];
      const vec = angleBetween(toUnit(la1, lo1), toUnit(la2, lo2)) * R;
      expect(haversineKm(la1, lo1, la2, lo2)).toBeCloseTo(vec, 6);
    }
  });
});

describe('bearings and destinations', () => {
  it('computes cardinal bearings', () => {
    expect(initialBearing(0, 0, 10, 0)).toBeCloseTo(0, 9);
    expect(initialBearing(0, 0, 0, 10)).toBeCloseTo(90, 9);
    expect(initialBearing(0, 0, -10, 0)).toBeCloseTo(180, 9);
    expect(initialBearing(0, 10, 0, 0)).toBeCloseTo(270, 9);
  });

  it('destination() inverts bearing + distance', () => {
    const [lat, lon] = destination(-20, -175, 290, 1500);
    expect(haversineKm(-20, -175, lat, lon)).toBeCloseTo(1500, 6);
    expect(initialBearing(-20, -175, lat, lon)).toBeCloseTo(290, 6);
  });

  it('names compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(292.5)).toBe('WNW');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(135)).toBe('SE');
  });

  it('round-trips unit vectors', () => {
    const [lat, lon] = toLatLon(toUnit(-15.5, 167.25));
    expect(lat).toBeCloseTo(-15.5, 12);
    expect(lon).toBeCloseTo(167.25, 12);
  });
});

describe('section projection', () => {
  it('measures along- and cross-track distances on an equatorial section', () => {
    const g = makeSection(0, 0, 0, 90);
    expect(g.lengthKm).toBeCloseTo((Math.PI / 2) * R, 6);
    const p = projectOntoSection(g, 3, 45); // 3° north of the midpoint
    expect(p.alongKm).toBeCloseTo((Math.PI / 4) * R, 6);
    expect(p.crossKm).toBeCloseTo(3 * D2R * R, 6); // + = left of travel (north when heading east)
    expect(projectOntoSection(g, -3, 45).crossKm).toBeCloseTo(-3 * D2R * R, 6);
  });

  it('is monotonic along an oblique profile', () => {
    const g = makeSection(-15, -177, -25, -170); // a Tonga-like oblique line
    let last = -Infinity;
    for (let k = 0; k <= 50; k++) {
      const [lat, lon] = toLatLon(pointAlong(g, k / 50));
      const { alongKm, crossKm } = projectOntoSection(g, lat, lon);
      expect(alongKm).toBeGreaterThan(last);
      expect(alongKm).toBeCloseTo((k / 50) * g.lengthKm, 6);
      expect(Math.abs(crossKm)).toBeLessThan(1e-6);
      last = alongKm;
    }
  });

  it('recovers a constructed perpendicular offset on an arbitrary great circle', () => {
    const g = makeSection(35.5, 139.2, 41.8, 128.4);
    for (const [frac, offKm] of [
      [0.5, 120],
      [0.1, -250],
      [0.9, 37.5],
    ]) {
      const v = offsetPoint(g, g.angle * frac, offKm / R);
      const [lat, lon] = toLatLon(v);
      const p = projectOntoSection(g, lat, lon);
      expect(p.crossKm).toBeCloseTo(offKm, 6);
      expect(p.alongKm).toBeCloseTo(g.lengthKm * frac, 6);
    }
  });

  it('reports negative along-track distance before A and beyond-length after A′', () => {
    const g = makeSection(0, 10, 0, 20);
    expect(projectOntoSection(g, 0, 5).alongKm).toBeLessThan(0);
    expect(projectOntoSection(g, 0, 25).alongKm).toBeGreaterThan(g.lengthKm);
  });

  it('rejects degenerate sections', () => {
    expect(() => makeSection(10, 10, 10, 10)).toThrow();
    expect(() => makeSection(0, 0, 0, 180)).toThrow();
  });
});
