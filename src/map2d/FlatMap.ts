/**
 * Flat-map edition (Equal Earth projection, Pacific-centred) for browsers without WebGL, and for
 * anyone who prefers to see the whole world at once. Same data, filters, picking and section
 * drawing as the globe; rendered with Canvas 2D on two layers (points / overlay).
 */
import {
  geoEqualEarth,
  geoGraticule,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
} from 'd3-geo';
import type { Bounds } from '../lib/filters';
import { EARTH_RADIUS_KM, makeSection, offsetPoint, toLatLon } from '../lib/geo';
import { depthToT, rampRgb, toHex } from '../lib/ramp';
import type { CatalogColumns, LiveData, PolylineColumns } from '../worker/protocol';
import type { EngineCallbacks, MapEngine, PickHit, SectionOverlay } from '../state/engine';

const COLORS = {
  ocean: '#141a22',
  rim: '#3a4656',
  graticule: 'rgba(138,150,166,0.16)',
  coast: 'rgba(201,195,181,0.55)',
  plate: 'rgba(224,145,95,0.45)',
  subduction: 'rgba(240,163,111,0.75)',
  section: '#f6f2e9',
};

const COLOR_STEPS = 48;

function sizeFor(mag: number): number {
  const m = Math.max(0, mag - 5);
  return 2.1 + 1.55 * m + 0.6 * m * m;
}

export class FlatMap implements MapEngine {
  private base: CanvasRenderingContext2D;
  private over: CanvasRenderingContext2D;
  private projection: GeoProjection = geoEqualEarth().rotate([-155, 0]);
  private width = 1;
  private height = 1;
  private dpr = 1;
  private catalog: CatalogColumns | null = null;
  private order: Uint32Array | null = null;
  private screen: Float32Array | null = null;
  private live: LiveData | null = null;
  private liveScreen: Float32Array | null = null;
  private coast: GeoPermissibleObjects | null = null;
  private plates: { boundary: GeoPermissibleObjects; subduction: GeoPermissibleObjects } | null =
    null;
  private showPlates = true;
  private bounds: Bounds | null = null;
  private playDay = -1;
  private playWindow = 365;
  private section: SectionOverlay | null = null;
  private drawMode = false;
  private draft: { a: [number, number]; b: [number, number] | null } | null = null;
  private hovered: PickHit | null = null;
  private selected: PickHit | null = null;
  private sprites = new Map<string, HTMLCanvasElement>();
  private colors: string[] = [];
  private raf = 0;
  private baseDirty = true;
  private resizeObserver: ResizeObserver;
  private down: { x: number; y: number; moved: boolean } | null = null;
  private listeners: [EventTarget, string, EventListener][] = [];
  private insets = { top: 0, bottom: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    private overlay: HTMLCanvasElement,
    private callbacks: EngineCallbacks,
  ) {
    const b = canvas.getContext('2d');
    const o = overlay.getContext('2d');
    if (!b || !o) throw new Error('Canvas 2D is not available');
    this.base = b;
    this.over = o;
    for (let i = 0; i < COLOR_STEPS; i++) this.colors.push(toHex(rampRgb(i / (COLOR_STEPS - 1))));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.bind();
  }

  // ---------------------------------------------------------------- data

  setCatalog(cat: CatalogColumns) {
    this.catalog = cat;
    // Shallow first, so deeper events show as coloured bands behind each trench (as on the globe).
    const idx = Array.from({ length: cat.count }, (_, i) => i).sort(
      (p, q) => cat.depth10[p] - cat.depth10[q] || cat.mag100[p] - cat.mag100[q] || p - q,
    );
    this.order = Uint32Array.from(idx);
    this.projectAll();
    this.invalidate(true);
  }

