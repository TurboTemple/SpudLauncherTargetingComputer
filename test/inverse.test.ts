import { describe, expect, it } from 'vitest';
import { toDeg, toRad } from '../src/core/angles';
import { dragFactor, windVector } from '../src/core/atmosphere';
import { simulate } from '../src/core/ballistics';
import { solveTarget, type BaseLaunch } from '../src/core/inverse';
import { createRng } from '../src/core/random';

const K = dragFactor(1.225, 0.6, 0.05, 0.15);
const base: BaseLaunch = { v0: 40, k: K, h0: 1 };

describe('inverse solver', () => {
  it('target 60 m at 40 m/s: low 12.40° (1.78 s), high 72.18° (6.72 s)', () => {
    const s = solveTarget(base, { x: 0, y: 60, z: 0 });
    expect(s.reachable).toBe(true);
    expect(Math.abs(toDeg(s.low!.elevation) - 12.4)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(toDeg(s.high!.elevation) - 72.18)).toBeLessThanOrEqual(0.01);
    expect(s.low!.tof).toBeCloseTo(1.78, 2);
    expect(s.high!.tof).toBeCloseTo(6.72, 2);
    expect(s.low!.groundInWay).toBe(false);
  });

  it('max-reach elevation: 41.34° for 106.05 m at 40 m/s; 39.04° for 172.56 m at 60 m/s', () => {
    const a = solveTarget(base, { x: 0, y: 1000, z: 0 });
    expect(a.reachable).toBe(false);
    expect(Math.abs(toDeg(a.thetaMax) - 41.34)).toBeLessThan(0.02);
    expect(Math.abs(a.maxReach - 106.05)).toBeLessThan(0.05);
    const b = solveTarget({ ...base, v0: 60 }, { x: 0, y: 1000, z: 0 });
    expect(Math.abs(toDeg(b.thetaMax) - 39.04)).toBeLessThan(0.02);
    expect(Math.abs(b.maxReach - 172.56)).toBeLessThan(0.05);
  });

  it('50 random reachable targets round-trip to under 0.1 m miss', () => {
    const rng = createRng(42);
    let tested = 0;
    let attempts = 0;
    while (tested < 50 && attempts < 200) {
      attempts++;
      const v0 = 20 + rng.next() * 60;
      const wind = windVector(rng.next() * 6, rng.next() * 2 * Math.PI);
      const b: BaseLaunch = { v0, k: K, h0: 1, wind };
      const d = 10 + rng.next() * 150;
      const brg = rng.next() * 2 * Math.PI;
      const target = { x: d * Math.sin(brg), y: d * Math.cos(brg), z: (rng.next() * 2 - 1) * 8 };
      const s = solveTarget(b, target);
      if (!s.reachable) continue;
      tested++;
      for (const arc of [s.low, s.high]) {
        if (!arc) continue;
        // Where the path passes the target's distance, compared with the target itself.
        const r = simulate(
          { ...b, elevation: arc.elevation, azimuth: arc.azimuth },
          { ground: () => -100, downrange: { bearing: s.bearing, distance: s.distance } },
        );
        expect(r.stop).toBe('downrange');
        const miss = Math.hypot(r.impact[0] - target.x, r.impact[1] - target.y, r.impact[2] - target.z);
        expect(miss).toBeLessThan(0.1);
      }
      expect(s.low ?? s.high).not.toBeNull();
    }
    expect(tested).toBe(50);
  });

  it('corrects azimuth for crosswind', () => {
    const b: BaseLaunch = { ...base, wind: windVector(5, toRad(270)) }; // from the west
    const s = solveTarget(b, { x: 0, y: 80, z: 0 });
    // Wind pushes east, so aim west of north.
    expect(toDeg(s.low!.azimuth)).toBeGreaterThan(180);
    expect(Math.abs(s.low!.crossMiss)).toBeLessThan(0.1);
    expect(Math.abs(s.low!.heightMiss)).toBeLessThan(0.05);
    expect(s.high!.rounds).toBeGreaterThan(1);
  });

  it('flags ground in the way', () => {
    // A 20 m wall halfway to the target.
    const wall = (_x: number, y: number) => (y > 25 && y < 30 ? 20 : 0);
    const s = solveTarget(base, { x: 0, y: 60, z: 0 }, { ground: wall });
    expect(s.low!.groundInWay).toBe(true);
    expect(s.high!.groundInWay).toBe(false);
  });

  it('handles targets above the launch point, including hits on the way up', () => {
    const s = solveTarget(base, { x: -20, y: -15, z: 6 });
    expect(s.reachable).toBe(true);
    expect(s.low!.ascending).toBe(true);
    expect(s.high!.ascending).toBe(false);
    const r = simulate({ ...base, elevation: s.high!.elevation, azimuth: s.high!.azimuth }, { plane: 6 });
    expect(Math.hypot(r.impact[0] + 20, r.impact[1] + 15)).toBeLessThan(0.1);
    // Too close for a high arc under 85°.
    const near = solveTarget({ ...base, v0: 56 }, { x: -16, y: -5, z: 3.3 });
    expect(near.low!.ascending).toBe(true);
    expect(near.high).toBeNull();
    expect(near.notes.join(' ')).toMatch(/high arc/);
  });
});
