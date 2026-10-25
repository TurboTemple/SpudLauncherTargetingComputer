import { describe, expect, it } from 'vitest';
import { toDeg, toRad, wrapTau } from '../src/core/angles';
import { CircularEma, HeadingJumpDetector, SteadinessDetector, VectorEma } from '../src/core/filters';
import { aimToDirection, directionToAim } from '../src/core/orientation';
import { createRng } from '../src/core/random';

describe('filters', () => {
  it('smoothing the vector never glitches across 359° → 0°', () => {
    const ema = new VectorEma(0.15);
    let t = 0;
    for (const azDeg of [358, 359, 359.5, 0, 0.5, 1, 359, 0.2]) {
      t += 0.02;
      const d = ema.update(aimToDirection({ elevation: toRad(30), azimuth: toRad(azDeg) }), t);
      const az = toDeg(directionToAim(d).azimuth);
      expect(Math.min(az, 360 - az)).toBeLessThan(3);
      expect(Math.hypot(...d)).toBeCloseTo(1, 12);
    }
  });

  it('EMA weight follows 1 − e^(−Δt/τ)', () => {
    const ema = new VectorEma(0.15);
    ema.update([0, 1, 0], 0);
    const d = ema.update([1, 0, 0], 0.15);
    const w = 1 - Math.exp(-1);
    const n = Math.hypot(w, 1 - w);
    expect(d[0]).toBeCloseTo(w / n, 12);
  });

  it('detects steadiness from elevation and azimuth spread', () => {
    const rng = createRng(5);
    const calm = new SteadinessDetector();
    let s = calm.push(0, 0, 0);
    for (let i = 1; i <= 60; i++) s = calm.push(i * 0.02, toRad(30 + 0.05 * rng.normal()), wrapTau(toRad(0.2 * rng.normal())));
    expect(s.steady).toBe(true);
    expect(s.steadyFor).toBeGreaterThan(0.5);
    const shaky = new SteadinessDetector();
    for (let i = 0; i <= 60; i++) s = shaky.push(i * 0.02, toRad(30 + 0.5 * rng.normal()), toRad(10));
    expect(s.steady).toBe(false);
  });

  it('circular EMA wraps through north', () => {
    const c = new CircularEma(2);
    c.update(toRad(350), 0);
    const v = c.update(toRad(10), 2);
    const deg = toDeg(v);
    expect(Math.min(deg, 360 - deg)).toBeLessThan(10);
  });

  it('warns when heading jumps while tilt holds', () => {
    const j = new HeadingJumpDetector();
    expect(j.push(0, toRad(30), toRad(10))).toBe(false);
    expect(j.push(0.1, toRad(30.05), toRad(17))).toBe(true);
    const k = new HeadingJumpDetector();
    k.push(0, toRad(30), toRad(10));
    expect(k.push(0.1, toRad(32), toRad(17))).toBe(false);
  });
});
