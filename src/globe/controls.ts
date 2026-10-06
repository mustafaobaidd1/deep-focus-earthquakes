/**
 * Orbit controls specialised for a globe: the camera moves on a sphere around the Earth's
 * centre (yaw about the polar axis, pitch towards the poles, distance), so north stays up.
 * Drag speed scales with zoom so the surface under the pointer roughly follows it.
 */

export interface ViewState {
  /** Longitude-like angle of the camera around the polar axis, radians. */
  yaw: number;
  /** Latitude of the camera, radians (clamped short of the poles). */
  pitch: number;
  /** Distance from the Earth's centre in Earth radii. */
  distance: number;
}

export const MIN_DISTANCE = 1.32;
export const MAX_DISTANCE = 8;
const MAX_PITCH = (84 * Math.PI) / 180;

export function clampView(v: ViewState): ViewState {
  return {
    yaw: v.yaw,
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, v.pitch)),
    distance: Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, v.distance)),
  };
}

/** Camera yaw/pitch that put (lat, lon) at the centre of the view (see GlobeView.toWorld). */
export function viewFor(latDeg: number, lonDeg: number, distance: number): ViewState {
  return clampView({
    yaw: (lonDeg * Math.PI) / 180 + Math.PI / 2,
    pitch: (latDeg * Math.PI) / 180,
    distance,
  });
}

export function cameraPosition(v: ViewState): [number, number, number] {
  const c = Math.cos(v.pitch);
  return [
    v.distance * c * Math.sin(v.yaw),
    v.distance * Math.sin(v.pitch),
    v.distance * c * Math.cos(v.yaw),
  ];
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Flight {
  from: ViewState;
  to: ViewState;
  start: number;
  duration: number;
}

export class GlobeControls {
  view: ViewState;
  autoRotate = false;
  /** Radians per second. */
  autoRotateSpeed = 0.055;
  private velocity = { yaw: 0, pitch: 0 };
  private flight: Flight | null = null;
  private lastTime = 0;

  constructor(initial: ViewState) {
    this.view = clampView(initial);
  }

  /** Radians of rotation per CSS pixel of drag, for a viewport of `height` px and `fovDeg`. */
  dragScale(height: number, fovDeg: number): number {
    const visibleAtSurface = 2 * Math.tan((fovDeg * Math.PI) / 360) * (this.view.distance - 1);
    return Math.max(visibleAtSurface / Math.max(1, height), 0.0005);
  }

  rotateBy(dYaw: number, dPitch: number, trackVelocity = true, dt = 1 / 60) {
    this.flight = null;
    this.view = clampView({
      ...this.view,
      yaw: this.view.yaw + dYaw,
      pitch: this.view.pitch + dPitch,
    });
    if (trackVelocity) {
      const k = 1 / Math.max(dt, 1 / 240);
      this.velocity = {
        yaw: this.velocity.yaw * 0.4 + dYaw * k * 0.6,
        pitch: this.velocity.pitch * 0.4 + dPitch * k * 0.6,
      };
    }
  }

  zoomBy(factor: number) {
    this.flight = null;
    this.view = clampView({ ...this.view, distance: this.view.distance * factor });
  }

  stopInertia() {
    this.velocity = { yaw: 0, pitch: 0 };
  }

  flyTo(target: ViewState, duration = 1400) {
    const to = clampView(target);
    // Take the short way round.
    const from = { ...this.view };
    to.yaw = from.yaw + wrapAngle(to.yaw - from.yaw);
    this.velocity = { yaw: 0, pitch: 0 };
    if (duration <= 0) {
      this.view = to;
      this.flight = null;
      return;
    }
    this.flight = { from, to, start: -1, duration };
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  /** Advances inertia, flights and auto-rotation. Returns true while anything is moving. */
  update(now: number): boolean {
    const dt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = now;
    if (this.flight) {
      if (this.flight.start < 0) this.flight.start = now;
      const t = Math.min(1, (now - this.flight.start) / this.flight.duration);
      const e = ease(t);
      const { from, to } = this.flight;
      // Pull back a little mid-flight for long hops, like an atlas page turning.
      const hop = Math.min(
        1,
        Math.abs(to.yaw - from.yaw) / Math.PI + Math.abs(to.pitch - from.pitch) / 2,
      );
      const lift = Math.sin(Math.PI * e) * hop * 0.6;
      this.view = clampView({
        yaw: from.yaw + (to.yaw - from.yaw) * e,
        pitch: from.pitch + (to.pitch - from.pitch) * e,
        distance: from.distance + (to.distance - from.distance) * e + lift,
      });
      if (t >= 1) this.flight = null;
      return true;
    }
    let moving = false;
    const speed = Math.hypot(this.velocity.yaw, this.velocity.pitch);
    if (speed > 1e-4) {
      this.view = clampView({
        ...this.view,
        yaw: this.view.yaw + this.velocity.yaw * dt,
        pitch: this.view.pitch + this.velocity.pitch * dt,
      });
      const decay = Math.exp(-dt * 4.5);
      this.velocity = { yaw: this.velocity.yaw * decay, pitch: this.velocity.pitch * decay };
      moving = true;
    } else {
      this.velocity = { yaw: 0, pitch: 0 };
    }
    if (this.autoRotate) {
      this.view = { ...this.view, yaw: this.view.yaw + this.autoRotateSpeed * dt };
      moving = true;
    }
    return moving;
  }

  resetClock() {
    this.lastTime = 0;
  }
}
