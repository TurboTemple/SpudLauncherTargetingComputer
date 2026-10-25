import { describe, expect, it } from 'vitest';
import { toRad } from '../src/core/angles';
import { airDensity, dragFactor, KELVIN, shearFactor, terminalSpeed, windFromVector, windVector } from '../src/core/atmosphere';
import { G } from '../src/core/ballistics';

describe('atmosphere', () => {
  it('default k = 0.004811 per metre; terminal speed 45.16 m/s', () => {
    const k = dragFactor(1.225, 0.6, 0.05, 0.15);
    expect(k).toBeCloseTo(0.004811, 6);
    expect(terminalSpeed(k, G)).toBeCloseTo(45.16, 2);
    expect(dragFactor(1.225, 0.6, 0.05, 0.15, 2)).toBeCloseTo(2 * k, 12);
  });

  it('air density at 1013.25 hPa', () => {
    expect(airDensity(101325, KELVIN + 0)).toBeCloseTo(1.2923, 4);
    expect(airDensity(101325, KELVIN + 15)).toBeCloseTo(1.225, 4);
    expect(airDensity(101325, KELVIN + 25)).toBeCloseTo(1.1839, 4);
  });

  it('wind vector uses the blowing-FROM convention', () => {
    const n = windVector(5, 0);
    expect(n[0]).toBeCloseTo(0, 12);
    expect(n[1]).toBeCloseTo(-5, 12);
    const w = windVector(5, toRad(270));
    expect(w[0]).toBeCloseTo(5, 12);
    expect(w[1]).toBeCloseTo(0, 12);
    const back = windFromVector(windVector(3, toRad(123)));
    expect(back.speed).toBeCloseTo(3, 12);
    expect(back.fromRad).toBeCloseTo(toRad(123), 12);
  });

  it('wind shear power law, clamped to at least 1 m', () => {
    expect(shearFactor(10)).toBeCloseTo(1, 12);
    expect(shearFactor(0.2)).toBeCloseTo(Math.pow(0.1, 1 / 7), 12);
    expect(shearFactor(40)).toBeCloseTo(Math.pow(4, 1 / 7), 12);
  });
});
