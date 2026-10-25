/**
 * Calibration: least-squares fit of launch speed (per power setting), drag scale (per
 * projectile) and heading bias (per session) to logged shots with marked impacts.
 *
 * S = Σ [(Δdown/σm)² + (Δcross/σm)² + (Δt/σt)²] + Σ_c (ln c / 0.3)²
 *
 * The last term is a gentle prior pulling each drag scale towards 1. Without it, shots at
 * similar angles with no flight times are unsolvable (v0 and drag trade off without limit).
 * Solved with bounded Levenberg–Marquardt and a finite-difference Jacobian.
 */

import { DEG } from './angles';
import { simulate, type SimResult } from './ballistics';
import { invert, solve, type Matrix } from './linalg';
import type { Vec3 } from './vec';

/** One logged shot, already reduced to the shot's own ENU frame (origin = its launch point). */
export interface CalShot {
  id: string;
  setting: string;
  projectile: string;
  session: string;
  /** Corrected barrel tilt (mount offset applied), rad. */
  elevation: number;
  /** Corrected azimuth (declination and recorded bias applied), rad. The fitted bias adds to this. */
  azimuth: number;
  /** Muzzle height, m. */
  h0: number;
  /** Drag factor at drag scale 1 for this shot's air, projectile and weight, 1/m. */
  kUnit: number;
  /**
   * This shot's launch speed relative to its setting's fitted speed. With "speed depends on
   * weight" (same energy each shot) it is √(m_ref / m); otherwise 1. The fitted v0 is then the
   * speed of a reference-weight potato.
   */
  speedScale?: number;
  wind: Vec3;
  shearExponent?: number;
  /** Marked impact in ENU, m; z relative to the launch ground. */
  impact: { x: number; y: number; z: number };
  /** Marking uncertainty, m (2 for a map tap, GPS accuracy for a walked mark). */
  sigmaM: number;
  /** Hand-timed flight time, s. */
  flightTime?: number;
}

export interface CalStart {
  v0: Record<string, number>;
  dragScale: Record<string, number>;
  headingBias: Record<string, number>;
}

export interface FittedValue {
  value: number;
  /** Standard error (NaN when held or not estimable). */
  se: number;
  fitted: boolean;
  /** Fitted but pinned at a bound: the data push it further than allowed. */
  atBound?: boolean;
  /** Why the value was held, when it was. */
  reason?: string;
}

export interface ShotResidual {
  id: string;
  predicted: Vec3;
  tof: number;
  /** Predicted − marked, m, in the shot's aim frame. */
  down: number;
  cross: number;
  /** Predicted − timed flight time, s. */
  dt?: number;
}

export interface SpeedScatter {
  /** Sample standard deviation of per-shot launch speeds, m/s (NaN with < 2 shots). */
  sigma: number;
  perShot: { id: string; v0: number }[];
}

export interface CalResult {
  v0: Record<string, FittedValue>;
  dragScale: Record<string, FittedValue>;
  headingBias: Record<string, FittedValue>;
  S: number;
  iterations: number;
  converged: boolean;
  residuals: ShotResidual[];
  speedScatter: Record<string, SpeedScatter>;
  notes: string[];
}

export const SIGMA_MAP_TAP = 2;
export const SIGMA_T = 0.15;
export const PRIOR_SIGMA_LN_C = 0.3;
export const V0_BOUNDS: [number, number] = [5, 150];
export const C_BOUNDS: [number, number] = [0.3, 3];
export const BIAS_BOUNDS: [number, number] = [-30 * DEG, 30 * DEG];

export interface CalOptions {
  maxIterations?: number;
  /** Stop when S changes by less than this fraction. */
  relTolerance?: number;
  dt?: number;
}

type Kind = 'v0' | 'c' | 'b';
interface FreeParam {
  kind: Kind;
  key: string;
  lo: number;
  hi: number;
}

/** Simulate a shot down to its marked impact height; v0 is the setting's (reference-weight) speed. */
export function simulateShot(s: CalShot, v0: number, c: number, bias: number, dt?: number): SimResult {
  return simulate(
    { v0: v0 * (s.speedScale ?? 1), elevation: s.elevation, azimuth: s.azimuth + bias, k: s.kUnit * c, wind: s.wind, shearExponent: s.shearExponent, h0: s.h0 },
    { plane: s.impact.z, dt },
  );
}

