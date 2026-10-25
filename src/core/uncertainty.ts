/**
 * Landing zone from input uncertainty.
 * Method A (live): linear propagation through a central-difference Jacobian (12 simulations).
 * Method B (on demand): seeded Monte Carlo with full terrain simulation per sample.
 */

import { DEG } from './angles';
import { flatGround, simulate, type GroundFn } from './ballistics';
import { createRng } from './random';
import type { Vec3 } from './vec';

/** The nominal shot. Parameters q = (θ, ψ, v0, drag scale, w_east, w_north). */
export interface ZoneInputs {
  v0: number;
  elevation: number;
  azimuth: number;
  dragScale: number;
  /** Drag factor at drag scale 1, 1/m. */
  kUnit: number;
  /** Wind (east, north, up) m/s. */
  wind: Vec3;
  windShear?: boolean;
  h0: number;
}

/** One-standard-deviation spreads. */
export interface Spreads {
  elevation: number; // rad
  azimuth: number; // rad
  v0: number; // m/s
  dragScale: number; // absolute, in drag-scale units
  windE: number; // m/s
  windN: number; // m/s
  /** Launch position, each horizontal axis, m. */
  launch: number;
}

export type ContributorKey = 'elevation' | 'azimuth' | 'v0' | 'dragScale' | 'wind' | 'launch';

export const CONTRIBUTOR_LABEL: Record<ContributorKey, string> = {
  elevation: 'tilt',
  azimuth: 'heading',
  v0: 'launch speed',
  dragScale: 'drag',
  wind: 'wind',
  launch: 'launch position',
};

/** Contributor for each entry of q; both wind axes report as one. */
const PARAM_KEYS: ContributorKey[] = ['elevation', 'azimuth', 'v0', 'dragScale', 'wind', 'wind'];

/** Central-difference step sizes: 0.1°, 0.5°, 0.5 m/s, 2% (of drag scale), 0.5 m/s, 0.5 m/s. */
function stepSizes(inp: ZoneInputs): number[] {
  return [0.1 * DEG, 0.5 * DEG, 0.5, 0.02 * inp.dragScale, 0.5, 0.5];
}

function paramVector(inp: ZoneInputs): number[] {
  return [inp.elevation, inp.azimuth, inp.v0, inp.dragScale, inp.wind[0], inp.wind[1]];
}

export interface Cov2 {
  xx: number;
  xy: number;
  yy: number;
}

export interface Ellipse {
  probability: number;
  /** Semi-major and semi-minor axes, m. */
  a: number;
  b: number;
  /** Unit vector of the major axis in ENU. */
  major: [number, number];
}

export interface LinearZone {
  mean: [number, number];
  /** 2 × 6 Jacobian of impact (x, y) w.r.t. q. */
  J: number[][];
  cov: Cov2;
  ellipses: Ellipse[];
  /** Share of total variance (trace) per input, largest first. Wind axes merged. */
  contributions: { key: ContributorKey; label: string; share: number }[];
}

export function impactXY(inp: ZoneInputs, q: readonly number[], ground: GroundFn, dt?: number): [number, number] {
  const r = simulate(
    {
      v0: q[2]!,
      elevation: q[0]!,
      azimuth: q[1]!,
      k: inp.kUnit * Math.max(q[3]!, 0),
      wind: [q[4]!, q[5]!, inp.wind[2]],
      windShear: inp.windShear,
      h0: inp.h0,
    },
    { ground, dt },
  );
  return [r.impact[0], r.impact[1]];
}

/** s_P = √(−2 ln(1 − P)) for a 2-D Gaussian. */
export function ellipseScale(p: number): number {
  return Math.sqrt(-2 * Math.log(1 - p));
}

/** Eigen-decomposition of a symmetric 2 × 2 matrix; λ1 ≥ λ2. */
export function eigSym2(c: Cov2): { l1: number; l2: number; v1: [number, number] } {
  const tr = c.xx + c.yy;
  const det = c.xx * c.yy - c.xy * c.xy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  let v: [number, number];
  if (Math.abs(c.xy) > 1e-15) v = [l1 - c.yy, c.xy];
  else v = c.xx >= c.yy ? [1, 0] : [0, 1];
  const n = Math.hypot(v[0], v[1]);
  return { l1, l2: Math.max(l2, 0), v1: [v[0] / n, v[1] / n] };
}

export function ellipseFor(cov: Cov2, probability: number): Ellipse {
  const { l1, l2, v1 } = eigSym2(cov);
  const s = ellipseScale(probability);
  return { probability, a: s * Math.sqrt(Math.max(l1, 0)), b: s * Math.sqrt(l2), major: v1 };
}

/** Ellipse outline as ENU (x, y) pairs around a centre. */
export function ellipsePolygon(center: readonly [number, number], e: Ellipse, n = 48): [number, number][] {
  const [ux, uy] = e.major;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const ca = e.a * Math.cos(t);
    const sb = e.b * Math.sin(t);
    pts.push([center[0] + ca * ux - sb * uy, center[1] + ca * uy + sb * ux]);
  }
  return pts;
}

/** Squared Mahalanobis distance of (dx, dy) under cov. */
export function mahalanobis2(dx: number, dy: number, c: Cov2): number {
  const det = c.xx * c.yy - c.xy * c.xy;
  if (det <= 0) return Infinity;
  return (c.yy * dx * dx - 2 * c.xy * dx * dy + c.xx * dy * dy) / det;
}

