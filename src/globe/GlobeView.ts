import {
  AddEquation,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  CustomBlending,
  DataTexture,
  DoubleSide,
  Line,
  LineSegments,
  LinearFilter,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PerspectiveCamera,
  Points,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type IUniform,
  type Object3D,
} from 'three';
import type { Bounds } from '../lib/filters';
import {
  makeSection,
  normalize,
  offsetPoint,
  pointAlong,
  toLatLon,
  type SectionGeometry,
} from '../lib/geo';
import { rampTexels } from '../lib/ramp';
import type { EngineCallbacks, MapEngine, PickHit, SectionOverlay } from '../state/engine';
import type { CatalogColumns, LiveData, PolylineColumns } from '../worker/protocol';
import {
  GlobeControls,
  MAX_DISTANCE,
  MIN_DISTANCE,
  cameraPosition,
  viewFor,
  type ViewState,
} from './controls';
import * as S from './shaders';

const EARTH_R_KM = 6371;
const FOV = 34;
/** The opening view: the Pacific, so the whole Ring of Fire is in sight. */
const HOME = { lat: 2, lon: -168 };
const DEG = Math.PI / 180;

/** World position of (lat, lon) at radius r: x towards 0° E, −z towards 90° E, y north. */
export function toWorld(latDeg: number, lonDeg: number, r = 1): [number, number, number] {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const c = Math.cos(la);
  return [r * c * Math.cos(lo), r * Math.sin(la), -r * c * Math.sin(lo)];
}

function fromWorld(x: number, y: number, z: number): [number, number] {
  return [Math.atan2(y, Math.hypot(x, z)) / DEG, Math.atan2(-z, x) / DEG];
}

/** geo.ts uses (x towards 0°E, y towards 90°E, z north); convert its unit vectors to world. */
function geoToWorld(v: [number, number, number], r = 1): [number, number, number] {
  return [v[0] * r, v[2] * r, -v[1] * r];
}

const premultiplied = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneMinusSrcAlphaFactor,
} as const;

function srgb(hex: string): Vector3 {
  const v = hex.replace('#', '');
  return new Vector3(
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  );
}

export const PALETTE = {
  earth: '#141a22',
  rim: '#3a4656',
  halo: '#5b6f86',
  coast: '#c9c3b5',
  plate: '#e0915f',
  subduction: '#f0a36f',
  graticule: '#8a96a6',
  section: '#f6f2e9',
  shell: '#9aa9bb',
  marker: '#ffffff',
};

