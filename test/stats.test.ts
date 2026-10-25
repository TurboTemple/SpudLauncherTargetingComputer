import { describe, expect, it } from 'vitest';
import { missStats } from '../src/core/stats';

describe('miss statistics', () => {
  it('bias, spread and radial percentiles', () => {
    const s = missStats([
      { down: 3, cross: 4 }, // 5
      { down: -1, cross: 0 }, // 1
      { down: 0, cross: 2 }, // 2
      { down: 6, cross: 8 }, // 10
    ]);
    expect(s.n).toBe(4);
    expect(s.meanDown).toBe(2);
    expect(s.meanCross).toBe(3.5);
    expect(s.cep).toBeCloseTo(3.5, 12); // median of 1, 2, 5, 10
    expect(s.r90).toBeCloseTo(8.5, 12);
    expect(s.sdDown).toBeCloseTo(Math.sqrt(((3 - 2) ** 2 + 9 + 4 + 16) / 3), 12);
  });
  it('handles too few shots', () => {
    expect(missStats([]).n).toBe(0);
    expect(Number.isNaN(missStats([{ down: 1, cross: 1 }]).sdDown)).toBe(true);
  });
});