/** Predicted − marked in the shot's aim frame (downrange, crossrange). */
function aimFrameMiss(s: CalShot, r: SimResult): { down: number; cross: number } {
  const dx = r.impact[0] - s.impact.x;
  const dy = r.impact[1] - s.impact.y;
  const sa = Math.sin(s.azimuth);
  const ca = Math.cos(s.azimuth);
  return { down: dx * sa + dy * ca, cross: dx * ca - dy * sa };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function fitCalibration(shots: readonly CalShot[], start: CalStart, opts: CalOptions = {}): CalResult {
  const maxIter = opts.maxIterations ?? 50;
  const relTol = opts.relTolerance ?? 1e-6;
  const dt = opts.dt;
  const notes: string[] = [];

  const settings = [...new Set(shots.map((s) => s.setting))];
  const projectiles = [...new Set(shots.map((s) => s.projectile))];
  const sessions = [...new Set(shots.map((s) => s.session))];

  // Current values (free ones are overwritten from the parameter vector).
  const v0: Record<string, number> = {};
  const c: Record<string, number> = {};
  const b: Record<string, number> = {};
  const held: Record<string, string> = {};
  const free: FreeParam[] = [];

  for (const key of settings) {
    v0[key] = clamp(start.v0[key] ?? 40, ...V0_BOUNDS);
    const n = shots.filter((s) => s.setting === key).length;
    if (n >= 2) free.push({ kind: 'v0', key, lo: V0_BOUNDS[0], hi: V0_BOUNDS[1] });
    else held[`v0:${key}`] = `needs 2 shots, has ${n}`;
  }
  for (const key of projectiles) {
    const mine = shots.filter((s) => s.projectile === key);
    const els = mine.map((s) => s.elevation);
    const span = Math.max(...els) - Math.min(...els);
    const anyTimed = mine.some((s) => s.flightTime !== undefined);
    if (mine.length < 3) {
      c[key] = 1;
      held[`c:${key}`] = `held at 1 until 3 shots (has ${mine.length})`;
    } else if (span < 15 * DEG && !anyTimed) {
      c[key] = 1;
      held[`c:${key}`] = 'held at 1: shots span under 15° of tilt and none are timed';
    } else {
      c[key] = clamp(start.dragScale[key] ?? 1, ...C_BOUNDS);
      free.push({ kind: 'c', key, lo: C_BOUNDS[0], hi: C_BOUNDS[1] });
    }
  }
  for (const key of sessions) {
    const n = shots.filter((s) => s.session === key).length;
    if (n >= 2) {
      b[key] = clamp(start.headingBias[key] ?? 0, ...BIAS_BOUNDS);
      free.push({ kind: 'b', key, lo: BIAS_BOUNDS[0], hi: BIAS_BOUNDS[1] });
    } else {
      b[key] = 0;
      held[`b:${key}`] = `needs 2 marked shots this session, has ${n}`;
    }
  }

  const apply = (p: readonly number[]) => {
    free.forEach((f, i) => {
      const target = f.kind === 'v0' ? v0 : f.kind === 'c' ? c : b;
      target[f.key] = p[i]!;
    });
  };
  const current = (): number[] => free.map((f) => (f.kind === 'v0' ? v0 : f.kind === 'c' ? c : b)[f.key]!);
  const freeC = free.filter((f) => f.kind === 'c').map((f) => f.key);
  const nData = shots.reduce((n, s) => n + 2 + (s.flightTime !== undefined ? 1 : 0), 0);

  const residuals = (p: readonly number[]): number[] => {
    apply(p);
    const r: number[] = [];
    for (const s of shots) {
      const sim = simulateShot(s, v0[s.setting]!, c[s.projectile]!, b[s.session]!, dt);
      const m = aimFrameMiss(s, sim);
      r.push(m.down / s.sigmaM, m.cross / s.sigmaM);
      if (s.flightTime !== undefined) r.push((sim.tof - s.flightTime) / SIGMA_T);
    }
    for (const key of freeC) r.push(Math.log(c[key]!) / PRIOR_SIGMA_LN_C);
    return r;
  };
  const sumSq = (r: readonly number[]) => r.reduce((a, x) => a + x * x, 0);

  const stepFor = (f: FreeParam, v: number) => (f.kind === 'v0' ? 1e-3 * Math.max(1, Math.abs(v)) : f.kind === 'c' ? 1e-4 : 1e-5);

  const jacobianAt = (p: readonly number[]): Matrix => {
    const cols: number[][] = [];
    free.forEach((f, i) => {
      const h = stepFor(f, p[i]!);
      const pp = p.slice();
      const pm = p.slice();
      pp[i] = p[i]! + h;
      pm[i] = p[i]! - h;
      const rp = residuals(pp);
      const rm = residuals(pm);
      cols.push(rp.map((x, j) => (x - rm[j]!) / (2 * h)));
    });
    apply(p);
    const m = cols[0]?.length ?? 0;
    return Array.from({ length: m }, (_, j) => cols.map((col) => col[j]!));
  };

  let p = current();
  let r = residuals(p);
  let S = sumSq(r);
  let lambda = 1e-3;
  let iterations = 0;
  let converged = free.length === 0;

  while (!converged && iterations < maxIter) {
    iterations++;
    const J = jacobianAt(p);
    const np = free.length;
    const A: Matrix = Array.from({ length: np }, (_, i) =>
      Array.from({ length: np }, (_, k) => J.reduce((a, row) => a + row[i]! * row[k]!, 0)),
    );
    const g = Array.from({ length: np }, (_, i) => J.reduce((a, row, j) => a + row[i]! * r[j]!, 0));
    // Parameters pinned at a bound with the descent direction pointing outward stay put.
    const active = free.map((f, i) => !((p[i]! <= f.lo && g[i]! > 0) || (p[i]! >= f.hi && g[i]! < 0)));

    let accepted = false;
    for (let tries = 0; tries < 12 && !accepted; tries++) {
      const idx = active.flatMap((a, i) => (a ? [i] : []));
      if (idx.length === 0) break;
      const M = idx.map((i) => idx.map((k) => A[i]![k]! + (i === k ? lambda * Math.max(A[i]![i]!, 1e-12) : 0)));
      const delta = solve(
        M,
        idx.map((i) => -g[i]!),
      );
      if (!delta) {
        lambda *= 4;
        continue;
      }
      const pNew = p.slice();
      idx.forEach((i, j) => {
        const f = free[i]!;
        pNew[i] = clamp(p[i]! + delta[j]!, f.lo, f.hi);
      });
      const rNew = residuals(pNew);
      const SNew = sumSq(rNew);
      if (SNew < S) {
        const rel = (S - SNew) / Math.max(S, 1e-300);
        p = pNew;
        r = rNew;
        S = SNew;
        lambda = Math.max(lambda / 3, 1e-12);
        accepted = true;
        if (rel < relTol) converged = true;
      } else {
        lambda *= 4;
      }
    }
    if (!accepted) converged = true; // No step improves S: at a (bounded) minimum.
  }
  apply(p);

  // Standard errors from (JᵀJ)⁻¹ × S / (n − p).
  const se = new Array<number>(free.length).fill(NaN);
  if (free.length > 0 && nData > free.length) {
    const J = jacobianAt(p);
    const A: Matrix = free.map((_, i) => free.map((__, k) => J.reduce((a, row) => a + row[i]! * row[k]!, 0)));
    const inv = invert(A);
    if (inv) {
      const s2 = S / (nData - free.length);
      for (let i = 0; i < free.length; i++) se[i] = Math.sqrt(Math.max(inv[i]![i]! * s2, 0));
    }
  }

  const pack = (kind: Kind, values: Record<string, number>): Record<string, FittedValue> => {
    const out: Record<string, FittedValue> = {};
    for (const key of Object.keys(values)) {
      const i = free.findIndex((f) => f.kind === kind && f.key === key);
      const reason = held[`${kind}:${key}`];
      if (i >= 0) {
        const f = free[i]!;
        const v = values[key]!;
        const atBound = v <= f.lo + 1e-9 * Math.max(1, Math.abs(f.lo)) || v >= f.hi - 1e-9 * Math.max(1, Math.abs(f.hi));
        out[key] = { value: v, se: se[i]!, fitted: true, ...(atBound ? { atBound } : {}) };
      } else {
        out[key] = { value: values[key]!, se: NaN, fitted: false, ...(reason ? { reason } : {}) };
      }
    }
    return out;
  };

  const shotResiduals: ShotResidual[] = shots.map((s) => {
    const sim = simulateShot(s, v0[s.setting]!, c[s.projectile]!, b[s.session]!, dt);
    const m = aimFrameMiss(s, sim);
    return {
      id: s.id,
      predicted: sim.impact,
      tof: sim.tof,
      down: m.down,
      cross: m.cross,
      ...(s.flightTime !== undefined ? { dt: sim.tof - s.flightTime } : {}),
    };
  });

  // Shot-to-shot speed scatter: the single v0 that lands each shot on its mark, others fixed.
  const speedScatter: Record<string, SpeedScatter> = {};
  for (const key of settings) {
    const mine = shots.filter((s) => s.setting === key);
    const perShot = mine.map((s) => ({ id: s.id, v0: speedForShot(s, c[s.projectile]!, b[s.session]!, dt) }));
    const vals = perShot.map((x) => x.v0).filter(Number.isFinite);
    let sigma = NaN;
    if (vals.length >= 2) {
      const m = vals.reduce((a, x) => a + x, 0) / vals.length;
      sigma = Math.sqrt(vals.reduce((a, x) => a + (x - m) ** 2, 0) / (vals.length - 1));
    }
    speedScatter[key] = { sigma, perShot };
  }

  if (free.length === 0) notes.push('Nothing to fit yet: every parameter is held.');
  if (!converged) notes.push(`Stopped after ${maxIter} iterations without converging.`);

  return {
    v0: pack('v0', v0),
    dragScale: pack('c', c),
    headingBias: pack('b', b),
    S,
    iterations,
    converged,
    residuals: shotResiduals,
    speedScatter,
    notes,
  };
}

/** Setting speed (reference weight) that puts this shot's downrange miss at zero (bisection on 5–150 m/s). */
export function speedForShot(s: CalShot, c: number, bias: number, dt?: number): number {
  const f = (v: number) => {
    const r = simulateShot(s, v, c, bias, dt);
    if (r.stop === 'unreached') return -1e6;
    return aimFrameMiss(s, r).down;
  };
  let lo = V0_BOUNDS[0];
  let hi = V0_BOUNDS[1];
  let flo = f(lo);
  const fhi = f(hi);
  if (flo > 0 || fhi < 0) return NaN;
  for (let i = 0; i < 50 && hi - lo > 1e-4; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if ((fm > 0) === (flo > 0)) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Speed against a numeric setting such as chamber pressure: v = a·p^b, fitted on log–log axes
 * over the calibrated settings. With one calibrated setting, b = 0.5 (speed ∝ √pressure: the
 * gas does work ∝ pressure on a potato of fixed weight). b is clamped to [0.1, 1.5].
 */
export interface PowerCurve {
  a: number;
  b: number;
  /** Range of calibrated settings; outside it the curve is extrapolating. */
  min: number;
  max: number;
  points: number;
}

export function fitPowerCurve(points: readonly { numeric: number; v0: number }[]): PowerCurve | null {
  const pts = points.filter((p) => p.numeric > 0 && p.v0 > 0);
  if (pts.length === 0) return null;
  const lx = pts.map((p) => Math.log(p.numeric));
  const ly = pts.map((p) => Math.log(p.v0));
  const n = pts.length;
  const mx = lx.reduce((a, x) => a + x, 0) / n;
  const my = ly.reduce((a, y) => a + y, 0) / n;
  let b = 0.5;
  if (n >= 2) {
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (lx[i]! - mx) ** 2;
      sxy += (lx[i]! - mx) * (ly[i]! - my);
    }
    if (sxx > 1e-12) b = Math.min(1.5, Math.max(0.1, sxy / sxx));
  }
  const a = Math.exp(my - b * mx);
  return { a, b, min: Math.min(...pts.map((p) => p.numeric)), max: Math.max(...pts.map((p) => p.numeric)), points: n };
}

export function speedAtSetting(curve: PowerCurve, numeric: number): number {
  return curve.a * numeric ** curve.b;
}
