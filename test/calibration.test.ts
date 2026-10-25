import { describe, expect, it } from 'vitest';
import { toDeg, toRad } from '../src/core/angles';
import { dragFactor } from '../src/core/atmosphere';
import { horizontalRange, simulate } from '../src/core/ballistics';
import { fitCalibration, fitPowerCurve, simulateShot, speedAtSetting, type CalShot } from '../src/core/calibration';
import { createRng } from '../src/core/random';

const K = dragFactor(1.225, 0.6, 0.05, 0.15);
const TRUE_V0 = 42;
const TRUE_C = 1.2;
const TRUE_BIAS = toRad(2);
const START = { v0: { p: 40 }, dragScale: { pot: 1 }, headingBias: { s: 0 } };

interface Noise {
  speed: number;
  mark: number;
  timing: number;
}

function makeShots(elevationsDeg: number[], seed: number, noise: Noise, timed = true, sigmaM = 2): CalShot[] {
  const rng = createRng(seed);
  return elevationsDeg.map((el, i) => {
    const azimuth = rng.next() * 2 * Math.PI;
    const v0 = TRUE_V0 * (1 + noise.speed * rng.normal());
    const shot: CalShot = {
      id: `shot${i}`,
      setting: 'p',
      projectile: 'pot',
      session: 's',
      elevation: toRad(el),
      azimuth, // what the compass said
      h0: 1,
      kUnit: K,
      wind: [0, 0, 0],
      impact: { x: 0, y: 0, z: 0 },
      sigmaM,
    };
    // Truth: the barrel really pointed TRUE_BIAS clockwise of the compass reading.
    const r = simulateShot(shot, v0, TRUE_C, TRUE_BIAS);
    shot.impact = { x: r.impact[0] + noise.mark * rng.normal(), y: r.impact[1] + noise.mark * rng.normal(), z: 0 };
    if (timed) shot.flightTime = r.tof + noise.timing * rng.normal();
    return shot;
  });
}

const rangeAt = (v0: number, c: number, elDeg: number) => horizontalRange(simulate({ v0, elevation: toRad(elDeg), azimuth: 0, k: K * c, h0: 1 }));