export class GlobeView implements MapEngine {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.01, 50);
  readonly controls: GlobeControls;
  private ramp: DataTexture;
  private shared: Record<string, IUniform>;

  private earth: Mesh;
  private halo: Mesh;
  private shell: Mesh;
  private graticule: LineSegments;
  private coast: LineSegments | null = null;
  private plates: LineSegments[] = [];
  private points: Points | null = null;
  private live: Points | null = null;
  private sectionGroup: Object3D[] = [];
  private draftLine: Line | null = null;
  private hoverMarker: Points;
  private selectMarker: Points;

  private catalog: CatalogColumns | null = null;
  private dirs: Float32Array | null = null;
  private liveData: LiveData | null = null;
  private liveDirs: Float32Array | null = null;
  private bounds: Bounds | null = null;
  private playDay = -1;

  private depthMix = 0;
  private depthFrom = 0;
  private depthTarget = 0;
  private depthStart = -1;
  private exaggeration = 4;
  private reducedMotion: boolean;
  private section: SectionOverlay | null = null;
  private sectionGeom: SectionGeometry | null = null;
  private drawMode = false;
  private draft: { a: [number, number]; b: [number, number] | null } | null = null;
  private hovered: PickHit | null = null;
  private selected: PickHit | null = null;

  private raf = 0;
  private width = 1;
  private height = 1;
  private disposed = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; t: number; moved: boolean } | null = null;
  private pinchDist = 0;
  private hoverQueued: { x: number; y: number } | null = null;
  private labels: { a: HTMLElement; b: HTMLElement } | null = null;
  private resizeObserver: ResizeObserver;
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
  private startTime = performance.now();
  /** Until the reader zooms, the camera distance follows the viewport so the globe always fits. */
  private autoFit = true;
  /** CSS pixels covered by overlays at the top and bottom of the canvas. */
  private insets = { top: 0, bottom: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    private callbacks: EngineCallbacks,
    options: { reducedMotion: boolean; initialView?: ViewState },
  ) {
    this.reducedMotion = options.reducedMotion;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.controls = new GlobeControls(options.initialView ?? viewFor(HOME.lat, HOME.lon, 4.4));
    this.autoFit = !options.initialView;

    const texels = rampTexels(256);
    this.ramp = new DataTexture(texels, 256, 1, RGBAFormat);
    this.ramp.magFilter = LinearFilter;
    this.ramp.minFilter = LinearFilter;
    this.ramp.wrapS = ClampToEdgeWrapping;
    this.ramp.wrapT = ClampToEdgeWrapping;
    this.ramp.needsUpdate = true;

    this.shared = {
      uDepthMix: { value: 0 },
      uExag: { value: this.exaggeration },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uSizeScale: { value: 1 },
      uRamp: { value: this.ramp },
    };

    // Halo, Earth, 660 km shell.
    const sphere = new SphereGeometry(1, 128, 96);
    this.halo = new Mesh(
      new SphereGeometry(1.045, 96, 64),
      new ShaderMaterial({
        vertexShader: S.earthVertex,
        fragmentShader: S.haloFragment,
        uniforms: { uColor: { value: srgb(PALETTE.halo) }, uStrength: { value: 0.22 } },
        side: BackSide,
        ...premultiplied,
      }),
    );
    this.halo.renderOrder = 0;
    this.earth = new Mesh(
      sphere,
      new ShaderMaterial({
        vertexShader: S.earthVertex,
        fragmentShader: S.earthFragment,
        uniforms: {
          uBase: { value: srgb(PALETTE.earth) },
          uRim: { value: srgb(PALETTE.rim) },
          uOpacity: { value: 1 },
        },
        ...premultiplied,
      }),
    );
    this.earth.renderOrder = 1;
    this.shell = new Mesh(
      sphere,
      new ShaderMaterial({
        vertexShader: S.earthVertex,
        fragmentShader: S.shellFragment,
        uniforms: { uColor: { value: srgb(PALETTE.shell) }, uOpacity: { value: 0 } },
        ...premultiplied,
      }),
    );
    this.shell.renderOrder = 2;
    this.shell.visible = false;
    this.graticule = this.lineLayer(this.graticuleGeometry(), PALETTE.graticule, 0.12, 0.04);
    this.graticule.renderOrder = 3;
    this.scene.add(this.halo, this.earth, this.shell, this.graticule);

    this.hoverMarker = this.markerLayer(PALETTE.marker);
    this.selectMarker = this.markerLayer(PALETTE.section);
    this.scene.add(this.hoverMarker, this.selectMarker);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.bindEvents();
    this.requestFrame();
  }

  // ---------------------------------------------------------------- layers

  private lineMaterial(color: string, opacity: number, farAlpha: number): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: S.lineVertex,
      fragmentShader: S.lineFragment,
      uniforms: {
        uDepthMix: this.shared.uDepthMix,
        uFarAlpha: { value: farAlpha },
        uColor: { value: srgb(color) },
        uOpacity: { value: opacity },
      },
      ...premultiplied,
    });
  }

  private lineLayer(
    geometry: BufferGeometry,
    color: string,
    opacity: number,
    farAlpha: number,
  ): LineSegments {
    return new LineSegments(geometry, this.lineMaterial(color, opacity, farAlpha));
  }

  private markerLayer(color: string): Points {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    const p = new Points(
      g,
      new ShaderMaterial({
        vertexShader: S.markerVertex,
        fragmentShader: S.markerFragment,
        uniforms: {
          uSize: { value: 24 },
          uPixelRatio: this.shared.uPixelRatio,
          uDepthMix: this.shared.uDepthMix,
          uColor: { value: srgb(color) },
        },
        ...premultiplied,
      }),
    );
    p.renderOrder = 20;
    p.visible = false;
    p.frustumCulled = false;
    return p;
  }

  private graticuleGeometry(): BufferGeometry {
    const verts: number[] = [];
    const r = 1.0004;
    const push = (a: [number, number], b: [number, number]) =>
      verts.push(...toWorld(a[0], a[1], r), ...toWorld(b[0], b[1], r));
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = -180; lon < 180; lon += 3) push([lat, lon], [lat, lon + 3]);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -84; lat < 84; lat += 3) push([lat, lon], [lat + 3, lon]);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    return g;
  }

  private polylineGeometry(set: PolylineColumns, kind: number | null, r: number): BufferGeometry {
    const verts: number[] = [];
    for (let i = 0; i + 1 < set.offsets.length; i++) {
      if (kind !== null && set.kinds[i] !== kind) continue;
      const s = set.offsets[i];
      const e = set.offsets[i + 1];
      for (let j = s; j + 1 < e; j++) {
        const lon0 = set.coords[j * 2];
        const lat0 = set.coords[j * 2 + 1];
        const lon1 = set.coords[j * 2 + 2];
        const lat1 = set.coords[j * 2 + 3];
        verts.push(...toWorld(lat0, lon0, r), ...toWorld(lat1, lon1, r));
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    return g;
  }

  setLayers(coast: PolylineColumns, plates: PolylineColumns | null) {
    if (this.coast) this.scene.remove(this.coast);
    this.coast = this.lineLayer(
      this.polylineGeometry(coast, null, 1.0006),
      PALETTE.coast,
      0.42,
      0.08,
    );
    this.coast.renderOrder = 9;
    this.scene.add(this.coast);
    for (const p of this.plates) this.scene.remove(p);
    this.plates = [];
    if (plates) {
      const boundary = this.lineLayer(
        this.polylineGeometry(plates, 0, 1.0008),
        PALETTE.plate,
        0.38,
        0.06,
      );
      const subduction = this.lineLayer(
        this.polylineGeometry(plates, 1, 1.0008),
        PALETTE.subduction,
        0.62,
        0.1,
      );
      boundary.renderOrder = 10;
      subduction.renderOrder = 10;
      this.plates = [boundary, subduction];
      this.scene.add(boundary, subduction);
    }
    this.requestFrame();
  }

  setShowPlates(show: boolean) {
    for (const p of this.plates) p.visible = show;
    this.requestFrame();
  }

  setCatalog(cat: CatalogColumns) {
    this.catalog = cat;
    const n = cat.count;
    // Draw shallow events first, so the deeper ones (orange to indigo) show through on the
    // surface map as bands behind each trench — slabs seen from above.
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (p, q) => cat.depth10[p] - cat.depth10[q] || cat.mag100[p] - cat.mag100[q] || p - q,
    );
    const dirs = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const w = toWorld(cat.lat[i], cat.lon[i]);
      dirs[i * 3] = w[0];
      dirs[i * 3 + 1] = w[1];
      dirs[i * 3 + 2] = w[2];
    }
    this.dirs = dirs;
    const aDir = new Float32Array(n * 3);
    const aDepth = new Float32Array(n);
    const aMag = new Float32Array(n);
    const aDay = new Float32Array(n);
    order.forEach((src, k) => {
      aDir[k * 3] = dirs[src * 3];
      aDir[k * 3 + 1] = dirs[src * 3 + 1];
      aDir[k * 3 + 2] = dirs[src * 3 + 2];
      aDepth[k] = cat.depth10[src];
      aMag[k] = cat.mag100[src];
      aDay[k] = cat.day[src];
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(aDir, 3)); // unused by the shader; bounds only
    g.setAttribute('aDir', new BufferAttribute(aDir, 3));
    g.setAttribute('aDepth', new BufferAttribute(aDepth, 1));
    g.setAttribute('aMag', new BufferAttribute(aMag, 1));
    g.setAttribute('aDay', new BufferAttribute(aDay, 1));
    const mat = new ShaderMaterial({
      vertexShader: S.pointsVertex,
      fragmentShader: S.pointsFragment,
      uniforms: {
        ...this.shared,
        uMagRange: { value: new Vector2(-1e9, 1e9) },
        uDepthRange: { value: new Vector2(-1e9, 1e9) },
        uDayRange: { value: new Vector2(-1e9, 1e9) },
        uPlayDay: { value: -1 },
        uPlayWindow: { value: 365 },
        uDim: { value: 1 },
      },
      ...premultiplied,
    });
    if (this.points) this.scene.remove(this.points);
    this.points = new Points(g, mat);
    this.points.renderOrder = 6;
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    if (this.bounds) this.setFilter(this.bounds);
    this.requestFrame();
  }

  setFilter(bounds: Bounds) {
    this.bounds = bounds;
    const apply = (p: Points | null) => {
      if (!p) return;
      const u = (p.material as ShaderMaterial).uniforms;
      u.uMagRange.value.set(bounds.mag100[0], bounds.mag100[1]);
      u.uDepthRange.value.set(bounds.depth10[0], bounds.depth10[1]);
      if (u.uDayRange) u.uDayRange.value.set(bounds.day[0], bounds.day[1]);
    };
    apply(this.points);
    apply(this.live);
    this.requestFrame();
  }

  /** Playback: show events up to `day` (day number), emphasising the last `windowDays`. */
  setPlayback(day: number | null, windowDays = 365) {
    this.playDay = day ?? -1;
    if (this.points) {
      const u = (this.points.material as ShaderMaterial).uniforms;
      u.uPlayDay.value = this.playDay;
      u.uPlayWindow.value = windowDays;
    }
    this.requestFrame();
  }

  setLive(data: LiveData | null) {
    this.liveData = data;
    if (this.live) {
      this.scene.remove(this.live);
      this.live.geometry.dispose();
      this.live = null;
    }
    if (!data || data.count === 0) {
      this.liveDirs = null;
      this.requestFrame();
      return;
    }
    const n = data.count;
    const dirs = new Float32Array(n * 3);
    const aDepth = new Float32Array(n);
    const aMag = new Float32Array(n);
    const aAge = new Float32Array(n);
    const now = Date.now() / 1000;
    for (let i = 0; i < n; i++) {
      const w = toWorld(data.lat[i], data.lon[i]);
      dirs.set(w, i * 3);
      aDepth[i] = data.depthKm[i];
      aMag[i] = data.mag[i];
      aAge[i] = Math.max(0, (now - data.time[i]) / 3600);
    }
    this.liveDirs = dirs;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(dirs, 3));
    g.setAttribute('aDir', new BufferAttribute(dirs, 3));
    g.setAttribute('aDepth', new BufferAttribute(aDepth, 1));
    g.setAttribute('aMag', new BufferAttribute(aMag, 1));
    g.setAttribute('aAgeH', new BufferAttribute(aAge, 1));
    const mat = new ShaderMaterial({
      vertexShader: S.liveVertex,
      fragmentShader: S.liveFragment,
      uniforms: {
        ...this.shared,
        uMagRange: { value: new Vector2(-1e9, 1e9) },
        uDepthRange: { value: new Vector2(-1e9, 1e9) },
        uTime: { value: 0 },
        uMotion: { value: this.reducedMotion ? 0 : 1 },
      },
      ...premultiplied,
    });
    this.live = new Points(g, mat);
    this.live.renderOrder = 7;
    this.live.frustumCulled = false;
    this.scene.add(this.live);
    if (this.bounds) this.setFilter(this.bounds);
    this.requestFrame();
  }

  // ---------------------------------------------------------------- modes

  setDepthMode(on: boolean, animate = true) {
    const was = this.depthTarget;
    this.depthTarget = on ? 1 : 0;
    // Turning depth on while looking at the active section: swing round to see it edge-on.
    if (on && was < 0.5 && this.sectionGeom) {
      const m = pointAlong(this.sectionGeom, 0.5);
      const c = this.camera.position;
      const cam = normalize([c.x, -c.z, c.y]);
      if (m[0] * cam[0] + m[1] * cam[1] + m[2] * cam[2] > 0.45) this.flyToSection();
    }
    if (!animate || this.reducedMotion) {
      this.depthMix = this.depthTarget;
      this.depthStart = -1;
    } else {
      this.depthFrom = this.depthMix;
      this.depthStart = -2; // set on next frame
    }
    this.requestFrame();
  }

  setExaggeration(x: number) {
    this.exaggeration = x;
    this.shared.uExag.value = x;
    this.rebuildSection();
    this.requestFrame();
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on && !this.reducedMotion;
    this.controls.resetClock();
    this.requestFrame();
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    if (this.live) (this.live.material as ShaderMaterial).uniforms.uMotion.value = reduced ? 0 : 1;
    if (reduced) this.controls.autoRotate = false;
    this.requestFrame();
  }

  setDrawMode(on: boolean) {
    this.drawMode = on;
    this.canvas.style.cursor = on ? 'crosshair' : '';
    if (!on) this.clearDraft();
    this.requestFrame();
  }

  setLabelElements(a: HTMLElement, b: HTMLElement) {
    this.labels = { a, b };
    this.requestFrame();
  }

  // ---------------------------------------------------------------- section overlay

  setSection(section: SectionOverlay | null, fly = false) {
    this.section = section;
    this.sectionGeom = section
      ? makeSection(section.a[0], section.a[1], section.b[0], section.b[1])
      : null;
    this.rebuildSection();
    if (section && fly) this.flyToSection();
    this.requestFrame();
  }

  flyToSection() {
    const g = this.sectionGeom;
    if (!g) return;
    const m = pointAlong(g, 0.5);
    if (this.depthTarget > 0.5) {
      // True-depth mode: turn the globe so the section stands on its rim. Looking (nearly) along
      // the normal of the section's great-circle plane puts that plane edge-on to the camera,
      // so the slab beneath the line is seen in profile, as in the section chart.
      const beta = 28 * DEG;
      const c = this.camera.position;
      const cam = normalize([c.x, -c.z, c.y]);
      const [p, q] = [1, -1].map((s) =>
        normalize([
          g.n[0] * s * Math.cos(beta) + m[0] * Math.sin(beta),
          g.n[1] * s * Math.cos(beta) + m[1] * Math.sin(beta),
          g.n[2] * s * Math.cos(beta) + m[2] * Math.sin(beta),
        ]),
      );
      // Prefer the lower-latitude viewpoint (a polar view feels disorienting); when both are
      // similar, take the shorter turn from where the camera is now.
      const latDiff = Math.abs(Math.asin(p[2])) - Math.abs(Math.asin(q[2]));
      const closer = (a: number[], b: number[]) =>
        a[0] * cam[0] + a[1] * cam[1] + a[2] * cam[2] >=
        b[0] * cam[0] + b[1] * cam[1] + b[2] * cam[2];
      const best = Math.abs(latDiff) > 10 * DEG ? (latDiff < 0 ? p : q) : closer(p, q) ? p : q;
      const [lat, lon] = toLatLon(best);
      this.flyTo(lat, lon, Math.max(3.6, this.fitDistance()));
      return;
    }
    const [lat, lon] = toLatLon(m);
    // Frame the section from above: longer sections need a more distant camera.
    const dist = Math.min(MAX_DISTANCE, Math.max(2.1, 1.7 + (g.angle / DEG) * 0.075));
    this.flyTo(lat, lon, dist);
  }

  flyTo(lat: number, lon: number, distance = this.controls.view.distance) {
    this.autoFit = false;
    // Look a little from the south-east of the target so depth mode shows the slab in profile.
    this.controls.flyTo(viewFor(lat, lon, distance), this.reducedMotion ? 0 : 1500);
    this.requestFrame();
  }

  /** Camera distance at which the globe fills ~80 % of the narrower viewport dimension. */
  fitDistance(): number {
    const halfV = (FOV / 2) * DEG;
    const usable = Math.max(
      0.35,
      (this.height - this.insets.top - this.insets.bottom) / this.height,
    );
    const halfVUsable = Math.atan(Math.tan(halfV) * usable);
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    const half = Math.min(halfVUsable, halfH);
    // Height-limited views can fill more; width-limited ones keep a side margin for the limb glow.
    const fill = halfVUsable < halfH ? 0.92 : 0.86;
    return Math.min(MAX_DISTANCE, Math.max(2.2, 1 / Math.sin(half * fill)));
  }

  /** Keeps the globe centred in the area left free by overlays (masthead, toolbars). */
  setInsets(top: number, bottom: number) {
    if (top === this.insets.top && bottom === this.insets.bottom) return;
    this.insets = { top, bottom };
    this.applyViewOffset();
    if (this.autoFit && !this.controls.flying) {
      this.controls.view = { ...this.controls.view, distance: this.fitDistance() };
    }
    this.requestFrame();
  }

  private applyViewOffset() {
    const dy = (this.insets.top - this.insets.bottom) / 2;
    if (Math.abs(dy) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(this.width, this.height, 0, -dy, this.width, this.height);
    this.camera.updateProjectionMatrix();
  }

  resetView() {
    this.autoFit = true;
    this.controls.flyTo(
      viewFor(HOME.lat, HOME.lon, this.fitDistance()),
      this.reducedMotion ? 0 : 1200,
    );
    this.requestFrame();
  }

  private disposeObject(o: Object3D) {
    this.scene.remove(o);
    const m = o as Mesh;
    m.geometry?.dispose();
    (m.material as ShaderMaterial | undefined)?.dispose();
  }

  private rebuildSection() {
    for (const o of this.sectionGroup) this.disposeObject(o);
    this.sectionGroup = [];
    const s = this.section;
    const g = this.sectionGeom;
    if (!s || !g) return;
    const N = 128;
    const arc = (crossKm: number, r: number): number[] => {
      const out: number[] = [];
      for (let k = 0; k <= N; k++) {
        const v = offsetPoint(g, (g.angle * k) / N, crossKm / EARTH_R_KM);
        out.push(...geoToWorld(v, r));
      }
      return out;
    };
    const lineFrom = (pts: number[], color: string, opacity: number, dashed: boolean) => {
      const verts: number[] = [];
      for (let k = 0; k < pts.length / 3 - 1; k++) {
        if (dashed && k % 2 === 1) continue;
        verts.push(...pts.slice(k * 3, k * 3 + 6));
      }
      const geom = new BufferGeometry();
      geom.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
      const l = new LineSegments(geom, this.lineMaterial(color, opacity, 0.2));
      l.renderOrder = 12;
      return l;
    };
    // Centre line (drawn twice, slightly offset, for a bolder stroke on high-DPI screens).
    const centre = lineFrom(arc(0, 1.0025), PALETTE.section, 1, false);
    const centre2 = lineFrom(arc(0.6, 1.0025), PALETTE.section, 0.7, false);
    const left = lineFrom(arc(s.halfWidthKm, 1.0022), PALETTE.section, 0.55, true);
    const right = lineFrom(arc(-s.halfWidthKm, 1.0022), PALETTE.section, 0.55, true);
    // End ticks across the corridor at A and A′.
    const tick = (along: number) => {
      const pts: number[] = [];
      for (let k = 0; k <= 16; k++) {
        const c = -s.halfWidthKm + (2 * s.halfWidthKm * k) / 16;
        pts.push(...geoToWorld(offsetPoint(g, along, c / EARTH_R_KM), 1.0024));
      }
      return lineFrom(pts, PALETTE.section, 0.9, false);
    };
    // The curtain below the line, seen in depth mode.
    const wallPos: number[] = [];
    const wallT: number[] = [];
    const index: number[] = [];
    for (let k = 0; k <= N; k++) {
      const w = geoToWorld(pointAlong(g, k / N));
      wallPos.push(...w, ...w);
      wallT.push(0, 1);
      if (k < N) {
        const i = k * 2;
        index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
    const wg = new BufferGeometry();
    wg.setAttribute('position', new BufferAttribute(new Float32Array(wallPos), 3));
    wg.setAttribute('aT', new BufferAttribute(new Float32Array(wallT), 1));
    wg.setIndex(index);
    const wall = new Mesh(
      wg,
      new ShaderMaterial({
        vertexShader: S.wallVertex,
        fragmentShader: S.wallFragment,
        uniforms: {
          uDepthMix: this.shared.uDepthMix,
          uExag: this.shared.uExag,
          uColor: { value: srgb(PALETTE.section) },
          uOpacity: { value: 0.1 },
        },
        side: DoubleSide,
        ...premultiplied,
      }),
    );
    wall.renderOrder = 5;
    wall.frustumCulled = false;
    this.sectionGroup = [wall, centre, centre2, left, right, tick(0), tick(g.angle)];
    for (const o of this.sectionGroup) {
      o.frustumCulled = false;
      this.scene.add(o);
    }
  }

  private clearDraft() {
    if (this.draftLine) this.disposeObject(this.draftLine);
    this.draftLine = null;
    this.draft = null;
  }

  private updateDraftLine() {
    if (this.draftLine) this.disposeObject(this.draftLine);
    this.draftLine = null;
    const d = this.draft;
    if (!d || !d.b) return;
    let g: SectionGeometry;
    try {
      g = makeSection(d.a[0], d.a[1], d.b[0], d.b[1]);
    } catch {
      return;
    }
    const pts: number[] = [];
    for (let k = 0; k <= 64; k++) pts.push(...geoToWorld(pointAlong(g, k / 64), 1.003));
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    this.draftLine = new Line(geom, this.lineMaterial(PALETTE.section, 1, 0.3));
    this.draftLine.renderOrder = 13;
    this.draftLine.frustumCulled = false;
    this.scene.add(this.draftLine);
  }

  // ---------------------------------------------------------------- markers

  private worldOfEvent(hit: PickHit, mix = this.depthMix): [number, number, number] | null {
    if (hit.kind === 'catalog') {
      if (!this.catalog || !this.dirs) return null;
      const depth = Math.max(0, this.catalog.depth10[hit.index] / 10);
      const r = 1 + 0.0015 * (1 - mix) - (mix * this.exaggeration * depth) / EARTH_R_KM;
      const i = hit.index * 3;
      return [this.dirs[i] * r, this.dirs[i + 1] * r, this.dirs[i + 2] * r];
    }
    if (!this.liveData || !this.liveDirs) return null;
    const depth = Math.max(0, this.liveData.depthKm[hit.index]);
    const r = 1 + 0.0025 * (1 - mix) - (mix * this.exaggeration * depth) / EARTH_R_KM;
    const i = hit.index * 3;
    return [this.liveDirs[i] * r, this.liveDirs[i + 1] * r, this.liveDirs[i + 2] * r];
  }

  private magOf(hit: PickHit): number {
    if (hit.kind === 'catalog') return (this.catalog?.mag100[hit.index] ?? 500) / 100;
    return this.liveData?.mag[hit.index] ?? 3;
  }

  private placeMarker(marker: Points, hit: PickHit | null) {
    if (!hit) {
      marker.visible = false;
      return;
    }
    const w = this.worldOfEvent(hit);
    if (!w) {
      marker.visible = false;
      return;
    }
    (marker.geometry.getAttribute('position') as BufferAttribute).set(w);
    marker.geometry.getAttribute('position').needsUpdate = true;
    const m = Math.max(0, this.magOf(hit) - 5);
    const core = (2.1 + 1.55 * m + 0.6 * m * m) * (this.shared.uSizeScale.value as number);
    (marker.material as ShaderMaterial).uniforms.uSize.value = Math.min(
      56,
      Math.max(18, core * 1.6 + 12),
    );
    marker.visible = true;
  }

  setHighlight(hit: PickHit | null) {
    this.selected = hit;
    this.requestFrame();
  }

  // ---------------------------------------------------------------- projection & picking

  private viewProj = new Matrix4();
  private tmp = new Vector4();

  /** Projects a world point to CSS pixels; `front` is false when hidden behind the globe. */
  projectWorld(w: [number, number, number]): { x: number; y: number; front: boolean } {
    this.tmp.set(w[0], w[1], w[2], 1).applyMatrix4(this.viewProj);
    const x = ((this.tmp.x / this.tmp.w) * 0.5 + 0.5) * this.width;
    const y = ((-this.tmp.y / this.tmp.w) * 0.5 + 0.5) * this.height;
    const c = this.camera.position;
    const front =
      w[0] * c.x + w[1] * c.y + w[2] * c.z - (w[0] ** 2 + w[1] ** 2 + w[2] ** 2) > -0.01;
    return { x, y, front };
  }

  projectEvent(hit: PickHit): { x: number; y: number; front: boolean } | null {
    const w = this.worldOfEvent(hit);
    if (!w) return null;
    const p = this.projectWorld(w);
    return { ...p, front: this.depthMix > 0.5 || p.front };
  }

  pick(x: number, y: number, radius = 12): PickHit | null {
    const cat = this.catalog;
    const dirs = this.dirs;
    if (!cat || !dirs || this.depthStart !== -1) return null;
    const m = this.viewProj.elements;
    const c = this.camera.position;
    const mix = this.depthMix;
    const ex = this.exaggeration;
    const b = this.bounds;
    let best = -1;
    let bestScore = Infinity;
    let bestKind: 'catalog' | 'live' = 'catalog';
    const sizeScale = this.shared.uSizeScale.value as number;
    const consider = (
      kind: 'catalog' | 'live',
      i: number,
      dx: number,
      dy: number,
      dz: number,
      depthKm: number,
      mag: number,
      lift: number,
    ) => {
      const r = 1 + lift * (1 - mix) - (mix * ex * Math.max(0, depthKm)) / EARTH_R_KM;
      const px = dx * r;
      const py = dy * r;
      const pz = dz * r;
      if (mix < 0.5 && px * c.x + py * c.y + pz * c.z - r * r < 0) return;
      const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
      if (w <= 0) return;
      const sx = (((m[0] * px + m[4] * py + m[8] * pz + m[12]) / w) * 0.5 + 0.5) * this.width;
      const sy = ((-(m[1] * px + m[5] * py + m[9] * pz + m[13]) / w) * 0.5 + 0.5) * this.height;
      const d2 = (sx - x) ** 2 + (sy - y) ** 2;
      const mm = Math.max(0, mag - 5);
      const rad = Math.max(radius, (2.1 + 1.55 * mm + 0.6 * mm * mm) * sizeScale * 0.5 + 4);
      if (d2 > rad * rad) return;
      // Prefer the nearest on screen, then larger magnitudes, then nearer to the camera.
      const score = d2 - mag * 2 + w * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = i;
        bestKind = kind;
      }
    };
    for (let i = 0; i < cat.count; i++) {
      const mag100 = cat.mag100[i];
      const d10 = cat.depth10[i];
      const day = cat.day[i];
      if (b) {
        if (mag100 < b.mag100[0] || mag100 > b.mag100[1]) continue;
        if (d10 < b.depth10[0] || d10 > b.depth10[1]) continue;
        if (day < b.day[0] || day > b.day[1]) continue;
      }
      if (this.playDay >= 0 && day > this.playDay) continue;
      consider(
        'catalog',
        i,
        dirs[i * 3],
        dirs[i * 3 + 1],
        dirs[i * 3 + 2],
        d10 / 10,
        mag100 / 100,
        0.0015,
      );
    }
    const live = this.liveData;
    const ld = this.liveDirs;
    if (live && ld && this.live?.visible !== false) {
      for (let i = 0; i < live.count; i++) {
        const mag100 = live.mag[i] * 100;
        const d10 = live.depthKm[i] * 10;
        if (b && (mag100 < b.mag100[0] || mag100 > b.mag100[1])) continue;
        if (b && (d10 < b.depth10[0] || d10 > b.depth10[1])) continue;
        consider(
          'live',
          i,
          ld[i * 3],
          ld[i * 3 + 1],
          ld[i * 3 + 2],
          live.depthKm[i],
          live.mag[i],
          0.0025,
        );
      }
    }
    if (best < 0) return null;
    const hit: PickHit = { kind: bestKind, index: best, x: 0, y: 0 };
    const p = this.projectEvent(hit);
    if (p) {
      hit.x = p.x;
      hit.y = p.y;
    }
    return hit;
  }

  /** Where a screen point hits the globe surface, as [lat, lon]; null when it misses. */
  surfaceAt(x: number, y: number): [number, number] | null {
    const ndc = new Vector3((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const o = this.camera.position;
    const d = ndc.sub(o).normalize();
    const b = o.dot(d);
    const cc = o.lengthSq() - 1;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    return fromWorld(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
  }

  // ---------------------------------------------------------------- events

  private on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn, opts);
    this.listeners.push([target, type, fn, opts]);
  }

  private local(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private bindEvents() {
    const c = this.canvas;
    this.on(c, 'pointerdown', ((e: PointerEvent) => this.onPointerDown(e)) as EventListener);
    this.on(c, 'pointermove', ((e: PointerEvent) => this.onPointerMove(e)) as EventListener);
    this.on(c, 'pointerup', ((e: PointerEvent) => this.onPointerUp(e)) as EventListener);
    this.on(c, 'pointercancel', ((e: PointerEvent) => this.onPointerUp(e, true)) as EventListener);
    this.on(c, 'pointerleave', (() => {
      if (this.pointers.size === 0 && this.hovered) {
        this.hovered = null;
        this.callbacks.onHover(null);
        this.requestFrame();
      }
    }) as EventListener);
    this.on(c, 'wheel', ((e: WheelEvent) => this.onWheel(e)) as EventListener, { passive: false });
    this.on(c, 'keydown', ((e: KeyboardEvent) => this.onKey(e)) as EventListener);
    this.on(document, 'visibilitychange', (() => {
      if (document.visibilityState === 'visible') {
        this.controls.resetClock();
        this.requestFrame();
      } else if (this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      }
    }) as EventListener);
    this.on(c, 'webglcontextlost', ((e: Event) => e.preventDefault()) as EventListener);
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.controls.stopInertia();
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.clearDraft();
      this.down = null;
      return;
    }
    this.down = { x: p.x, y: p.y, t: performance.now(), moved: false };
    if (this.drawMode || e.shiftKey) {
      const ll = this.surfaceAt(p.x, p.y);
      if (ll) {
        this.draft = { a: ll, b: null };
        this.callbacks.onDrawStateChange(true);
      }
    }
  }

  private onPointerMove(e: PointerEvent) {
    const p = this.local(e);
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      // Plain hover.
      if (e.pointerType === 'mouse') this.queueHover(p.x, p.y);
      return;
    }
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0 && d > 0) {
        this.controls.zoomBy(this.pinchDist / d);
        this.autoFit = false;
        this.callbacks.onInteract('zoom');
      }
      this.pinchDist = d;
      this.requestFrame();
      return;
    }
    if (!this.down) return;
    if (Math.hypot(p.x - this.down.x, p.y - this.down.y) > 4) this.down.moved = true;
    if (this.draft) {
      const ll = this.surfaceAt(p.x, p.y);
      if (ll) {
        this.draft.b = ll;
        this.updateDraftLine();
        this.requestFrame();
      }
      return;
    }
    if (this.down.moved) {
      const k = this.controls.dragScale(this.height, FOV);
      this.controls.rotateBy(-(p.x - prev.x) * k, (p.y - prev.y) * k, true);
      this.callbacks.onInteract('drag');
      if (this.hovered) {
        this.hovered = null;
        this.callbacks.onHover(null);
      }
      this.requestFrame();
    }
  }

  private onPointerUp(e: PointerEvent, cancelled = false) {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.pointers.size > 0) return;
    this.pinchDist = 0;
    const down = this.down;
    this.down = null;
    if (this.draft) {
      const d = this.draft;
      this.clearDraft();
      this.callbacks.onDrawStateChange(false);
      if (!cancelled && d.b) {
        try {
          const g = makeSection(d.a[0], d.a[1], d.b[0], d.b[1]);
          if (g.lengthKm >= 60) {
            this.callbacks.onSectionDrawn(d.a, d.b);
            this.callbacks.onInteract('draw');
          }
        } catch {
          /* degenerate line: ignore */
        }
      }
      this.requestFrame();
      return;
    }
    if (!cancelled && down && !down.moved) {
      const hit = this.pick(p.x, p.y, e.pointerType === 'mouse' ? 10 : 18);
      this.callbacks.onSelect(hit);
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    this.controls.zoomBy(Math.exp(e.deltaY * scale * 0.0012));
    this.autoFit = false;
    this.callbacks.onInteract('zoom');
    this.requestFrame();
  }

  private onKey(e: KeyboardEvent) {
    const step = (e.shiftKey ? 15 : 5) * DEG;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        this.controls.rotateBy(-step, 0, false);
        break;
      case 'ArrowRight':
        this.controls.rotateBy(step, 0, false);
        break;
      case 'ArrowUp':
        this.controls.rotateBy(0, step, false);
        break;
      case 'ArrowDown':
        this.controls.rotateBy(0, -step, false);
        break;
      case '+':
      case '=':
        this.controls.zoomBy(1 / 1.15);
        this.autoFit = false;
        break;
      case '-':
      case '_':
        this.controls.zoomBy(1.15);
        this.autoFit = false;
        break;
      case 'Home':
      case '0':
        this.resetView();
        break;
      case 'Escape':
        if (this.draft) {
          this.clearDraft();
          this.callbacks.onDrawStateChange(false);
        } else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      this.callbacks.onInteract('key');
      this.requestFrame();
    }
  }

  private queueHover(x: number, y: number) {
    const first = this.hoverQueued === null;
    this.hoverQueued = { x, y };
    if (first) this.requestFrame();
  }

  // ---------------------------------------------------------------- frame loop

  requestFrame() {
    if (this.disposed || this.raf || document.visibilityState === 'hidden') return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private resize() {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyViewOffset();
    if (this.autoFit && !this.controls.flying) {
      this.controls.view = { ...this.controls.view, distance: this.fitDistance() };
    }
    this.requestFrame();
  }

  private frame(now: number) {
    this.raf = 0;
    if (this.disposed) return;
    let moving = this.controls.update(now);

    // Depth-mode transition.
    if (this.depthStart === -2) this.depthStart = now;
    if (this.depthStart >= 0) {
      const t = Math.min(1, (now - this.depthStart) / 1400);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      this.depthMix = this.depthFrom + (this.depthTarget - this.depthFrom) * e;
      if (t >= 1) this.depthStart = -1;
      moving = true;
    }
    const mix = this.depthMix;
    this.shared.uDepthMix.value = mix;
    (this.earth.material as ShaderMaterial).uniforms.uOpacity.value = 1 - 0.86 * mix;
    const shellR = 1 - (this.exaggeration * 660) / EARTH_R_KM;
    this.shell.scale.setScalar(1 - mix * (1 - shellR));
    this.shell.visible = mix > 0.01;
    (this.shell.material as ShaderMaterial).uniforms.uOpacity.value = 0.32 * mix;

    // Camera.
    const view = this.controls.view;
    const [cx, cy, cz] = cameraPosition(view);
    this.camera.position.set(cx, cy, cz);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    // On narrow screens the globe is smaller, so slightly smaller points keep the Ring of Fire crisp.
    const span = Math.min(this.width, this.height);
    const screenFactor = Math.min(1, Math.max(0.62, span / 760));
    const ref = this.fitDistance();
    this.shared.uSizeScale.value =
      Math.min(1.7, Math.max(0.7, ((ref - 1) / (view.distance - 1)) ** 0.35)) * screenFactor;

    if (this.live) {
      (this.live.material as ShaderMaterial).uniforms.uTime.value = (now - this.startTime) / 1000;
    }

    // Hover picking once per frame.
    if (this.hoverQueued && !this.down) {
      const { x, y } = this.hoverQueued;
      this.hoverQueued = null;
      const hit = this.drawMode ? null : this.pick(x, y);
      const same =
        hit && this.hovered && hit.kind === this.hovered.kind && hit.index === this.hovered.index;
      if (!same) {
        this.hovered = hit;
        this.callbacks.onHover(hit);
      } else if (hit && this.hovered) {
        this.hovered.x = hit.x;
        this.hovered.y = hit.y;
      }
    }
    this.placeMarker(this.hoverMarker, this.hovered);
    this.placeMarker(this.selectMarker, this.selected);

    this.renderer.render(this.scene, this.camera);
    this.updateLabels();

    const liveAnimating = this.live !== null && !this.reducedMotion;
    if (moving || liveAnimating) this.requestFrame();
  }

  private updateLabels() {
    if (!this.labels) return;
    const g = this.sectionGeom;
    for (const [el, f] of [
      [this.labels.a, 0],
      [this.labels.b, 1],
    ] as const) {
      if (!g) {
        el.style.visibility = 'hidden';
        continue;
      }
      const w = geoToWorld(pointAlong(g, f), 1.003);
      const p = this.projectWorld(w);
      const visible = p.front || this.depthMix > 0.5;
      el.style.visibility = visible ? 'visible' : 'hidden';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
  }

  get viewState(): ViewState {
    return { ...this.controls.view };
  }

  get minDistance() {
    return MIN_DISTANCE;
  }

  dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      (m.material as ShaderMaterial | undefined)?.dispose?.();
    });
    this.ramp.dispose();
    this.renderer.dispose();
  }
}
