/**
 * Validation runs too slow or too broad for unit tests. Writes src/generated/validation.json,
 * which the README and the in-app "How it works" panel quote.
 *
 *   npm run validate
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { decodeCatalog, decodeDetails } from '../src/lib/codec';
import { defaultFilter } from '../src/lib/filters';
import {
  haversineKm,
  makeSection,
  offsetPoint,
  projectOntoSection,
  toLatLon,
} from '../src/lib/geo';
import { PRESETS } from '../src/lib/presets';
import { fitSlab } from '../src/lib/section';
import { computeSection, computeStats } from '../src/lib/selection';
import {
  bValueMLE,
  frequencyMagnitude,
  mcMaxCurvature,
  mulberry32,
  syntheticGR,
} from '../src/lib/stats';

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
const r = (v: number, d = 3) => Number(v.toFixed(d));

// ---------------------------------------------------------------- b-value on synthetic catalogues
const bValue = [0.8, 1.0, 1.2].map((bTrue) => {
  const est: number[] = [];
  const sig: number[] = [];
  const naive: number[] = [];
  for (let seed = 1; seed <= 200; seed++) {
    const mags = syntheticGR(5000, bTrue, 4.95, seed * 7919 + Math.round(bTrue * 100));
    const e = bValueMLE(mags, 5.0)!;
    est.push(e.b);
    sig.push(e.sigma);
    naive.push(Math.LOG10E / (e.meanMag - 5.0));
  }
  return {
    bTrue,
    n: 5000,
    catalogues: 200,
    meanB: r(mean(est)),
    sdB: r(sd(est), 4),
    maxAbsError: r(Math.max(...est.map((b) => Math.abs(b - bTrue)))),
    withinTolerance: est.filter((b) => Math.abs(b - bTrue) <= 0.05).length,
    meanShiBolt: r(mean(sig), 4),
    shiBoltOverEmpirical: r(mean(sig) / sd(est), 3),
    meanWithoutUtsuCorrection: r(mean(naive)),
  };
});

// ---------------------------------------------------------------- Mc by maximum curvature
const mcRuns: number[] = [];
for (let seed = 1; seed <= 100; seed++) {
  const rnd = mulberry32(seed * 31);
  const raw = syntheticGR(20000, 1.0, 3.95, seed * 13);
  const kept = Array.from(raw).filter((m) => m >= 500 || rnd() < 10 ** (-2 * (5 - m / 100)));
  mcRuns.push(mcMaxCurvature(frequencyMagnitude(new Uint16Array(kept))));
}
const mc = {
  trueMc: 5.0,
  catalogues: 100,
  exact: mcRuns.filter((m) => Math.abs(m - 5) < 1e-9).length,
  within01: mcRuns.filter((m) => Math.abs(m - 5) <= 0.1 + 1e-9).length,
};

// ---------------------------------------------------------------- slab dip on synthetic slabs
function slab(dipDeg: number, n: number, noise: number, seed: number) {
  const rnd = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const t = (dipDeg * Math.PI) / 180;
  const x: number[] = [];
  const z: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = 20 + rnd() * 700;
    const off = gauss() * noise;
    x.push(400 + s * Math.cos(t) - off * Math.sin(t));
    z.push(10 + s * Math.sin(t) + off * Math.cos(t));
  }
  return { x, z };
}
const dip = [20, 35, 45, 60, 75, 85].map((d) => {
  const est: number[] = [];
  const sig: number[] = [];
  for (let seed = 1; seed <= 60; seed++) {
    const { x, z } = slab(d, 400, 15, seed * 101 + d);
    const res = fitSlab(x, z, 70, 200, seed);
    if (res.ok) {
      est.push(res.fit.dipDeg);
      sig.push(res.fit.dipSigma);
    }
  }
  return {
    trueDip: d,
    slabs: 60,
    fitted: est.length,
    meanDip: r(mean(est), 2),
    maxAbsError: r(Math.max(...est.map((v) => Math.abs(v - d))), 2),
    sdDip: r(sd(est), 3),
    meanBootstrapSigma: r(mean(sig), 3),
  };
});

// ---------------------------------------------------------------- geodesy
let maxCross = 0;
let maxAlong = 0;
const rnd = mulberry32(42);
for (let k = 0; k < 2000; k++) {
  const la1 = (rnd() * 2 - 1) * 80;
  const lo1 = (rnd() * 2 - 1) * 180;
  const la2 = (rnd() * 2 - 1) * 80;
  const lo2 = (rnd() * 2 - 1) * 180;
  let g;
  try {
    g = makeSection(la1, lo1, la2, lo2);
  } catch {
    continue;
  }
  if (g.angle > 3) continue;
  const f = rnd();
  const off = (rnd() * 2 - 1) * 500;
  const [lat, lon] = toLatLon(offsetPoint(g, g.angle * f, off / 6371.0088));
  const p = projectOntoSection(g, lat, lon);
  maxCross = Math.max(maxCross, Math.abs(p.crossKm - off));
  maxAlong = Math.max(maxAlong, Math.abs(p.alongKm - g.lengthKm * f));
}
const geodesy = {
  rosetta: {
    expected: 2886.444442837983,
    computed: haversineKm(36.12, -86.67, 33.94, -118.4, 6371.0),
  },
  constructedCases: 2000,
  maxCrossTrackErrorKm: maxCross,
  maxAlongTrackErrorKm: maxAlong,
};

// ---------------------------------------------------------------- the real catalogue
const cat = decodeCatalog(new Uint8Array(gunzipSync(await readFile('public/data/catalog.bin.gz'))));
const details = decodeDetails(
  new TextDecoder().decode(gunzipSync(await readFile('public/data/details.tsv.gz'))),
  cat.count,
);
const log = JSON.parse(await readFile('public/data/fetch-log.json', 'utf8')) as {
  fetchedAt: string;
  total: number;
  years: Record<string, { apiCount: number; rows: number }>;
};
const perYear = new Map<number, number>();
for (let i = 0; i < cat.count; i++) {
  const y = new Date(cat.time[i] * 1000).getUTCFullYear();
  perYear.set(y, (perYear.get(y) ?? 0) + 1);
}
const yearsMatching = Object.entries(log.years).filter(
  ([y, v]) => perYear.get(Number(y)) === v.rows && v.rows === v.apiCount,
).length;

const all = computeStats(cat, defaultFilter());
const deep = computeStats(cat, { ...defaultFilter(), depthMin: 300 });
const recent = computeStats(cat, { ...defaultFilter(), yearMin: 2000 });
const early = computeStats(cat, { ...defaultFilter(), yearMax: 1989 });
const magTypes = new Map<string, number>();
for (let i = 0; i < cat.count; i++) {
  const t = cat.magTypes[cat.magType[i]];
  magTypes.set(t, (magTypes.get(t) ?? 0) + 1);
}
const catalogue = {
  fetchedAt: log.fetchedAt,
  total: cat.count,
  years: Object.keys(log.years).length,
  yearsMatchingCountEndpoint: yearsMatching,
  uniqueIds: new Set(details.ids).size,
  classes: all.classes,
  bAll: all.b && { b: r(all.b.b), sigma: r(all.b.sigma), mc: all.b.mc, n: all.b.n },
  bDeep: deep.b && { b: r(deep.b.b), sigma: r(deep.b.sigma), mc: deep.b.mc, n: deep.b.n },
  b2000on: recent.b && {
    b: r(recent.b.b),
    sigma: r(recent.b.sigma),
    mc: recent.b.mc,
    n: recent.b.n,
  },
  bBefore1990: early.b && {
    b: r(early.b.b),
    sigma: r(early.b.sigma),
    mc: early.b.mc,
    n: early.b.n,
  },
  magTypeShares: Object.fromEntries(
    [...magTypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => [k, r((100 * v) / cat.count, 1)]),
  ),
};

const presets = PRESETS.map((p) => {
  const res = computeSection(cat, defaultFilter(), {
    a: p.a,
    b: p.b,
    halfWidthKm: p.halfWidthKm,
    fitMinDepthKm: 70,
  });
  let maxDepth = 0;
  for (const d of res.depth) maxDepth = Math.max(maxDepth, d);
  return {
    id: p.id,
    name: p.name,
    events: res.index.length,
    lengthKm: r(res.lengthKm, 0),
    maxDepthKm: r(maxDepth, 0),
    dip: res.fit.ok
      ? { deg: r(res.fit.fit.dipDeg, 1), sigma: r(res.fit.fit.dipSigma, 1), n: res.fit.fit.n }
      : { reason: res.fit.reason, candidates: res.fit.candidates },
  };
});

const out = { generatedAt: new Date().toISOString(), bValue, mc, dip, geodesy, catalogue, presets };
await mkdir('src/generated', { recursive: true });
await writeFile('src/generated/validation.json', `${JSON.stringify(out, null, 2)}\n`);

console.log('b-value (n = 5000, 200 synthetic catalogues each):');
for (const v of bValue) {
  console.log(
    `  b=${v.bTrue}: mean ${v.meanB}, sd ${v.sdB}, max |err| ${v.maxAbsError}, within ±0.05: ${v.withinTolerance}/200, Shi-Bolt/empirical ${v.shiBoltOverEmpirical}, no-Utsu mean ${v.meanWithoutUtsuCorrection}`,
  );
}
console.log(`Mc (MAXC): exact ${mc.exact}/100, within 0.1: ${mc.within01}/100`);
console.log('slab dip (400 events, 30 km thick, 60 slabs each):');
for (const d of dip) {
  console.log(
    `  ${d.trueDip}°: mean ${d.meanDip}, max |err| ${d.maxAbsError}, sd ${d.sdDip}, bootstrap σ ${d.meanBootstrapSigma}`,
  );
}
console.log('geodesy:', geodesy);
console.log('catalogue:', JSON.stringify(catalogue));
console.log('presets:');
for (const p of presets) console.log('  ', JSON.stringify(p));