describe('calibration', () => {
  it('noiseless: recovers v0 42 m/s, drag scale 1.2 and heading bias 2° within 1%', () => {
    // Precise (walked, σ 0.5 m) marks. With map-tap σ 2 m the ln c prior alone pulls the drag
    // scale ~1.4% towards 1 on 9 shots; the prior is by design, so the mechanics test uses
    // marks precise enough for the data to dominate.
    const shots = makeShots([20, 28, 36, 44, 52, 60], 5, { speed: 0, mark: 0, timing: 0 }, true, 0.5);
    const fit = fitCalibration(shots, START);
    expect(fit.converged).toBe(true);
    expect(Math.abs(fit.v0.p!.value / TRUE_V0 - 1)).toBeLessThan(0.01);
    expect(Math.abs(fit.dragScale.pot!.value / TRUE_C - 1)).toBeLessThan(0.01);
    expect(Math.abs(fit.headingBias.s!.value / TRUE_BIAS - 1)).toBeLessThan(0.01);
    expect(fit.v0.p!.fitted && fit.dragScale.pot!.fitted && fit.headingBias.s!.fitted).toBe(true);
  });

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`realistic (seed ${seed}): bias within 1°, range at 35° and 55° within 5 m`, () => {
      const shots = makeShots([20, 28, 36, 44, 52, 60], seed, { speed: 0.03, mark: 1.5, timing: 0.1 });
      const fit = fitCalibration(shots, START);
      expect(Math.abs(toDeg(fit.headingBias.s!.value - TRUE_BIAS))).toBeLessThan(1);
      const v0 = fit.v0.p!.value;
      const c = fit.dragScale.pot!.value;
      for (const el of [35, 55]) expect(Math.abs(rangeAt(v0, c, el) - rangeAt(TRUE_V0, TRUE_C, el))).toBeLessThan(5);
      expect(Number.isFinite(fit.v0.p!.se)).toBe(true);
      expect(fit.speedScatter.p!.sigma).toBeGreaterThan(0);
      expect(fit.residuals).toHaveLength(6);
    });
  }

  it('guards: holds v0 with 1 shot, drag scale at 1 under 3 shots, bias with 1 shot per session', () => {
    const shots = makeShots([30, 50], 9, { speed: 0, mark: 0, timing: 0 });
    shots[1]!.setting = 'other';
    shots[1]!.session = 's2';
    const fit = fitCalibration(shots, { v0: { p: 40, other: 40 }, dragScale: { pot: 1.4 }, headingBias: {} });
    expect(fit.v0.p!.fitted).toBe(false);
    expect(fit.v0.p!.reason).toMatch(/2 shots/);
    expect(fit.dragScale.pot!.fitted).toBe(false);
    expect(fit.dragScale.pot!.value).toBe(1);
    expect(fit.headingBias.s!.fitted).toBe(false);
    expect(fit.headingBias.s!.value).toBe(0);
  });

  it('guards: holds drag scale when shots span under 15° and none are timed', () => {
    const shots = makeShots([40, 45, 50, 52], 11, { speed: 0, mark: 0, timing: 0 }, false);
    const fit = fitCalibration(shots, START);
    expect(fit.dragScale.pot!.fitted).toBe(false);
    expect(fit.dragScale.pot!.reason).toMatch(/15°/);
    expect(fit.v0.p!.fitted).toBe(true);
  });

  it('stays inside bounds with untimed shots at similar angles', () => {
    const shots = makeShots([40, 44, 48, 52, 56], 13, { speed: 0.03, mark: 1.5, timing: 0 }, false);
    shots[0]!.elevation = toRad(25); // span ≥ 15° so drag is free, but no flight times
    const fit = fitCalibration(shots, START);
    expect(fit.v0.p!.value).toBeGreaterThanOrEqual(5);
    expect(fit.v0.p!.value).toBeLessThanOrEqual(150);
    expect(fit.dragScale.pot!.value).toBeGreaterThanOrEqual(0.3);
    expect(fit.dragScale.pot!.value).toBeLessThanOrEqual(3);
  });

  it('fits speed against pressure as a power law', () => {
    const truth = (p: number) => 6 * p ** 0.45;
    const c = fitPowerCurve([40, 60, 90].map((p) => ({ numeric: p, v0: truth(p) })))!;
    expect(c.b).toBeCloseTo(0.45, 10);
    expect(speedAtSetting(c, 75)).toBeCloseTo(truth(75), 8);
    expect([c.min, c.max, c.points]).toEqual([40, 90, 3]);
    // One calibrated setting: speed scales with √pressure.
    const one = fitPowerCurve([{ numeric: 60, v0: 40 }])!;
    expect(speedAtSetting(one, 15)).toBeCloseTo(20, 10);
    expect(fitPowerCurve([])).toBeNull();
  });
});

describe('calibration bounds', () => {
  it('flags a value pinned at its bound', () => {
    // Flight times far shorter than any physical solution force the drag scale to its floor.
    const shots = makeShots([25, 35, 45, 55], 21, { speed: 0, mark: 0, timing: 0 });
    for (const s of shots) s.flightTime = s.flightTime! * 0.4;
    const fit = fitCalibration(shots, START);
    const atBound = [fit.v0.p!, fit.dragScale.pot!].some((v) => v.atBound);
    expect(atBound).toBe(true);
  });
});

describe('calibration with potato weights', () => {
  it('recovers the reference-weight speed when speed depends on weight (same energy)', () => {
    const mRef = 0.15;
    const rng = createRng(31);
    const vRef = 45;
    const shots: CalShot[] = [20, 28, 36, 44, 52, 60].map((el, i) => {
      const m = 0.1 + 0.1 * rng.next(); // 100–200 g potatoes
      const shot: CalShot = {
        id: `w${i}`,
        setting: 'p',
        projectile: 'pot',
        session: 's',
        elevation: toRad(el),
        azimuth: rng.next() * 2 * Math.PI,
        h0: 1,
        kUnit: dragFactor(1.225, 0.6, 0.05, m), // lighter potatoes slow down more
        speedScale: Math.sqrt(mRef / m),
        wind: [0, 0, 0],
        impact: { x: 0, y: 0, z: 0 },
        sigmaM: 0.5,
      };
      const r = simulateShot(shot, vRef, 1, 0);
      shot.impact = { x: r.impact[0], y: r.impact[1], z: 0 };
      shot.flightTime = r.tof;
      return shot;
    });
    const fit = fitCalibration(shots, { v0: { p: 40 }, dragScale: { pot: 1 }, headingBias: {} });
    expect(Math.abs(fit.v0.p!.value / vRef - 1)).toBeLessThan(0.01);
    // Each shot's implied speed comes back in reference-weight units too.
    for (const s of fit.speedScatter.p!.perShot) expect(Math.abs(s.v0 / vRef - 1)).toBeLessThan(0.01);
  });
});
