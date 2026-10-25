/**
 * Target mode: work backwards from a target to the elevation and azimuth that land on it,
 * for both the low (flat, quick) and high (lobbed) arcs.
 *
 * θ_max comes from the spec's reach function f(θ): the downrange distance where the path comes
 * back down through the target's height, minus D. The arcs are then found as roots of
 * h(θ) = (path height as it passes the target's distance) − target height. Both use only the
 * target's height (not full terrain), so they stay smooth, and they share their descending
 * roots. h also covers targets above the muzzle that the low arc reaches while still rising,
 * where f jumps (the apex just touching the target height) and bisection on f lands on the jump.
 * f(θ_max) ≥ 0 implies h(θ_max) ≥ 0, so θ_max brackets both arcs.
 */

import { DEG } from './angles';
import { flatGround, simulate, type GroundFn, type LaunchParams, type SimResult } from './ballistics';
import type { Vec3 } from './vec';

export type BaseLaunch = Omit<LaunchParams, 'elevation' | 'azimuth' | 'origin'>;

export interface InverseOptions {
  /** Full terrain, used only to check each solution for ground in the way. */
  ground?: GroundFn;
  /** Elevation tolerance, rad (spec: 0.01°). */
  tolerance?: number;
  /** Stop the crosswind loop once the sideways miss is under this, m. */
  crossTolerance?: number;
  maxCrossRounds?: number;
  dt?: number;
}

export interface ArcSolution {
  elevation: number;
  azimuth: number;
  /** Time to reach the target, s. */
  tof: number;
  /** Highest point before reaching the target. */
  apex: Vec3;
  impactSpeed: number;
  /** Remaining miss at the target: height above it as the path passes, and sideways, m. */
  heightMiss: number;
  crossMiss: number;
  /** Reaches the target while still climbing (only for targets above the muzzle). */
  ascending: boolean;
  /** Full-terrain run hits the ground more than 2 m short of the target. */
  groundInWay: boolean;
  /** Where the full-terrain run met the ground. */
  terrainImpact: Vec3;
  rounds: number;
}

export interface TargetSolution {
  /** Bearing to the target, rad clockwise from north, [0, 2π). */
  bearing: number;
  /** Horizontal distance, m. */
  distance: number;
  /** Target ground height relative to the launch ground, m. */
  dz: number;
  reachable: boolean;
  /** Longest reach (down through the target height) at θ_max, m. */
  maxReach: number;
  thetaMax: number;
  low: ArcSolution | null;
  high: ArcSolution | null;
  /** Why an arc is missing, if one is. */
  notes: string[];
}

const LOW_MIN = 1 * DEG;
const LOW_MIN_EXTENDED = -10 * DEG;
const HIGH_MAX = 85 * DEG;
const GOLDEN_LO = 1 * DEG;
const GOLDEN_HI = 80 * DEG;
const TWO_PI = 2 * Math.PI;

interface Pass {
  h: number;
  cross: number;
  res: SimResult;
}

