import { describe, expect, it } from 'vitest';
import { toRad } from '../src/core/angles';
import { dragFactor, windVector } from '../src/core/atmosphere';
import { horizontalRange, simulate, PATH_SAMPLE_INTERVAL, type LaunchParams } from '../src/core/ballistics';

const K = dragFactor(1.225, 0.6, 0.05, 0.15);

interface Ref {
  id: string;
  p: LaunchParams;
  x: number;
  y: number;
  tof: number;
  apex: number;
  vimp: number;
}

const base = { v0: 40, elevation: toRad(45), azimuth: 0, k: K, h0: 1 };
// Reference trajectories from the independent Python solver (RK4, 0.1 ms steps).
const REFS: Ref[] = [
  { id: 'T1', p: { ...base, k: 0, h0: 0 }, x: 0, y: 163.1, tof: 5.766, apex: 40.77, vimp: 40.0 },
  { id: 'T2', p: { ...base, k: 0, elevation: toRad(30) }, x: 0, y: 142.96, tof: 4.127, apex: 21.39, vimp: 40.24 },
  { id: 'T3', p: base, x: 0, y: 105.36, tof: 5.097, apex: 32.48, vimp: 27.43 },
  { id: 'T4', p: { ...base, elevation: toRad(30) }, x: 0, y: 99.23, tof: 3.732, apex: 17.63, vimp: 26.91 },
  { id: 'T5', p: { ...base, v0: 60 }, x: 0, y: 169.89, tof: 6.81, apex: 58.04, vimp: 32.37 },
  { id: 'T6', p: { ...base, wind: windVector(5, 0) }, x: 0, y: 93.81, tof: 5.036, apex: 31.77, vimp: 25.47 },
  { id: 'T7', p: { ...base, wind: windVector(5, toRad(270)) }, x: 6.9, y: 104.98, tof: 5.092, apex: 32.42, vimp: 27.46 },
  { id: 'T8', p: { ...base, azimuth: toRad(90) }, x: 105.36, y: 0, tof: 5.097, apex: 32.48, vimp: 27.43 },
];

describe('reference trajectories T1–T8', () => {
  for (const ref of REFS) {
    it(ref.id, () => {
      const r = simulate(ref.p);
      expect(r.stop).toBe('ground');
      expect(Math.abs(r.impact[0] - ref.x)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(r.impact[1] - ref.y)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(r.tof - ref.tof)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(r.apex[2] - ref.apex)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(r.impactSpeed - ref.vimp)).toBeLessThanOrEqual(0.05);
    });
  }
});

describe('ballistics properties', () => {
  it('T1 and T2 match the textbook no-air formulas', () => {
    const v = 40;
    const g = 9.81;
    const t1 = simulate(REFS[0]!.p);
    expect(t1.impact[1]).toBeCloseTo((v * v) / g, 2);
    const th = toRad(30);
    const vy = v * Math.sin(th);
    const tof = (vy + Math.sqrt(vy * vy + 2 * g * 1)) / g;
    const t2 = simulate(REFS[1]!.p);
    expect(t2.tof).toBeCloseTo(tof, 4);
    expect(t2.impact[1]).toBeCloseTo(v * Math.cos(th) * tof, 3);
  });

  it('with no drag, impact speed equals launch speed when landing at launch height', () => {
    for (const el of [10, 30, 45, 60, 80]) {
      for (const v0 of [5, 40, 100]) {
        const r = simulate({ v0, elevation: toRad(el), azimuth: 0.3, k: 0, h0: 0 });
        expect(r.stop).toBe('ground');
        expect(Math.abs(r.impactSpeed - v0)).toBeLessThan(1e-3 * v0);
      }
    }
  });

  it('drag always shortens range', () => {
    for (const el of [5, 20, 45, 70, 85]) {
      for (const v0 of [10, 40, 100]) {
        const p = { v0, elevation: toRad(el), azimuth: 0, h0: 1 };
        const vac = horizontalRange(simulate({ ...p, k: 0 }));
        const air = horizontalRange(simulate({ ...p, k: K }));
        expect(air).toBeLessThan(vac);
      }
    }
  });

  it('rotating azimuth rotates the impact', () => {
    const r0 = simulate(base);
    const R = r0.impact[1];
    for (const azDeg of [17, 90, 135, 200, 333]) {
      const az = toRad(azDeg);
      const r = simulate({ ...base, azimuth: az });
      expect(r.impact[0]).toBeCloseTo(R * Math.sin(az), 6);
      expect(r.impact[1]).toBeCloseTo(R * Math.cos(az), 6);
    }
  });

  it('10 ms and 0.5 ms steps agree to under 0.1 mm on T3', () => {
    const a = horizontalRange(simulate(base, { dt: 0.01 }));
    const b = horizontalRange(simulate(base, { dt: 0.0005 }));
    expect(Math.abs(a - b)).toBeLessThan(1e-4);
  });

  it('records the path every 20 ms, from the muzzle to the impact', () => {
    const r = simulate(base, { recordPath: true });
    const path = r.path!;
    const n = path.length / 3;
    expect(path[2]).toBe(1);
    expect(n).toBe(Math.floor(r.tof / PATH_SAMPLE_INTERVAL + 1e-6) + 2);
    expect(path[3 * (n - 1) + 1]).toBeCloseTo(r.impact[1], 9);
  });

  it('reports which stop condition fired', () => {
    expect(simulate(base, { tMax: 1 }).stop).toBe('time');
    const pass = simulate(base, { downrange: { bearing: 0, distance: 50 } });
    expect(pass.stop).toBe('downrange');
    expect(pass.impact[1]).toBeCloseTo(50, 9);
    expect(simulate({ ...base, v0: 150, k: 0 }, { maxDistance: 500 }).stop).toBe('distance');
    expect(simulate({ ...base, elevation: toRad(5) }, { plane: 20 }).stop).toBe('unreached');
  });

  it('meets terrain: a rising slope shortens the shot', () => {
    const slope = (_x: number, y: number) => 0.2 * y;
    const flat = simulate(base);
    const hill = simulate(base, { ground: slope });
    expect(hill.impact[1]).toBeLessThan(flat.impact[1]);
    expect(hill.impact[2]).toBeCloseTo(0.2 * hill.impact[1], 2);
  });

  it('runs one forward simulation in well under 1 ms', () => {
    for (let i = 0; i < 50; i++) simulate(base); // warm up the JIT
    const n = 300;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) simulate({ ...base, elevation: toRad(30 + (i % 30)) });
    const per = (performance.now() - t0) / n;
    expect(per).toBeLessThan(1);
  });
});
