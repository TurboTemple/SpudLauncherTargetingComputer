/**
 * Point-mass flight with gravity and quadratic drag relative to the wind, stepped with
 * classic fixed-step RK4 in the local ENU frame (x east, y north, z up, metres).
 *
 * Deliberately ignored (all far below sensor noise at these ranges):
 * - Ground curvature: the true surface drops ~3 mm below the flat plane at 200 m.
 * - Earth's rotation (Coriolis): shifts a 5 s flight by a few centimetres.
 * - Gravity variation: 9.81 m/s² is within ~0.1% across the UK.
 * - Spin, lift and tumbling (folded into the fitted drag scale).
 */

import { shearFactor } from './atmosphere';
import type { Vec3 } from './vec';

export const G = 9.81;
export const DEFAULT_DT = 0.002;
export const PATH_SAMPLE_INTERVAL = 0.02;
export const DEFAULT_T_MAX = 60;
export const DEFAULT_MAX_DISTANCE = 2000;

/** Ground height (m, relative to the launch point's ground) at ENU (x, y). */
export type GroundFn = (x: number, y: number) => number;
export const flatGround: GroundFn = () => 0;

export interface LaunchParams {
  /** Launch speed, m/s. */
  v0: number;
  /** Barrel tilt above horizontal, radians. */
  elevation: number;
  /** Barrel direction, radians clockwise from true north. */
  azimuth: number;
  /** Drag factor k = ρ C_d A / 2m (already multiplied by drag scale), 1/m. */
  k: number;
  /** Wind in ENU, m/s. With shear on, this is the 10 m reference wind. */
  wind?: Vec3;
  /** Scale wind with height by the 1/7 power law (off by default). */
  windShear?: boolean;
  /** Muzzle height above the launch point's ground, m. */
  h0: number;
  /** Launch point offset in ENU (x, y). Defaults to the origin. */
  origin?: readonly [number, number];
}

export interface SimOptions {
  /** Terrain model; defaults to flat ground at z = 0. Ignored when `plane` is set. */
  ground?: GroundFn;
  /**
   * Stop where the path comes back DOWN through this constant height instead of meeting the
   * ground. Used by the inverse solver and calibration so the miss function stays smooth.
   */
  plane?: number;
  /**
   * Also stop where the path first passes this horizontal distance along a bearing (radians).
   * Used by the inverse solver to read the path's height at the target's distance.
   */
  downrange?: { bearing: number; distance: number };
  dt?: number;
  tMax?: number;
  maxDistance?: number;
  /** Record the path every 20 ms for drawing. */
  recordPath?: boolean;
}

/**
 * ground: met the ground (or came down through `plane`)
 * downrange: passed the `downrange` distance
 * time: exceeded tMax · distance: exceeded maxDistance horizontally
 * unreached: plane mode only — the path peaked below the plane
 */
export type StopReason = 'ground' | 'downrange' | 'time' | 'distance' | 'unreached';

export interface SimResult {
  stop: StopReason;
  impact: Vec3;
  impactVelocity: Vec3;
  impactSpeed: number;
  /** Angle of descent below horizontal at impact, radians. */
  impactAngle: number;
  /** Flight time, s. */
  tof: number;
  /** Highest point of the path (z is relative to launch ground). */
  apex: Vec3;
  /** x, y, z triples sampled every 20 ms, starting at the muzzle and ending at impact. */
  path?: Float64Array;
}

export function launchVelocity(v0: number, elevation: number, azimuth: number): Vec3 {
  const ce = Math.cos(elevation);
  return [v0 * ce * Math.sin(azimuth), v0 * ce * Math.cos(azimuth), v0 * Math.sin(elevation)];
}