export function solveTarget(base: BaseLaunch, target: { x: number; y: number; z: number }, opts: InverseOptions = {}): TargetSolution {
  const tol = opts.tolerance ?? 0.01 * DEG;
  const crossTol = opts.crossTolerance ?? 0.1;
  const maxRounds = opts.maxCrossRounds ?? 8;
  const dt = opts.dt;
  const ground = opts.ground ?? flatGround;

  const D = Math.hypot(target.x, target.y);
  const bearing = Math.atan2(target.x, target.y);
  const sb = Math.sin(bearing);
  const cb = Math.cos(bearing);
  const zt = target.z;
  const notes: string[] = [];
  // Paths that fall this far below the target height without reaching D count as falling short.
  const floor = Math.min(zt, 0) - 30;
  const floorGround: GroundFn = () => floor;

  /** f(θ): downrange distance where the path comes down through z_t, minus D. */
  const reachMiss = (theta: number, psi: number): number => {
    const res = simulate({ ...base, elevation: theta, azimuth: psi }, { plane: zt, dt });
    const [x, y, z] = res.impact;
    const down = x * sb + y * cb - D;
    // Never reached the target height: strongly negative, still increasing with θ.
    return res.stop === 'unreached' ? down - 10 * (zt - z) - D : down;
  };

  /** h(θ): height of the path above z_t as it passes distance D (negative if it never gets there). */
  const pass = (theta: number, psi: number): Pass => {
    const res = simulate({ ...base, elevation: theta, azimuth: psi }, { ground: floorGround, downrange: { bearing, distance: D }, dt });
    const [x, y, z] = res.impact;
    const h = res.stop === 'downrange' ? z - zt : z - zt - (D - (x * sb + y * cb));
    return { h, cross: x * cb - y * sb, res };
  };

  const maxReachAt = (psi: number): { theta: number; reach: number } => {
    const phi = (Math.sqrt(5) - 1) / 2;
    let lo = GOLDEN_LO;
    let hi = GOLDEN_HI;
    let a = hi - phi * (hi - lo);
    let b = lo + phi * (hi - lo);
    let fa = reachMiss(a, psi);
    let fb = reachMiss(b, psi);
    for (let i = 0; i < 30; i++) {
      if (fa < fb) {
        lo = a;
        a = b;
        fa = fb;
        b = lo + phi * (hi - lo);
        fb = reachMiss(b, psi);
      } else {
        hi = b;
        b = a;
        fb = fa;
        a = hi - phi * (hi - lo);
        fa = reachMiss(a, psi);
      }
    }
    const theta = (lo + hi) / 2;
    return { theta, reach: reachMiss(theta, psi) + D };
  };

  /** Root of h on [lo, hi] (h(lo), h(hi) of opposite sign) by bisection, finished with a secant step. */
  const root = (psi: number, lo: number, hi: number, hlo: number, hhi: number): number => {
    while (hi - lo > tol) {
      const mid = (lo + hi) / 2;
      const hm = pass(mid, psi).h;
      if (hm === 0) return mid;
      if ((hm > 0) === (hlo > 0)) {
        lo = mid;
        hlo = hm;
      } else {
        hi = mid;
        hhi = hm;
      }
    }
    return hlo === hhi ? (lo + hi) / 2 : lo - (hlo * (hi - lo)) / (hhi - hlo);
  };

  const { theta: thetaMax, reach: maxReach } = maxReachAt(bearing);
  const result: TargetSolution = {
    bearing: bearing < 0 ? bearing + TWO_PI : bearing,
    distance: D,
    dz: zt,
    reachable: maxReach >= D,
    maxReach,
    thetaMax,
    low: null,
    high: null,
    notes,
  };
  if (!result.reachable) {
    notes.push(`Out of range: maximum reach ${maxReach.toFixed(1)} m at ${(thetaMax / DEG).toFixed(1)}°.`);
    return result;
  }

  const solveArc = (which: 'low' | 'high'): ArcSolution | null => {
    let psi = bearing;
    let theta = thetaMax;
    let m: Pass | null = null;
    let rounds = 0;
    for (; rounds < maxRounds; rounds++) {
      let split = thetaMax;
      let hSplit = pass(split, psi).h;
      if (hSplit < 0) {
        // Azimuth moved enough to change the reach; re-find θ_max for this azimuth.
        split = maxReachAt(psi).theta;
        hSplit = pass(split, psi).h;
        if (hSplit < 0) return null;
      }
      let lo: number;
      let hi: number;
      let hlo: number;
      let hhi: number;
      if (which === 'low') {
        lo = LOW_MIN;
        hlo = pass(lo, psi).h;
        if (hlo > 0) {
          lo = LOW_MIN_EXTENDED;
          hlo = pass(lo, psi).h;
          if (hlo > 0) {
            notes.push('Target too close for a low arc.');
            return null;
          }
        }
        hi = split;
        hhi = hSplit;
      } else {
        hi = HIGH_MAX;
        hhi = pass(hi, psi).h;
        if (hhi > 0) {
          notes.push('Target too close for a high arc under 85°.');
          return null;
        }
        lo = split;
        hlo = hSplit;
      }
      theta = root(psi, lo, hi, hlo, hhi);
      m = pass(theta, psi);
      if (Math.abs(m.cross) < crossTol || D < 1e-6) break;
      psi -= Math.atan(m.cross / D);
    }
    if (!m) return null;
    const terrain = simulate({ ...base, elevation: theta, azimuth: psi }, { ground, dt });
    const tDown = terrain.impact[0] * sb + terrain.impact[1] * cb;
    return {
      elevation: theta,
      azimuth: ((psi % TWO_PI) + TWO_PI) % TWO_PI,
      tof: m.res.tof,
      apex: m.res.apex,
      impactSpeed: m.res.impactSpeed,
      heightMiss: m.h,
      crossMiss: m.cross,
      ascending: m.res.impactVelocity[2] > 0,
      groundInWay: tDown < D - 2,
      terrainImpact: terrain.impact,
      rounds: Math.min(rounds + 1, maxRounds),
    };
  };

  result.low = solveArc('low');
  result.high = solveArc('high');
  if (result.low && result.low.elevation < 0) notes.push('Low arc needs the barrel below horizontal.');
  return result;
}
