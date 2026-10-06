import { describe, expect, it } from 'vitest';
import {
  bValueMLE,
  frequencyMagnitude,
  histogram,
  mcMaxCurvature,
  mulberry32,
  syntheticGR,
} from './stats';

describe('b-value maximum likelihood (Aki 1965, Utsu 1965)', () => {
  // Synthetic catalogues: continuous magnitudes from 4.95 (= Mc − ΔM/2), rounded to 0.1, so the
  // lowest bin (5.0) is complete — the situation Utsu's correction is designed for.
  for (const bTrue of [1.0, 0.8]) {
    it(`recovers b = ${bTrue} within ±0.05 from n = 5000 events (several seeds)`, () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const mags = syntheticGR(5000, bTrue, 4.95, seed);
        const est = bValueMLE(mags, 5.0)!;
        expect(est).not.toBeNull();
        expect(est.n).toBe(5000);
        expect(Math.abs(est.b - bTrue)).toBeLessThan(0.05);
      }
    });
  }

  it('shows why the binning correction matters: without it b is biased high by ~0.13', () => {
    const mags = syntheticGR(5000, 1.0, 4.95, 11);
    const est = bValueMLE(mags, 5.0)!;
    const naive = Math.LOG10E / (est.meanMag - 5.0); // Aki without Utsu's −ΔM/2
    expect(naive - est.b).toBeGreaterThan(0.08);
    expect(Math.abs(est.b - 1)).toBeLessThan(0.05);
  });

  it('computes a-value so that the line passes through N(≥Mc)', () => {
    const mags = syntheticGR(5000, 1.0, 4.95, 3);
    const est = bValueMLE(mags, 5.0)!;
    expect(est.a - est.b * 5.0).toBeCloseTo(Math.log10(5000), 10);
  });

  it('only counts events at or above Mc', () => {
    const mags = syntheticGR(5000, 1.0, 4.95, 9);
    const est = bValueMLE(mags, 5.5)!;
    const expected = Array.from(mags).filter((m) => m >= 550).length;
    expect(est.n).toBe(expected);
    expect(Math.abs(est.b - 1)).toBeLessThan(0.1);
  });

  it('refuses tiny or degenerate samples', () => {
    expect(bValueMLE(syntheticGR(20, 1, 4.95, 1), 5.0)).toBeNull();
    expect(bValueMLE(new Uint16Array(100).fill(600), 5.0)).toBeNull(); // no spread
    expect(bValueMLE(new Uint16Array(0), 5.0)).toBeNull();
  });
});

describe('b-value uncertainty (Shi & Bolt 1982)', () => {
  it('matches the closed form 2.30·b²·sqrt(Σ(M−M̄)²/(n(n−1))) on a hand-computable sample', () => {
    // Magnitudes 5.0 ×3, 5.1 ×2, 5.3 ×1 … repeated to clear the minimum sample size.
    const base = [500, 500, 500, 510, 510, 530];
    const mags = new Uint16Array(Array.from({ length: 10 }, () => base).flat());
    const est = bValueMLE(mags, 5.0)!;
    const ms = Array.from(mags, (m) => m / 100);
    const mean = ms.reduce((s, m) => s + m, 0) / ms.length;
    const b = Math.LOG10E / (mean - 4.95);
    const ss = ms.reduce((s, m) => s + (m - mean) ** 2, 0);
    const sigma = Math.LN10 * b * b * Math.sqrt(ss / (ms.length * (ms.length - 1)));
    expect(est.b).toBeCloseTo(b, 12);
    expect(est.sigma).toBeCloseTo(sigma, 12);
  });

  it('agrees with Aki b/√n for large exponential samples (both ≈ 0.014 for n = 5000)', () => {
    const est = bValueMLE(syntheticGR(5000, 1.0, 4.95, 21), 5.0)!;
    expect(est.sigma).toBeGreaterThan(0.012);
    expect(est.sigma).toBeLessThan(0.016);
    expect(Math.abs(est.sigma / est.sigmaAki - 1)).toBeLessThan(0.1);
  });

  it('predicts the scatter of b over repeated synthetic catalogues', () => {
    const estimates: number[] = [];
    const sigmas: number[] = [];
    for (let seed = 100; seed < 400; seed++) {
      const est = bValueMLE(syntheticGR(500, 1.0, 4.95, seed), 5.0)!;
      estimates.push(est.b);
      sigmas.push(est.sigma);
    }
    const mean = estimates.reduce((s, b) => s + b, 0) / estimates.length;
    const sd = Math.sqrt(
      estimates.reduce((s, b) => s + (b - mean) ** 2, 0) / (estimates.length - 1),
    );
    const meanSigma = sigmas.reduce((s, v) => s + v, 0) / sigmas.length;
    expect(Math.abs(mean - 1)).toBeLessThan(0.02);
    expect(Math.abs(sd / meanSigma - 1)).toBeLessThan(0.15);
  });
});

describe('frequency–magnitude distribution and Mc', () => {
  it('bins, counts and accumulates', () => {
    const fmd = frequencyMagnitude(new Uint16Array([500, 504, 506, 510, 520, 520, 700]));
    expect(fmd.mags[0]).toBeCloseTo(5.0, 10);
    expect(fmd.counts.slice(0, 3)).toEqual([2, 2, 2]); // 5.0: 500,504 · 5.1: 506,510 · 5.2
    expect(fmd.cumulative[0]).toBe(7);
    expect(fmd.cumulative[fmd.cumulative.length - 1]).toBe(1);
    expect(fmd.total).toBe(7);
  });

  it('finds Mc by maximum curvature when detection falls off faster than the G–R slope', () => {
    // Complete from 5.0; below it the detection probability is 10^(−2(5.0 − M)), so observed
    // counts decrease below 5.0 and the FMD peaks exactly at the completeness magnitude.
    const rnd = mulberry32(5);
    const raw = syntheticGR(40000, 1.0, 3.95, 5);
    const kept = Array.from(raw).filter((m) => m >= 500 || rnd() < 10 ** (-2 * (5 - m / 100)));
    expect(mcMaxCurvature(frequencyMagnitude(new Uint16Array(kept)))).toBeCloseTo(5.0, 10);
  });

  it('underestimates Mc for a gradual roll-off (the known MAXC bias, Woessner & Wiemer 2005)', () => {
    // Detection probability falls linearly from 1 at 5.0 to 0 at 4.0: the observed peak sits
    // well below the true completeness magnitude.
    const rnd = mulberry32(6);
    const raw = syntheticGR(40000, 1.0, 3.95, 6);
    const kept = Array.from(raw).filter((m) => m >= 500 || rnd() < (m - 400) / 100);
    expect(mcMaxCurvature(frequencyMagnitude(new Uint16Array(kept)))).toBeLessThan(5.0);
  });

  it('returns NaN for an empty selection', () => {
    expect(Number.isNaN(mcMaxCurvature(frequencyMagnitude(new Uint16Array(0))))).toBe(true);
  });
});

describe('histogram', () => {
  it('counts values into regular bins and clamps the ends', () => {
    expect(histogram([0, 5, 10, 19.9, 20, 700, -3], 0, 10, 3)).toEqual([3, 2, 2]);
  });
});