  setLayers(coast: PolylineColumns, plates: PolylineColumns | null) {
    const toMulti = (set: PolylineColumns, kind: number | null): GeoPermissibleObjects => {
      const lines: [number, number][][] = [];
      for (let i = 0; i + 1 < set.offsets.length; i++) {
        if (kind !== null && set.kinds[i] !== kind) continue;
        const line: [number, number][] = [];
        for (let j = set.offsets[i]; j < set.offsets[i + 1]; j++) {
          line.push([set.coords[j * 2], set.coords[j * 2 + 1]]);
        }
        lines.push(line);
      }
      return { type: 'MultiLineString', coordinates: lines };
    };
    this.coast = toMulti(coast, null);
    this.plates = plates ? { boundary: toMulti(plates, 0), subduction: toMulti(plates, 1) } : null;
    this.invalidate(true);
  }

  setShowPlates(show: boolean) {
    this.showPlates = show;
    this.invalidate(true);
  }

  setFilter(bounds: Bounds) {
    this.bounds = bounds;
    this.invalidate(true);
  }

  setPlayback(day: number | null, windowDays = 365) {
    this.playDay = day ?? -1;
    this.playWindow = windowDays;
    this.invalidate(true);
  }

  setLive(data: LiveData | null) {
    this.live = data;
    this.projectLive();
    this.invalidate(true);
  }

  setSection(section: SectionOverlay | null) {
    this.section = section;
    this.invalidate(false);
  }

  setDrawMode(on: boolean) {
    this.drawMode = on;
    this.canvas.style.cursor = on ? 'crosshair' : '';
    this.overlay.style.cursor = on ? 'crosshair' : '';
    if (!on) this.draft = null;
    this.invalidate(false);
  }

  setHighlight(hit: PickHit | null) {
    this.selected = hit;
    this.invalidate(false);
  }

  projectEvent(hit: PickHit): { x: number; y: number; front: boolean } | null {
    const s = hit.kind === 'catalog' ? this.screen : this.liveScreen;
    if (!s) return null;
    return { x: s[hit.index * 2], y: s[hit.index * 2 + 1], front: true };
  }

  // ---------------------------------------------------------------- geometry

  setInsets(top: number, bottom: number) {
    if (top === this.insets.top && bottom === this.insets.bottom) return;
    this.insets = { top, bottom };
    this.resize();
  }

  private resize() {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = w;
    this.height = h;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
    const pad = Math.max(12, Math.min(w, h) * 0.04);
    this.projection.fitExtent(
      [
        [pad, pad + this.insets.top],
        [w - pad, Math.max(pad + this.insets.top + 50, h - pad - this.insets.bottom)],
      ],
      { type: 'Sphere' },
    );
    this.projectAll();
    this.projectLive();
    this.invalidate(true);
  }

  private projectAll() {
    const cat = this.catalog;
    if (!cat) return;
    const s = new Float32Array(cat.count * 2);
    for (let i = 0; i < cat.count; i++) {
      const p = this.projection([cat.lon[i], cat.lat[i]]);
      s[i * 2] = p ? p[0] : -1e4;
      s[i * 2 + 1] = p ? p[1] : -1e4;
    }
    this.screen = s;
  }

  private projectLive() {
    const l = this.live;
    if (!l) {
      this.liveScreen = null;
      return;
    }
    const s = new Float32Array(l.count * 2);
    for (let i = 0; i < l.count; i++) {
      const p = this.projection([l.lon[i], l.lat[i]]);
      s[i * 2] = p ? p[0] : -1e4;
      s[i * 2 + 1] = p ? p[1] : -1e4;
    }
    this.liveScreen = s;
  }

  /** [lat, lon] under a screen point, or null outside the map outline. */
  private geoAt(x: number, y: number): [number, number] | null {
    const ll = this.projection.invert?.([x, y]);
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
    const back = this.projection(ll);
    if (!back || Math.hypot(back[0] - x, back[1] - y) > 1) return null;
    return [ll[1], ll[0]];
  }

  // ---------------------------------------------------------------- drawing

