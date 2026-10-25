import { describe, expect, it } from 'vitest';
import { toRad } from '../src/core/angles';
import { dragFactor, windVector } from '../src/core/atmosphere';
import { keepClearFootprint, rangeCard } from '../src/core/footprint';
import { monteCarlo } from '../src/core/uncertainty';

/** Ray-casting point-in-polygon, as the map draws the footprint. */
function inside(x: number, y: number, poly: readonly { x: number; y: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

const K = dragFactor(1.225, 0.6, 0.05, 0.15);
const c = { v0: 40, k: K, h0: 1 };

describe('safety footprint', () => {
  it('in still air with no spread it is a circle at the max reach (106.05 m)', () => {
    const f = keepClearFootprint(c, { v0: 0, dragFrac: 0, wind: 0 }, undefined, 30);
    expect(f).toHaveLength(12);
    for (const p of f) expect(p.reach).toBeCloseTo(106.05, 1);
  });

  it('grows with the spreads and stretches downwind', () => {
    const calm = keepClearFootprint(c, { v0: 3.2, dragFrac: 0.1, wind: 1.5 }, undefined, 90);
    for (const p of calm) expect(p.reach).toBeGreaterThan(106.05);
    const windy = keepClearFootprint({ ...c, wind: windVector(5, toRad(270)) }, { v0: 3.2, dragFrac: 0.1, wind: 1.5 }, undefined, 90);
    const east = windy.find((p) => Math.round(p.azimuth / toRad(1)) === 90)!;
    const west = windy.find((p) => Math.round(p.azimuth / toRad(1)) === 270)!;
    expect(east.reach).toBeGreaterThan(west.reach + 10);
  });

  it('contains Monte Carlo landings aimed for maximum reach downwind', () => {
    const wind = windVector(5, toRad(270));
    const f = keepClearFootprint({ ...c, wind }, { v0: 3.2, dragFrac: 0.1, wind: 1.5 });
    const spreads = { elevation: toRad(1), azimuth: toRad(2), v0: 3.2, dragScale: 0.1, windE: 1.5, windN: 1.5, launch: 0 };
    for (const azDeg of [90, 0]) {
      const inp = { v0: 40, elevation: toRad(41), azimuth: toRad(azDeg), dragScale: 1, kUnit: K, wind, h0: 1 };
      const mc = monteCarlo(inp, spreads, 2000, 7);
      let out = 0;
      for (let i = 0; i < 2000; i++) if (!inside(mc.points[2 * i]!, mc.points[2 * i + 1]!, f)) out++;
      expect(out).toBe(0);
    }
  });
});

describe('range card', () => {
  it('matches the reference trajectories and marks the best tilt', () => {
    const rows = rangeCard(c, 0, 0.15);
    expect(rows.find((r) => r.elevationDeg === 45)!.range).toBeCloseTo(105.36, 1);
    expect(rows.find((r) => r.elevationDeg === 30)!.range).toBeCloseTo(99.23, 1);
    const best = rows.find((r) => r.best)!;
    expect(best.elevationDeg).toBeCloseTo(41.3, 0);
    expect(best.range).toBeCloseTo(106.05, 1);
    const r45 = rows.find((r) => r.elevationDeg === 45)!;
    expect(r45.energy).toBeCloseTo(0.5 * 0.15 * 27.43 ** 2, 0);
  });
});
