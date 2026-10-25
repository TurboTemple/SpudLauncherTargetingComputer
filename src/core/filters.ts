/**
 * Sensor smoothing and steadiness detection. Times are in seconds, angles in radians.
 * The barrel VECTOR is smoothed, not the angles, so 359° → 0° never glitches.
 */

import { angleDiff, circularMean, DEG, wrapTau } from './angles';
import type { Vec3 } from './vec';

/** Exponential moving average of a unit vector; per-sample weight 1 − e^(−Δt/τ), then renormalised. */
export class VectorEma {
  private v: [number, number, number] | null = null;
  private lastT = 0;
  constructor(public tau = 0.15) {}

  update(d: Vec3, t: number): Vec3 {
    if (!this.v) {
      this.v = [d[0], d[1], d[2]];
    } else {
      const dt = Math.max(0, t - this.lastT);
      const w = this.tau > 0 ? 1 - Math.exp(-dt / this.tau) : 1;
      this.v[0] += w * (d[0] - this.v[0]);
      this.v[1] += w * (d[1] - this.v[1]);
      this.v[2] += w * (d[2] - this.v[2]);
    }
    this.lastT = t;
    const n = Math.hypot(this.v[0], this.v[1], this.v[2]) || 1;
    this.v[0] /= n;
    this.v[1] /= n;
    this.v[2] /= n;
    return [this.v[0], this.v[1], this.v[2]];
  }

  get value(): Vec3 | null {
    return this.v ? [this.v[0], this.v[1], this.v[2]] : null;
  }

  reset(): void {
    this.v = null;
  }
}

/** Time-constant EMA on an angle via its unit vector (a running circular mean). */
export class CircularEma {
  private s = 0;
  private c = 0;
  private lastT: number | null = null;
  constructor(public tau = 2) {}

  update(angle: number, t: number): number {
    if (this.lastT === null) {
      this.s = Math.sin(angle);
      this.c = Math.cos(angle);
    } else {
      const w = 1 - Math.exp(-Math.max(0, t - this.lastT) / this.tau);
      this.s += w * (Math.sin(angle) - this.s);
      this.c += w * (Math.cos(angle) - this.c);
    }
    this.lastT = t;
    return this.value!;
  }

  get value(): number | null {
    return this.lastT === null ? null : wrapTau(Math.atan2(this.s, this.c));
  }

  reset(): void {
    this.lastT = null;
  }
}

export function mean(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length ? s / xs.length : NaN;
}

/** Population standard deviation. */
export function std(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}

/** Standard deviation of angles about their circular mean. */
export function circularStd(angles: readonly number[]): number {
  if (angles.length < 2) return 0;
  const m = circularMean(angles);
  if (Number.isNaN(m)) return Math.PI;
  let s = 0;
  for (const a of angles) {
    const d = angleDiff(a, m);
    s += d * d;
  }
  return Math.sqrt(s / angles.length);
}

export interface SteadyThresholds {
  /** Window length, s. */
  window: number;
  /** Max elevation standard deviation, rad. */
  elevationStd: number;
  /** Max azimuth standard deviation, rad. */
  azimuthStd: number;
}

export const DEFAULT_STEADY: SteadyThresholds = { window: 0.5, elevationStd: 0.15 * DEG, azimuthStd: 0.5 * DEG };

export interface SteadyStats {
  steady: boolean;
  elevationStd: number;
  azimuthStd: number;
  /** Seconds the aim has been continuously steady (0 when not steady). */
  steadyFor: number;
}

/** Steady when, over the last window, elevation and azimuth spreads are under thresholds. */
export class SteadinessDetector {
  private t: number[] = [];
  private el: number[] = [];
  private az: number[] = [];
  private steadySince: number | null = null;
  constructor(public thresholds: SteadyThresholds = DEFAULT_STEADY) {}