  private sprite(size: number, colorIndex: number, ring = false): HTMLCanvasElement {
    const q = Math.round(size * 2) / 2;
    const key = `${q}|${colorIndex}|${ring ? 1 : 0}`;
    let s = this.sprites.get(key);
    if (s) return s;
    const px = Math.ceil((q * 2 + 4) * this.dpr);
    s = document.createElement('canvas');
    s.width = px;
    s.height = px;
    const g = s.getContext('2d')!;
    const r = (q / 2) * this.dpr;
    const c = px / 2;
    if (ring) {
      // Live events: a paper-white ring around a dot in the depth colour (as on the globe).
      g.strokeStyle = 'rgba(246, 242, 233, 0.95)';
      g.lineWidth = 1.4 * this.dpr;
      g.beginPath();
      g.arc(c, c, Math.max(r * 1.4, 2.5 * this.dpr), 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = this.colors[colorIndex];
      g.beginPath();
      g.arc(c, c, Math.max(r * 0.55, 1.2 * this.dpr), 0, Math.PI * 2);
      g.fill();
    } else {
      const halo = g.createRadialGradient(c, c, r * 0.8, c, c, r * 2);
      halo.addColorStop(0, `${this.colors[colorIndex]}38`);
      halo.addColorStop(1, `${this.colors[colorIndex]}00`);
      g.fillStyle = halo;
      g.fillRect(0, 0, px, px);
      g.fillStyle = this.colors[colorIndex];
      g.beginPath();
      g.arc(c, c, Math.max(r, 0.8 * this.dpr), 0, Math.PI * 2);
      g.fill();
    }
    this.sprites.set(key, s);
    return s;
  }

  private colorIndex(depthKm: number): number {
    return Math.round(depthToT(depthKm) * (COLOR_STEPS - 1));
  }

  private drawBase() {
    const g = this.base;
    const path = geoPath(this.projection, g);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.width, this.height);
    g.beginPath();
    path({ type: 'Sphere' });
    g.fillStyle = COLORS.ocean;
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = COLORS.rim;
    g.stroke();
    g.beginPath();
    path(geoGraticule().step([30, 30])());
    g.strokeStyle = COLORS.graticule;
    g.lineWidth = 0.6;
    g.stroke();
    if (this.coast) {
      g.beginPath();
      path(this.coast);
      g.strokeStyle = COLORS.coast;
      g.lineWidth = 0.7;
      g.stroke();
    }
    if (this.plates && this.showPlates) {
      g.beginPath();
      path(this.plates.boundary);
      g.strokeStyle = COLORS.plate;
      g.lineWidth = 0.9;
      g.stroke();
      g.beginPath();
      path(this.plates.subduction);
      g.strokeStyle = COLORS.subduction;
      g.lineWidth = 1.2;
      g.stroke();
    }

    const cat = this.catalog;
    const s = this.screen;
    const order = this.order;
    if (cat && s && order) {
      const b = this.bounds;
      g.setTransform(1, 0, 0, 1, 0, 0);
      for (let k = 0; k < order.length; k++) {
        const i = order[k];
        const m = cat.mag100[i];
        const d = cat.depth10[i];
        const day = cat.day[i];
        if (b) {
          if (m < b.mag100[0] || m > b.mag100[1]) continue;
          if (d < b.depth10[0] || d > b.depth10[1]) continue;
          if (day < b.day[0] || day > b.day[1]) continue;
        }
        let size = sizeFor(m / 100);
        let alpha = 0.9;
        if (this.playDay >= 0) {
          if (day > this.playDay) continue;
          const fresh = 1 - Math.min(1, Math.max(0, (this.playDay - day) / this.playWindow));
          alpha = 0.32 + 0.68 * fresh;
          size *= 1 + 0.7 * fresh * fresh;
        }
        const sp = this.sprite(size, this.colorIndex(d / 10));
        g.globalAlpha = alpha;
        const x = s[i * 2] * this.dpr - sp.width / 2;
        const y = s[i * 2 + 1] * this.dpr - sp.height / 2;
        g.drawImage(sp, x, y);
      }
      g.globalAlpha = 1;
    }
    const l = this.live;
    const ls = this.liveScreen;
    if (l && ls) {
      const b = this.bounds;
      g.setTransform(1, 0, 0, 1, 0, 0);
      for (let i = 0; i < l.count; i++) {
        const m100 = l.mag[i] * 100;
        const d10 = l.depthKm[i] * 10;
        if (b && (m100 < b.mag100[0] || m100 > b.mag100[1])) continue;
        if (b && (d10 < b.depth10[0] || d10 > b.depth10[1])) continue;
        const sp = this.sprite(
          Math.max(3, 2 + (l.mag[i] - 2.5) * 1.2),
          this.colorIndex(l.depthKm[i]),
          true,
        );
        g.drawImage(
          sp,
          ls[i * 2] * this.dpr - sp.width / 2,
          ls[i * 2 + 1] * this.dpr - sp.height / 2,
        );
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawOverlay() {
    const g = this.over;
    const path = geoPath(this.projection, g);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.width, this.height);
    const drawSection = (a: [number, number], b: [number, number], halfWidth: number | null) => {
      let geom;
      try {
        geom = makeSection(a[0], a[1], b[0], b[1]);
      } catch {
        return;
      }
      g.lineCap = 'round';
      if (halfWidth) {
        for (const side of [1, -1]) {
          const coords: [number, number][] = [];
          for (let k = 0; k <= 48; k++) {
            const v = offsetPoint(
              geom,
              (geom.angle * k) / 48,
              (side * halfWidth) / EARTH_RADIUS_KM,
            );
            const [la, lo] = toLatLon(v);
            coords.push([lo, la]);
          }
          g.beginPath();
          path({ type: 'LineString', coordinates: coords });
          g.setLineDash([4, 4]);
          g.strokeStyle = 'rgba(246,242,233,0.6)';
          g.lineWidth = 1;
          g.stroke();
          g.setLineDash([]);
        }
      }
      g.beginPath();
      path({
        type: 'LineString',
        coordinates: [
          [a[1], a[0]],
          [b[1], b[0]],
        ],
      });
      g.strokeStyle = 'rgba(14,17,22,0.8)';
      g.lineWidth = 4;
      g.stroke();
      g.strokeStyle = COLORS.section;
      g.lineWidth = 2;
      g.stroke();
      if (halfWidth) {
        g.font = '600 13px "Source Serif 4 Variable", Georgia, serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (const [label, pt] of [
          ['A', a],
          ['A′', b],
        ] as const) {
          const p = this.projection([pt[1], pt[0]]);
          if (!p) continue;
          g.fillStyle = 'rgba(14,17,22,0.85)';
          g.beginPath();
          g.arc(p[0], p[1], 10, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = COLORS.section;
          g.fillText(label, p[0], p[1] + 0.5);
        }
      }
    };
    if (this.section) drawSection(this.section.a, this.section.b, this.section.halfWidthKm);
    if (this.draft?.b) drawSection(this.draft.a, this.draft.b, null);
    for (const [hit, color] of [
      [this.selected, COLORS.section],
      [this.hovered, '#ffffff'],
    ] as const) {
      if (!hit) continue;
      const p = this.projectEvent(hit);
      if (!p) continue;
      const mag = hit.kind === 'catalog' ? (this.catalog?.mag100[hit.index] ?? 500) / 100 : 5;
      g.beginPath();
      g.arc(p.x, p.y, Math.max(8, sizeFor(mag) * 0.9 + 5), 0, Math.PI * 2);
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.stroke();
    }
  }

  private invalidate(base: boolean) {
    if (base) this.baseDirty = true;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.baseDirty) {
        this.drawBase();
        this.baseDirty = false;
      }
      this.drawOverlay();
    });
  }

  // ---------------------------------------------------------------- picking & events

  pick(x: number, y: number, radius = 10): PickHit | null {
    const cat = this.catalog;
    const s = this.screen;
    let best: PickHit | null = null;
    let bestD = Infinity;
    const b = this.bounds;
    if (cat && s) {
      for (let i = 0; i < cat.count; i++) {
        const dx = s[i * 2] - x;
        const dy = s[i * 2 + 1] - y;
        const r = Math.max(radius, sizeFor(cat.mag100[i] / 100) / 2 + 3);
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        if (b) {
          if (cat.mag100[i] < b.mag100[0] || cat.mag100[i] > b.mag100[1]) continue;
          if (cat.depth10[i] < b.depth10[0] || cat.depth10[i] > b.depth10[1]) continue;
          if (cat.day[i] < b.day[0] || cat.day[i] > b.day[1]) continue;
        }
        if (this.playDay >= 0 && cat.day[i] > this.playDay) continue;
        const score = d2 - cat.mag100[i] / 50;
        if (score < bestD) {
          bestD = score;
          best = { kind: 'catalog', index: i, x: s[i * 2], y: s[i * 2 + 1] };
        }
      }
    }
    const l = this.live;
    const ls = this.liveScreen;
    if (l && ls) {
      for (let i = 0; i < l.count; i++) {
        const dx = ls[i * 2] - x;
        const dy = ls[i * 2 + 1] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius) continue;
        if (b && (l.mag[i] * 100 < b.mag100[0] || l.mag[i] * 100 > b.mag100[1])) continue;
        if (b && (l.depthKm[i] * 10 < b.depth10[0] || l.depthKm[i] * 10 > b.depth10[1])) continue;
        if (d2 - l.mag[i] * 2 < bestD) {
          bestD = d2 - l.mag[i] * 2;
          best = { kind: 'live', index: i, x: ls[i * 2], y: ls[i * 2 + 1] };
        }
      }
    }
    return best;
  }

  private on(target: EventTarget, type: string, fn: EventListener) {
    target.addEventListener(type, fn);
    this.listeners.push([target, type, fn]);
  }

  private local(e: PointerEvent) {
    const rect = this.overlay.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private bind() {
    const t = this.overlay;
    this.on(t, 'pointerdown', ((e: PointerEvent) => {
      const p = this.local(e);
      t.setPointerCapture(e.pointerId);
      this.down = { ...p, moved: false };
      if (this.drawMode || e.shiftKey) {
        const ll = this.geoAt(p.x, p.y);
        if (ll) {
          this.draft = { a: ll, b: null };
          this.callbacks.onDrawStateChange(true);
        }
      }
    }) as EventListener);
    this.on(t, 'pointermove', ((e: PointerEvent) => {
      const p = this.local(e);
      if (this.down && Math.hypot(p.x - this.down.x, p.y - this.down.y) > 4) this.down.moved = true;
      if (this.draft) {
        const ll = this.geoAt(p.x, p.y);
        if (ll) {
          this.draft.b = ll;
          this.invalidate(false);
        }
        return;
      }
      if (!this.down && e.pointerType === 'mouse' && !this.drawMode) {
        const hit = this.pick(p.x, p.y);
        const same =
          hit && this.hovered && hit.index === this.hovered.index && hit.kind === this.hovered.kind;
        if (!same) {
          this.hovered = hit;
          this.callbacks.onHover(hit);
          this.invalidate(false);
        }
      }
    }) as EventListener);
    const up = ((e: PointerEvent) => {
      const p = this.local(e);
      const down = this.down;
      this.down = null;
      if (t.hasPointerCapture(e.pointerId)) t.releasePointerCapture(e.pointerId);
      if (this.draft) {
        const d = this.draft;
        this.draft = null;
        this.callbacks.onDrawStateChange(false);
        if (e.type === 'pointerup' && d.b) {
          try {
            if (makeSection(d.a[0], d.a[1], d.b[0], d.b[1]).lengthKm >= 60) {
              this.callbacks.onSectionDrawn(d.a, d.b);
              this.callbacks.onInteract('draw');
            }
          } catch {
            /* ignore degenerate lines */
          }
        }
        this.invalidate(false);
        return;
      }
      if (e.type === 'pointerup' && down && !down.moved) {
        this.callbacks.onSelect(this.pick(p.x, p.y, e.pointerType === 'mouse' ? 10 : 18));
      }
    }) as EventListener;
    this.on(t, 'pointerup', up);
    this.on(t, 'pointercancel', up);
    this.on(t, 'pointerleave', (() => {
      if (!this.down && this.hovered) {
        this.hovered = null;
        this.callbacks.onHover(null);
        this.invalidate(false);
      }
    }) as EventListener);
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
  }
}
