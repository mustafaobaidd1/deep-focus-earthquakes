/**
 * The depth ramp: yellow → orange → magenta → indigo, built in OKLCH (Ottosson 2020).
 *
 * Lightness falls monotonically from the shallowest to the deepest colour, so the order of
 * depths survives greyscale printing and the common colour-vision deficiencies (the same design
 * rule as matplotlib's viridis family). Every colour keeps at least 3:1 contrast against the
 * basalt globe background so even the deepest points stay visible.
 *
 * Depth maps to ramp position through a square root, t = √(depth / 700 km), which spends more of
 * the ramp on the upper 100 km where four-fifths of all earthquakes occur.
 */

export const BASALT = '#0e1116';
export const MAX_DEPTH_KM = 700;

type Lch = [number, number, number];

/** Stops in OKLCH: [lightness, chroma, hue°]. */
export const RAMP_STOPS: { t: number; lch: Lch }[] = [
  { t: 0, lch: [0.95, 0.18, 104] },
  { t: 0.33, lch: [0.81, 0.17, 62] },
  { t: 0.66, lch: [0.67, 0.24, 356] },
  { t: 1, lch: [0.555, 0.2, 289] },
];

export function srgbGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function srgbLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** OKLab → linear sRGB (Ottosson's published matrices). */
export function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(rgb: [number, number, number]): boolean {
  return rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6);
}

/** OKLCH → gamma-encoded sRGB in [0, 1], reducing chroma until the colour is displayable. */
export function oklchToSrgb([L, C, H]: Lch): [number, number, number] {
  const h = (H * Math.PI) / 180;
  let lin = oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = C;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      const test = oklabToLinear(L, mid * Math.cos(h), mid * Math.sin(h));
      if (inGamut(test)) lo = mid;
      else hi = mid;
    }
    lin = oklabToLinear(L, lo * Math.cos(h), lo * Math.sin(h));
  }
  return lin.map((c) => srgbGamma(Math.min(1, Math.max(0, c)))) as [number, number, number];
}

function lerpLch(a: Lch, b: Lch, f: number): Lch {
  let dh = b[2] - a[2];
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + dh * f];
}

/** Ramp colour at position t ∈ [0, 1] as OKLCH. */
export function rampLch(t: number): Lch {
  const x = Math.min(1, Math.max(0, t));
  for (let k = 1; k < RAMP_STOPS.length; k++) {
    const s0 = RAMP_STOPS[k - 1];
    const s1 = RAMP_STOPS[k];
    if (x <= s1.t) return lerpLch(s0.lch, s1.lch, (x - s0.t) / (s1.t - s0.t));
  }
  return RAMP_STOPS[RAMP_STOPS.length - 1].lch;
}

export function rampRgb(t: number): [number, number, number] {
  return oklchToSrgb(rampLch(t));
}

/** Ramp position for a depth in km (square-root scale, clamped to 0–700 km). */
export function depthToT(depthKm: number): number {
  return Math.sqrt(Math.min(MAX_DEPTH_KM, Math.max(0, depthKm)) / MAX_DEPTH_KM);
}

export function toHex([r, g, b]: [number, number, number]): string {
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function depthColorHex(depthKm: number): string {
  return toHex(rampRgb(depthToT(depthKm)));
}

/** 256 RGBA texels for the GPU lookup (index = round(t × 255)). */
export function rampTexels(size = 256): Uint8Array {
  const out = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const [r, g, b] = rampRgb(i / (size - 1));
    out[i * 4] = Math.round(r * 255);
    out[i * 4 + 1] = Math.round(g * 255);
    out[i * 4 + 2] = Math.round(b * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** CSS linear-gradient stops for legends (left = shallow). */
export function rampGradientCss(direction = 'to right', steps = 12): string {
  const stops: string[] = [];
  for (let i = 0; i <= steps; i++) {
    stops.push(`${toHex(rampRgb(i / steps))} ${((i / steps) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

/** WCAG 2.x relative luminance of a gamma-encoded sRGB colour. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbLinear(r) + 0.7152 * srgbLinear(g) + 0.0722 * srgbLinear(b);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
}
