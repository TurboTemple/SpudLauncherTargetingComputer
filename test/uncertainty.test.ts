import { describe, expect, it } from 'vitest';
import { toRad } from '../src/core/angles';
import { dragFactor } from '../src/core/atmosphere';
import { horizontalRange, simulate } from '../src/core/ballistics';
import { eigSym2, ellipseScale, linearZone, monteCarlo, sensitivities, type Spreads, type ZoneInputs } from '../src/core/uncertainty';

const K = dragFactor(1.225, 0.6, 0.05, 0.15);
const inp: ZoneInputs = { v0: 40, elevation: toRad(45), azimuth: 0, dragScale: 1, kUnit: K, wind: [0, 0, 0], h0: 1 };

describe('uncertainty', () => {
  it('ellipse scales: 50% 1.1774, 90% 2.1460, 95% 2.4477', () => {
    expect(ellipseScale(0.5)).toBeCloseTo(1.1774, 4);
    expect(ellipseScale(0.9)).toBeCloseTo(2.146, 4);
    expect(ellipseScale(0.95)).toBeCloseTo(2.4477, 4);
  });

  it('eigen-decomposes a 2 × 2 covariance', () => {
    const e = eigSym2({ xx: 4, xy: 0, yy: 1 });
    expect(e.l1).toBeCloseTo(4, 12);
    expect(e.l2).toBeCloseTo(1, 12);
    expect(Math.abs(e.v1[0])).toBeCloseTo(1, 12);
    const r = eigSym2({ xx: 2, xy: 1, yy: 2 });
    expect(r.l1).toBeCloseTo(3, 12);
    expect(r.l2).toBeCloseTo(1, 12);
    expect(Math.abs(r.v1[0])).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('sensitivities at 40 m/s, 45°: +1 m/s → +3.48 m; 3° of heading → 5.5 m sideways', () => {
    const z = linearZone(inp, { elevation: 0, azimuth: 0, v0: 1, dragScale: 0, windE: 0, windN: 0, launch: 0 });
    const s = sensitivities(z.J, inp.azimuth);
    expect(s.rangePerV0).toBeCloseTo(3.48, 1);
    expect(3 * s.sidePerDegHeading).toBeCloseTo(5.5, 1);
    expect(z.contributions[0]!.key).toBe('v0');
  });

  it('near θ_max, one extra degree changes range by 0.43 m at 45° against 1.16 m at 30°', () => {
    const range = (deg: number) => horizontalRange(simulate({ v0: 40, elevation: toRad(deg), azimuth: 0, k: K, h0: 1 }));
    expect(Math.abs(range(46) - range(45))).toBeCloseTo(0.43, 2);
    expect(Math.abs(range(31) - range(30))).toBeCloseTo(1.16, 2);
    // The live sensitivity is the local derivative, smaller than the 1° step near θ_max.
    const at45 = sensitivities(linearZone(inp, zeroSpreads()).J, 0);
    expect(Math.abs(at45.rangePerDegTilt)).toBeLessThan(0.43);
  });

  it('for small spreads the 90% ellipse holds 85–95% of 2,000 Monte Carlo samples', () => {
    const spreads: Spreads = { elevation: toRad(0.1), azimuth: toRad(0.3), v0: 0.3, dragScale: 0.01, windE: 0.2, windN: 0.2, launch: 0.2 };
    const z = linearZone(inp, spreads);
    const mc = monteCarlo(inp, spreads, 2000, 1234, undefined, { mean: z.mean, cov: z.cov, probability: 0.9 });
    expect(mc.insideShare!).toBeGreaterThanOrEqual(0.85);
    expect(mc.insideShare!).toBeLessThanOrEqual(0.95);
    // Sample covariance agrees with the linear estimate to ~10%.
    expect(mc.cov.yy / z.cov.yy).toBeGreaterThan(0.9);
    expect(mc.cov.yy / z.cov.yy).toBeLessThan(1.1);
  });

  it('Monte Carlo is repeatable for a seed', () => {
    const spreads: Spreads = { elevation: toRad(0.3), azimuth: toRad(3), v0: 3.2, dragScale: 0.1, windE: 1.5, windN: 1.5, launch: 1 };
    const a = monteCarlo(inp, spreads, 50, 99);
    const b = monteCarlo(inp, spreads, 50, 99);
    expect(Array.from(a.points)).toEqual(Array.from(b.points));
  });
});

function zeroSpreads(): Spreads {
  return { elevation: 0, azimuth: 0, v0: 0, dragScale: 0, windE: 0, windN: 0, launch: 0 };
}
