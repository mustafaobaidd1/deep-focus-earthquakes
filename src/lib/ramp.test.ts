import { describe, expect, it } from 'vitest';
import {
  BASALT,
  contrastRatio,
  depthToT,
  hexToRgb,
  oklchToSrgb,
  rampLch,
  rampRgb,
  rampTexels,
  relativeLuminance,
  toHex,
} from './ramp';

describe('depth colour ramp', () => {
  it('falls monotonically in lightness, so depth order survives greyscale and colour blindness', () => {
    let last = Infinity;
    for (let i = 0; i <= 100; i++) {
      const L = relativeLuminance(rampRgb(i / 100));
      expect(L).toBeLessThan(last);
      last = L;
    }
  });

  it('keeps at least 3:1 contrast against the basalt globe for every depth', () => {
    const bg = hexToRgb(BASALT);
    let min = Infinity;
    for (let i = 0; i <= 100; i++) min = Math.min(min, contrastRatio(rampRgb(i / 100), bg));
    expect(min).toBeGreaterThanOrEqual(3);
  });

  it('runs yellow → orange → magenta → indigo', () => {
    const hue = (t: number) => rampLch(t)[2];
    expect(hue(0)).toBeGreaterThan(85); // yellow
    expect(hue(0.33)).toBeGreaterThan(45); // orange
    expect(((hue(0.66) % 360) + 360) % 360).toBeGreaterThan(330); // magenta
    expect(hue(1)).toBeGreaterThan(270); // indigo / violet
    expect(hue(1)).toBeLessThan(300);
  });

  it('stays inside the sRGB gamut', () => {
    for (let i = 0; i <= 50; i++) {
      for (const c of rampRgb(i / 50)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
    // Out-of-gamut requests are chroma-reduced rather than clipped hue-wise.
    expect(oklchToSrgb([0.7, 0.5, 140]).every((c) => c >= 0 && c <= 1)).toBe(true);
  });

  it('maps depth through a square root, clamped to 0–700 km', () => {
    expect(depthToT(0)).toBe(0);
    expect(depthToT(-5)).toBe(0);
    expect(depthToT(175)).toBeCloseTo(0.5, 12);
    expect(depthToT(700)).toBe(1);
    expect(depthToT(900)).toBe(1);
  });

  it('builds a 256-texel lookup that matches the analytic ramp', () => {
    const tex = rampTexels(256);
    expect(tex.length).toBe(1024);
    const mid = rampRgb(128 / 255).map((v) => Math.round(v * 255));
    expect([tex[512], tex[513], tex[514], tex[515]]).toEqual([...mid, 255]);
    expect(toHex([1, 0.5, 0])).toBe('#ff8000');
  });

  it('computes WCAG contrast correctly for reference colours', () => {
    expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 6);
    expect(contrastRatio(hexToRgb('#777777'), [1, 1, 1])).toBeCloseTo(4.48, 2);
  });
});
