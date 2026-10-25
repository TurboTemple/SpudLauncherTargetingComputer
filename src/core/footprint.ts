/**
 * Safety footprint and range card.
 *
 * The footprint is the furthest a shot could land in each direction, taking the best tilt for
 * reach with pessimistic inputs at once: launch speed +3σ, drag −3σ, and an extra 3σ of wind
 * blowing along that direction. It is the area to keep clear of people, animals and roads.
 * (At 2σ about 1 in 1,000 Monte Carlo shots aimed for maximum reach downwind landed just
 * outside, which is too many for a keep-clear line.)
 */

import { DEG } from './angles';
import { flatGround, simulate, type GroundFn, type LaunchParams } from './ballistics';
import type { Vec3 } from './vec';

export type Conditions = Omit<LaunchParams, 'elevation' | 'azimuth' | 'origin'>;

export interface FootprintSpreads {
  /** 1σ, m/s. */
  v0: number;
  /** 1σ as a fraction of the drag factor. */
  dragFrac: number;
  /** 1σ per horizontal axis, m/s. */
  wind: number;
}

export interface FootprintPoint {
  azimuth: number;
  x: number;
  y: number;
  /** Horizontal distance from the launch point, m. */
  reach: number;
  /** Tilt that reaches furthest, rad. */
  elevation: number;
}

/** Best-reach impact along one azimuth: coarse scan of tilt, then golden-section refinement. */
function furthest(c: Conditions, azimuth: number, ground: GroundFn): FootprintPoint {
  const reachAt = (el: number) => {
    const r = simulate({ ...c, elevation: el, azimuth }, { ground });
    return { d: Math.hypot(r.impact[0], r.impact[1]), x: r.impact[0], y: r.impact[1] };
  };
  let bestEl = 5 * DEG;
  let best = reachAt(bestEl);
  for (let el = 10; el <= 80; el += 5) {
    const r = reachAt(el * DEG);
    if (r.d > best.d) {
      best = r;
      bestEl = el * DEG;
    }
  }
  const phi = (Math.sqrt(5) - 1) / 2;
  let lo = Math.max(1 * DEG, bestEl - 5 * DEG);
  let hi = Math.min(85 * DEG, bestEl + 5 * DEG);
  let a = hi - phi * (hi - lo);
  let b = lo + phi * (hi - lo);
  let fa = reachAt(a);
  let fb = reachAt(b);
  for (let i = 0; i < 12; i++) {
    if (fa.d < fb.d) {
      lo = a;
      a = b;
      fa = fb;
      b = lo + phi * (hi - lo);
      fb = reachAt(b);
    } else {
      hi = b;
      b = a;
      fb = fa;
      a = hi - phi * (hi - lo);
      fa = reachAt(a);
    }
  }
  const top = [best, fa, fb].reduce((p, q) => (q.d > p.d ? q : p));
  const el = top === best ? bestEl : top === fa ? a : b;
  return { azimuth, x: top.x, y: top.y, reach: top.d, elevation: el };
}

export function keepClearFootprint(c: Conditions, spreads: FootprintSpreads, ground: GroundFn = flatGround, stepDeg = 10, sigmas = 3): FootprintPoint[] {
  const out: FootprintPoint[] = [];
  const w: Vec3 = c.wind ?? [0, 0, 0];
  for (let deg = 0; deg < 360; deg += stepDeg) {
    const az = deg * DEG;
    const pessimistic: Conditions = {
      ...c,
      v0: c.v0 + sigmas * spreads.v0,
      k: c.k * Math.max(0.2, 1 - sigmas * spreads.dragFrac),
      wind: [w[0] + sigmas * spreads.wind * Math.sin(az), w[1] + sigmas * spreads.wind * Math.cos(az), w[2]],
    };
    out.push(furthest(pessimistic, az, ground));
  }
  return out;
}

export interface RangeRow {
  elevationDeg: number;
  range: number;
  tof: number;
  apex: number;
  impactSpeed: number;
  /** Kinetic energy at impact, J. */
  energy: number;
  /** The tilt with the longest reach. */
  best?: boolean;
}

/** Range card along one azimuth (current conditions and ground): one row per tilt, plus the best-reach tilt. */
export function rangeCard(c: Conditions, azimuth: number, massKg: number, ground: GroundFn = flatGround, elevationsDeg: readonly number[] = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80]): RangeRow[] {
  const row = (elDeg: number): RangeRow => {
    const r = simulate({ ...c, elevation: elDeg * DEG, azimuth }, { ground });
    return {
      elevationDeg: elDeg,
      range: Math.hypot(r.impact[0], r.impact[1]),
      tof: r.tof,
      apex: r.apex[2],
      impactSpeed: r.impactSpeed,
      energy: 0.5 * massKg * r.impactSpeed ** 2,
    };
  };
  const rows = elevationsDeg.map(row);
  const best = furthest(c, azimuth, ground);
  const bestDeg = Math.round((best.elevation / DEG) * 10) / 10;
  if (!rows.some((r) => Math.abs(r.elevationDeg - bestDeg) < 0.05)) rows.push(row(bestDeg));
  rows.sort((p, q) => p.elevationDeg - q.elevationDeg);
  const top = rows.reduce((p, q) => (q.range > p.range ? q : p));
  top.best = true;
  return rows;
}
