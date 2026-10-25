import { describe, expect, it } from 'vitest';
import { angleDiff, toDeg, toRad } from '../src/core/angles';
import { barrelDirection, mountOffsetFromReversal, orientationToAim, rotationMatrix } from '../src/core/orientation';
import { createRng } from '../src/core/random';

const TABLE: [number, number, number, number, number][] = [
  // α, β, γ (deg) → elevation, azimuth (deg)
  [0, 0, 0, 0, 0],
  [0, 30, 0, 30, 0],
  [90, 30, 0, 30, 270],
  [270, 10, 0, 10, 90],
  [0, 30, 20, 30, 0],
  [45, 60, -15, 60, 315],
];

describe('orientation → barrel', () => {
  for (const [a, b, g, el, az] of TABLE) {
    it(`α=${a} β=${b} γ=${g} → ${el}°, ${az}°`, () => {
      const aim = orientationToAim(toRad(a), toRad(b), toRad(g));
      expect(toDeg(aim.elevation)).toBeCloseTo(el, 6);
      expect(Math.abs(toDeg(angleDiff(aim.azimuth, toRad(az))))).toBeLessThan(1e-6);
    });
  }

  it('the matrix is a proper rotation', () => {
    const R = rotationMatrix(0.3, -0.7, 1.1);
    const col = (j: number) => [R[j]!, R[3 + j]!, R[6 + j]!];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const d = col(i).reduce((s, v, k) => s + v * col(j)[k]!, 0);
        expect(d).toBeCloseTo(i === j ? 1 : 0, 12);
      }
    }
  });

  it('rolling the phone around the barrel never changes elevation or azimuth (property)', () => {
    const rng = createRng(7);
    for (let n = 0; n < 500; n++) {
      const a = rng.next() * 2 * Math.PI;
      const b = (rng.next() * 2 - 1) * toRad(85);
      const g = (rng.next() * 2 - 1) * Math.PI;
      const roll = (rng.next() * 2 - 1) * Math.PI;
      // Roll about the phone's own y axis: R' = R · Ry(roll), applied to b = (0, 1, 0).
      const R = rotationMatrix(a, b, g);
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      const Ry = [cr, 0, sr, 0, 1, 0, -sr, 0, cr];
      const col1 = [0, 1, 2].map((i) => R[3 * i]! * Ry[1]! + R[3 * i + 1]! * Ry[4]! + R[3 * i + 2]! * Ry[7]!);
      const d = barrelDirection(a, b, g);
      for (let i = 0; i < 3; i++) expect(col1[i]!).toBeCloseTo(d[i]!, 12);
      const aim1 = orientationToAim(a, b, g);
      const aim2 = orientationToAim(a, b, g + roll);
      expect(aim2.elevation).toBeCloseTo(aim1.elevation, 12);
      expect(Math.abs(angleDiff(aim2.azimuth, aim1.azimuth))).toBeLessThan(1e-9);
    }
  });

  it('a reversed mount points the other way', () => {
    const d = barrelDirection(0.4, 0.5, 0.2);
    const r = barrelDirection(0.4, 0.5, 0.2, true);
    for (let i = 0; i < 3; i++) expect(r[i]).toBeCloseTo(-d[i]!, 12);
  });

  it('reversal calibration cancels the surface slope', () => {
    const offset = toRad(1.7);
    const slope = toRad(-3.2);
    const m = mountOffsetFromReversal(slope + offset, -slope + offset);
    expect(m.offset).toBeCloseTo(offset, 12);
    expect(m.slope).toBeCloseTo(slope, 12);
  });
});