export function jacobian(inp: ZoneInputs, ground: GroundFn = flatGround, dt?: number): { mean: [number, number]; J: number[][] } {
  const q = paramVector(inp);
  const steps = stepSizes(inp);
  const mean = impactXY(inp, q, ground, dt);
  const J: number[][] = [new Array<number>(6).fill(0), new Array<number>(6).fill(0)];
  for (let i = 0; i < 6; i++) {
    const h = steps[i]!;
    const qp = q.slice();
    const qm = q.slice();
    qp[i]! += h;
    qm[i]! -= h;
    const p = impactXY(inp, qp, ground, dt);
    const m = impactXY(inp, qm, ground, dt);
    J[0]![i] = (p[0] - m[0]) / (2 * h);
    J[1]![i] = (p[1] - m[1]) / (2 * h);
  }
  return { mean, J };
}

/** Σ_impact = J Σ_q Jᵀ + Σ_launch, then 50% and 90% ellipses. */
export function linearZone(
  inp: ZoneInputs,
  spreads: Spreads,
  ground: GroundFn = flatGround,
  probabilities: readonly number[] = [0.5, 0.9],
  dt?: number,
): LinearZone {
  const { mean, J } = jacobian(inp, ground, dt);
  const sig = [spreads.elevation, spreads.azimuth, spreads.v0, spreads.dragScale, spreads.windE, spreads.windN];
  let xx = spreads.launch ** 2;
  let yy = spreads.launch ** 2;
  let xy = 0;
  const parts: Partial<Record<ContributorKey, number>> = { launch: 2 * spreads.launch ** 2 };
  for (let i = 0; i < 6; i++) {
    const v = sig[i]! ** 2;
    const jx = J[0]![i]!;
    const jy = J[1]![i]!;
    xx += jx * jx * v;
    yy += jy * jy * v;
    xy += jx * jy * v;
    const key = PARAM_KEYS[i]!;
    parts[key] = (parts[key] ?? 0) + (jx * jx + jy * jy) * v;
  }
  const cov = { xx, xy, yy };
  const total = xx + yy || 1;
  const contributions = (Object.entries(parts) as [ContributorKey, number][])
    .map(([key, v]) => ({ key, label: CONTRIBUTOR_LABEL[key], share: v / total }))
    .sort((a, b) => b.share - a.share);
  return { mean, J, cov, ellipses: probabilities.map((p) => ellipseFor(cov, p)), contributions };
}

/** Downrange metres per 1 m/s of launch speed, and sideways metres per degree of heading error. */
export function sensitivities(J: number[][], azimuth: number): { rangePerV0: number; sidePerDegHeading: number; rangePerDegTilt: number } {
  const u: [number, number] = [Math.sin(azimuth), Math.cos(azimuth)];
  const r: [number, number] = [Math.cos(azimuth), -Math.sin(azimuth)];
  const down = (i: number) => J[0]![i]! * u[0] + J[1]![i]! * u[1];
  const side = (i: number) => J[0]![i]! * r[0] + J[1]![i]! * r[1];
  return { rangePerV0: down(2), sidePerDegHeading: Math.abs(side(1)) * DEG, rangePerDegTilt: down(0) * DEG };
}

export interface MonteCarloResult {
  /** Impact x, y pairs. */
  points: Float64Array;
  mean: [number, number];
  cov: Cov2;
  /** Share of samples inside `reference` ellipse (if given). */
  insideShare: number | null;
}

/** Sample q (and launch position) from the spreads with a seeded generator; full simulation each. */
export function monteCarlo(
  inp: ZoneInputs,
  spreads: Spreads,
  n: number,
  seed: number,
  ground: GroundFn = flatGround,
  reference?: { mean: readonly [number, number]; cov: Cov2; probability: number },
  dt?: number,
): MonteCarloResult {
  const rng = createRng(seed);
  const q0 = paramVector(inp);
  const sig = [spreads.elevation, spreads.azimuth, spreads.v0, spreads.dragScale, spreads.windE, spreads.windN];
  const points = new Float64Array(2 * n);
  let sx = 0;
  let sy = 0;
  for (let s = 0; s < n; s++) {
    const q = q0.map((v, i) => v + sig[i]! * rng.normal());
    q[2] = Math.max(q[2]!, 0.1);
    q[3] = Math.max(q[3]!, 0.01);
    const lx = spreads.launch * rng.normal();
    const ly = spreads.launch * rng.normal();
    const [x, y] = impactXY(inp, q, ground, dt);
    // Moving the launch point moves the impact by the same amount (terrain shift ignored).
    points[2 * s] = x + lx;
    points[2 * s + 1] = y + ly;
    sx += x + lx;
    sy += y + ly;
  }
  const mx = sx / n;
  const my = sy / n;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (let s = 0; s < n; s++) {
    const dx = points[2 * s]! - mx;
    const dy = points[2 * s + 1]! - my;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const d = Math.max(n - 1, 1);
  let insideShare: number | null = null;
  if (reference) {
    const lim = ellipseScale(reference.probability) ** 2;
    let inside = 0;
    for (let s = 0; s < n; s++) {
      if (mahalanobis2(points[2 * s]! - reference.mean[0], points[2 * s + 1]! - reference.mean[1], reference.cov) <= lim) inside++;
    }
    insideShare = inside / n;
  }
  return { points, mean: [mx, my], cov: { xx: xx / d, xy: xy / d, yy: yy / d }, insideShare };
}