  push(t: number, elevation: number, azimuth: number): SteadyStats {
    this.t.push(t);
    this.el.push(elevation);
    this.az.push(azimuth);
    const cutoff = t - this.thresholds.window;
    let drop = 0;
    while (drop < this.t.length - 1 && this.t[drop]! < cutoff) drop++;
    if (drop) {
      this.t.splice(0, drop);
      this.el.splice(0, drop);
      this.az.splice(0, drop);
    }
    const span = t - this.t[0]!;
    const elevationStd = std(this.el);
    const azimuthStd = circularStd(this.az);
    const full = span >= 0.8 * this.thresholds.window && this.t.length >= 5;
    const steady = full && elevationStd < this.thresholds.elevationStd && azimuthStd < this.thresholds.azimuthStd;
    if (steady) this.steadySince ??= t;
    else this.steadySince = null;
    return { steady, elevationStd, azimuthStd, steadyFor: this.steadySince === null ? 0 : t - this.steadySince };
  }

  reset(): void {
    this.t = [];
    this.el = [];
    this.az = [];
    this.steadySince = null;
  }
}

/**
 * Metal warning: the compass heading jumps (> 5° within a short window) while tilt holds steady.
 * A steel barrel or nearby metal bends the magnetic field; real swings move the tilt too.
 */
export class HeadingJumpDetector {
  private samples: { t: number; el: number; az: number }[] = [];
  constructor(
    public jump = 5 * DEG,
    public window = 0.25,
    public tiltSteady = 0.3 * DEG,
  ) {}

  push(t: number, elevation: number, azimuth: number): boolean {
    this.samples.push({ t, el: elevation, az: azimuth });
    while (this.samples.length > 1 && this.samples[0]!.t < t - this.window) this.samples.shift();
    if (this.samples.length < 2) return false;
    let elMin = Infinity;
    let elMax = -Infinity;
    for (const s of this.samples) {
      elMin = Math.min(elMin, s.el);
      elMax = Math.max(elMax, s.el);
    }
    const first = this.samples[0]!;
    return Math.abs(angleDiff(azimuth, first.az)) > this.jump && elMax - elMin < this.tiltSteady;
  }

  reset(): void {
    this.samples = [];
  }
}

/**
 * Detects the jolt of a shot from accelerometer samples (device frame, m/s²). Uses the
 * gravity-free acceleration when the device provides it; otherwise subtracts a slow low-pass
 * gravity estimate. A shot is a magnitude above `threshold`, at most once per `refractory` s.
 */
export class ShotDetector {
  private g: [number, number, number] | null = null;
  private lastT: number | null = null;
  private lastShot = -Infinity;
  /** Largest magnitude seen since the last call to takePeak(), for a live meter. */
  private peak = 0;

  constructor(
    public threshold = 25,
    public refractory = 3,
    public gravityTau = 0.5,
  ) {}

  push(t: number, withGravity: Vec3 | null, linear?: Vec3 | null): number | null {
    let m: number;
    if (linear) {
      m = Math.hypot(linear[0], linear[1], linear[2]);
    } else if (withGravity) {
      if (!this.g || this.lastT === null) this.g = [withGravity[0], withGravity[1], withGravity[2]];
      else {
        const w = 1 - Math.exp(-Math.max(0, t - this.lastT) / this.gravityTau);
        for (let i = 0; i < 3; i++) this.g[i]! += w * (withGravity[i]! - this.g[i]!);
      }
      m = Math.hypot(withGravity[0] - this.g[0], withGravity[1] - this.g[1], withGravity[2] - this.g[2]);
    } else {
      return null;
    }
    this.lastT = t;
    this.peak = Math.max(this.peak, m);
    if (m >= this.threshold && t - this.lastShot >= this.refractory) {
      this.lastShot = t;
      return m;
    }
    return null;
  }

  takePeak(): number {
    const p = this.peak;
    this.peak = 0;
    return p;
  }
}

/** Keeps a short history of timed values to look up what they were just before an event. */
export class History<T> {
  private items: { t: number; v: T }[] = [];
  constructor(public span = 2) {}

  push(t: number, v: T): void {
    this.items.push({ t, v });
    while (this.items.length > 1 && this.items[0]!.t < t - this.span) this.items.shift();
  }

  /** The latest value at or before time t (or the oldest kept). */
  at(t: number): T | null {
    let best: T | null = this.items[0]?.v ?? null;
    for (const it of this.items) {
      if (it.t <= t) best = it.v;
      else break;
    }
    return best;
  }
}
