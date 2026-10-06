/**
 * GLSL for the globe layers. All layers draw without depth testing in a fixed order; visibility
 * (near/far side of the Earth) is computed per vertex from the camera position instead, which
 * lets the globe dissolve smoothly from an opaque surface into a translucent shell.
 *
 * Shared conventions:
 *  - The Earth has radius 1. `uDepthMix` is 0 for surface mode and 1 for true-depth mode.
 *  - A point at depth z (km) sits at r = 1 − uDepthMix · uExag · z / 6371.
 *  - Colours are written in sRGB with premultiplied alpha.
 */

const VISIBILITY = /* glsl */ `
  // 1 on the near side of the sphere as seen from the camera, 0 behind the limb.
  float nearSide(vec3 p) {
    return smoothstep(-0.012, 0.03, dot(p, cameraPosition) - dot(p, p));
  }
`;

export const pointsVertex = /* glsl */ `
  attribute vec3 aDir;
  attribute float aDepth;  // depth × 10 (tenths of a km)
  attribute float aMag;    // magnitude × 100
  attribute float aDay;    // whole days since 1970-01-01

  uniform float uDepthMix;
  uniform float uExag;
  uniform vec2 uMagRange;
  uniform vec2 uDepthRange;
  uniform vec2 uDayRange;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uPlayDay;
  uniform float uPlayWindow;
  uniform float uDim;
  uniform sampler2D uRamp;

  varying vec3 vColor;
  varying float vAlpha;

  ${VISIBILITY}

  void main() {
    bool keep = aMag >= uMagRange.x && aMag <= uMagRange.y
      && aDepth >= uDepthRange.x && aDepth <= uDepthRange.y
      && aDay >= uDayRange.x && aDay <= uDayRange.y
      && (uPlayDay < 0.0 || aDay <= uPlayDay);
    if (!keep) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      return;
    }
    float depthKm = max(aDepth * 0.1, 0.0);
    float r = 1.0 + 0.0015 * (1.0 - uDepthMix) - uDepthMix * uExag * depthKm / 6371.0;
    vec3 p = aDir * r;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

    float surface = nearSide(p);
    float facing = dot(aDir, normalize(cameraPosition));
    float inside = mix(0.3, 1.0, smoothstep(-0.75, 0.45, facing));
    float vis = mix(surface, inside, uDepthMix);

    float m = max(aMag * 0.01 - 5.0, 0.0);
    float size = (2.1 + 1.55 * m + 0.6 * m * m) * uSizeScale;
    float alpha = 0.92;
    if (uPlayDay >= 0.0) {
      float fresh = 1.0 - smoothstep(0.0, uPlayWindow, uPlayDay - aDay);
      alpha *= mix(0.32, 1.0, fresh);
      size *= mix(1.0, 1.7, fresh * fresh);
    }
    float t = sqrt(clamp(depthKm / 700.0, 0.0, 1.0));
    vColor = texture2D(uRamp, vec2(t, 0.5)).rgb;
    vAlpha = alpha * vis * uDim;
    // The sprite is twice the disc so the soft halo fits around it.
    gl_PointSize = max(size * 2.0 * uPixelRatio, 1.0);
  }
`;

export const pointsFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha <= 0.003) discard;
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = 1.0 - smoothstep(0.42, 0.5, d);
    float halo = (1.0 - smoothstep(0.5, 1.0, d));
    float a = (core + halo * halo * 0.2 * (1.0 - core)) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