export function simulate(p: LaunchParams, opts: SimOptions = {}): SimResult {
  const dt = opts.dt ?? DEFAULT_DT;
  const tMax = opts.tMax ?? DEFAULT_T_MAX;
  const maxDist = opts.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const maxD2 = maxDist * maxDist;
  const ground = opts.ground ?? flatGround;
  const plane = opts.plane;
  const usePlane = plane !== undefined;
  const k = p.k;
  const wx0 = p.wind?.[0] ?? 0;
  const wy0 = p.wind?.[1] ?? 0;
  const wz0 = p.wind?.[2] ?? 0;
  const shear = p.windShear === true;
  const ox = p.origin?.[0] ?? 0;
  const oy = p.origin?.[1] ?? 0;
  const dr = opts.downrange;
  const dsx = dr ? Math.sin(dr.bearing) : 0;
  const dsy = dr ? Math.cos(dr.bearing) : 0;

  const v0vec = launchVelocity(p.v0, p.elevation, p.azimuth);
  let x = ox;
  let y = oy;
  let z = p.h0;
  let vx = v0vec[0];
  let vy = v0vec[1];
  let vz = v0vec[2];
  let t = 0;

  // Acceleration result registers, written by acc().
  let ax = 0;
  let ay = 0;
  let az = 0;
  const acc = (zz: number, ux: number, uy: number, uz: number): void => {
    let wx = wx0;
    let wy = wy0;
    let wz = wz0;
    if (shear) {
      const f = shearFactor(zz);
      wx *= f;
      wy *= f;
      wz *= f;
    }
    const rx = ux - wx;
    const ry = uy - wy;
    const rz = uz - wz;
    const ks = k * Math.sqrt(rx * rx + ry * ry + rz * rz);
    ax = -ks * rx;
    ay = -ks * ry;
    az = -G - ks * rz;
  };

  let fPrev = usePlane ? z - plane : z - ground(x, y);
  let wasAbove = fPrev > 0;
  let apexX = x;
  let apexY = y;
  let apexZ = z;

  const path: number[] | null = opts.recordPath ? [x, y, z] : null;
  let nextSample = PATH_SAMPLE_INTERVAL;
  const h = dt / 2;

  for (;;) {
    // k1
    acc(z, vx, vy, vz);
    const k1x = ax, k1y = ay, k1z = az;
    // k2 at midpoint using k1
    const v2x = vx + h * k1x, v2y = vy + h * k1y, v2z = vz + h * k1z;
    acc(z + h * vz, v2x, v2y, v2z);
    const k2x = ax, k2y = ay, k2z = az;
    // k3 at midpoint using k2
    const v3x = vx + h * k2x, v3y = vy + h * k2y, v3z = vz + h * k2z;
    acc(z + h * v2z, v3x, v3y, v3z);
    const k3x = ax, k3y = ay, k3z = az;
    // k4 at end using k3
    const v4x = vx + dt * k3x, v4y = vy + dt * k3y, v4z = vz + dt * k3z;
    acc(z + dt * v3z, v4x, v4y, v4z);
    const k4x = ax, k4y = ay, k4z = az;

    const s = dt / 6;
    const xn = x + s * (vx + 2 * v2x + 2 * v3x + v4x);
    const yn = y + s * (vy + 2 * v2y + 2 * v3y + v4y);
    const zn = z + s * (vz + 2 * v2z + 2 * v3z + v4z);
    const vxn = vx + s * (k1x + 2 * k2x + 2 * k3x + k4x);
    const vyn = vy + s * (k1y + 2 * k2y + 2 * k3y + k4y);
    const vzn = vz + s * (k1z + 2 * k2z + 2 * k3z + k4z);
    const tn = t + dt;

    if (dr) {
      const sPrev = (x - ox) * dsx + (y - oy) * dsy;
      const sNew = (xn - ox) * dsx + (yn - oy) * dsy;
      if (sPrev < dr.distance && sNew >= dr.distance) {
        const frac = (dr.distance - sPrev) / (sNew - sPrev);
        const iz = z + frac * (zn - z);
        if (iz > apexZ) {
          apexZ = iz;
          apexX = x + frac * (xn - x);
          apexY = y + frac * (yn - y);
        }
        return finish(
          'downrange',
          [x + frac * (xn - x), y + frac * (yn - y), iz],
          [vx + frac * (vxn - vx), vy + frac * (vyn - vy), vz + frac * (vzn - vz)],
          t + frac * dt,
        );
      }
    }

    if (zn > apexZ) {
      apexZ = zn;
      apexX = xn;
      apexY = yn;
    }

    const f = usePlane ? zn - plane : zn - ground(xn, yn);
    const hit = usePlane ? fPrev > 0 && f <= 0 : f <= 0;
    if (hit) {
      // Linear interpolation of the last step on f = z − ground(x, y).
      const frac = fPrev === f ? 0 : fPrev / (fPrev - f);
      const ix = x + frac * (xn - x);
      const iy = y + frac * (yn - y);
      const iz = z + frac * (zn - z);
      const ivx = vx + frac * (vxn - vx);
      const ivy = vy + frac * (vyn - vy);
      const ivz = vz + frac * (vzn - vz);
      return finish('ground', [ix, iy, iz], [ivx, ivy, ivz], t + frac * dt);
    }
    if (f > 0) wasAbove = true;
    if (usePlane && !wasAbove && vzn < 0) {
      // Peaked below the plane: it can never come back down through it.
      return finish('unreached', [xn, yn, zn], [vxn, vyn, vzn], tn);
    }

    x = xn;
    y = yn;
    z = zn;
    vx = vxn;
    vy = vyn;
    vz = vzn;
    t = tn;
    fPrev = f;

    if (path && t >= nextSample - 1e-9) {
      path.push(x, y, z);
      nextSample += PATH_SAMPLE_INTERVAL;
    }
    if (t > tMax) return finish('time', [x, y, z], [vx, vy, vz], t);
    const dx = x - ox;
    const dy = y - oy;
    if (dx * dx + dy * dy > maxD2) return finish('distance', [x, y, z], [vx, vy, vz], t);
  }

  function finish(stop: StopReason, impact: Vec3, v: Vec3, tof: number): SimResult {
    const horiz = Math.hypot(v[0], v[1]);
    const res: SimResult = {
      stop,
      impact,
      impactVelocity: v,
      impactSpeed: Math.hypot(horiz, v[2]),
      impactAngle: Math.atan2(-v[2], horiz),
      tof,
      apex: [apexX, apexY, apexZ],
    };
    if (path) {
      path.push(impact[0], impact[1], impact[2]);
      res.path = Float64Array.from(path);
    }
    return res;
  }
}

/** Horizontal distance from the launch point to the impact. */
export function horizontalRange(r: SimResult, origin: readonly [number, number] = [0, 0]): number {
  return Math.hypot(r.impact[0] - origin[0], r.impact[1] - origin[1]);
}