/** Live (last 30 days) events: hollow rings, pulsing gently when less than a day old. */
export const liveVertex = /* glsl */ `
  attribute vec3 aDir;
  attribute float aDepth;  // km
  attribute float aMag;
  attribute float aAgeH;   // hours since the event, at fetch time

  uniform float uDepthMix;
  uniform float uExag;
  uniform vec2 uMagRange;   // × 100
  uniform vec2 uDepthRange; // × 10
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uTime;
  uniform float uMotion;
  uniform sampler2D uRamp;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vPulse;

  ${VISIBILITY}

  void main() {
    float m100 = aMag * 100.0;
    float d10 = aDepth * 10.0;
    // Open slider ends arrive as ±1e9, so at the default M 5 floor every live event (M ≥ 2.5)
    // shows; raising the floor hides live events below it, like catalogue events.
    bool keep = m100 >= uMagRange.x && m100 <= uMagRange.y
      && d10 >= uDepthRange.x && d10 <= uDepthRange.y;
    if (!keep) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      return;
    }
    float depthKm = max(aDepth, 0.0);
    float r = 1.0 + 0.0025 * (1.0 - uDepthMix) - uDepthMix * uExag * depthKm / 6371.0;
    vec3 p = aDir * r;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    float surface = nearSide(p);
    float facing = dot(aDir, normalize(cameraPosition));
    float inside = mix(0.3, 1.0, smoothstep(-0.75, 0.45, facing));
    float vis = mix(surface, inside, uDepthMix);

    float m = aMag - 2.5;
    float size = (3.2 + 1.2 * m + 0.28 * m * m) * uSizeScale;
    float fresh = 1.0 - smoothstep(0.0, 24.0, aAgeH);
    vPulse = fresh * uMotion * (0.5 + 0.5 * sin(uTime * 3.0));
    float t = sqrt(clamp(depthKm / 700.0, 0.0, 1.0));
    vColor = texture2D(uRamp, vec2(t, 0.5)).rgb;
    vAlpha = vis * mix(0.75, 1.0, fresh);
    gl_PointSize = max(size * uPixelRatio * (1.0 + 0.6 * fresh), 2.0);
  }
`;

export const liveFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vPulse;
  void main() {
    if (vAlpha <= 0.003) discard;
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float ringR = 0.72 + 0.18 * vPulse;
    float ring = 1.0 - smoothstep(0.1, 0.2, abs(d - ringR));
    float dot0 = 1.0 - smoothstep(0.16, 0.26, d);
    float a = max(ring, dot0 * 0.9) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

/** Lines on the surface (coastlines, plate boundaries, graticule, section corridor). */
export const lineVertex = /* glsl */ `
  uniform float uDepthMix;
  uniform float uFarAlpha;
  varying float vVis;
  ${VISIBILITY}
  void main() {
    vec3 p = position;
    float near = nearSide(p);
    vVis = mix(near, mix(uFarAlpha, 1.0, near), uDepthMix);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const lineFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vVis;
  void main() {
    float a = uOpacity * vVis;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/** The Earth: opaque basalt in surface mode, a glassy shell with a lit rim in depth mode. */
export const earthVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vW = normalize(position);
    gl_Position = projectionMatrix * mv;
  }
`;

export const earthFragment = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  void main() {
    float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    float fres = pow(1.0 - facing, 2.2);
    // A soft, fixed "atlas" light from the upper left gives the sphere volume.
    float shade = 0.86 + 0.22 * clamp(dot(normalize(vN), normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
    vec3 col = mix(uBase * shade, uRim, fres * 0.85);
    float a = mix(uOpacity, min(1.0, uOpacity + 0.55), fres);
    gl_FragColor = vec4(col * a, a);
  }
`;

/** A thin atmosphere-like halo behind the globe (back faces of a slightly larger sphere). */
export const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  void main() {
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float a = pow(facing, 4.0) * uStrength;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/** Faint shell at the 660 km discontinuity, visible as a ring at its silhouette in depth mode. */
export const shellFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  void main() {
    float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    float rim = smoothstep(0.55, 1.0, 1.0 - facing);
    float a = rim * uOpacity;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/** The vertical "curtain" below a cross-section line in depth mode. */
export const wallVertex = /* glsl */ `
  attribute float aT;       // 0 at the surface, 1 at 700 km
  uniform float uDepthMix;
  uniform float uExag;
  varying float vT;
  varying float vFacing;
  void main() {
    vec3 dir = normalize(position);
    float r = 1.0 - aT * uDepthMix * uExag * 700.0 / 6371.0;
    vec3 p = dir * r;
    vT = aT;
    vFacing = dot(dir, normalize(cameraPosition));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const wallFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vT;
  varying float vFacing;
  void main() {
    float a = uOpacity * (0.55 + 0.45 * (1.0 - vT)) * mix(0.45, 1.0, smoothstep(-0.6, 0.4, vFacing));
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/** Marker ring for the hovered or selected event. */
export const markerVertex = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;
  varying float vVis;
  uniform float uDepthMix;
  ${VISIBILITY}
  void main() {
    vVis = mix(nearSide(position), 1.0, uDepthMix);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uPixelRatio;
  }
`;

export const markerFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vVis;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float ring = 1.0 - smoothstep(0.06, 0.13, abs(d - 0.82));
    float inner = 1.0 - smoothstep(0.03, 0.09, abs(d - 0.62));
    float a = max(ring, inner * 0.55) * max(vVis, 0.25);
    if (a <= 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;
