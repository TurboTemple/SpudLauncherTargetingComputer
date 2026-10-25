import { describe, expect, it } from 'vitest';
import { toRad } from '../src/core/angles';
import { fromEnu, latToTileY, lonToTileX, TILE_SIZE } from '../src/core/geo';
import { createRng } from '../src/core/random';
import { buildBlendedGrid, buildHeightGrid, buildSurfaceGrid, decodeTerrarium, findObstacle, decodeTerrariumPixels, HeightGrid, tileBlockAround, type TerrainTile } from '../src/core/terrain';

describe('terrain', () => {
  it('Terrarium decode', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 128)).toBe(100.5);
    const px = decodeTerrariumPixels(new Uint8ClampedArray([128, 0, 0, 255, 128, 100, 128, 255]));
    expect(Array.from(px)).toEqual([0, 100.5]);
  });

  it('bilinear sampling of a synthetic plane z = 0.1x is exact', () => {
    const nx = 101;
    const ny = 61;
    const spacing = 2;
    const x0 = -100;
    const y0 = -60;
    const data = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) data[j * nx + i] = 0.1 * (x0 + i * spacing);
    const g = new HeightGrid(x0, y0, spacing, nx, ny, data);
    const rng = createRng(3);
    for (let n = 0; n < 200; n++) {
      const x = x0 + rng.next() * (nx - 1) * spacing;
      const y = y0 + rng.next() * (ny - 1) * spacing;
      expect(g.sample(x, y)).toBeCloseTo(0.1 * x, 5);
    }
    // Clamped at the edges.
    expect(g.sample(1e6, 0)).toBeCloseTo(0.1 * (x0 + (nx - 1) * spacing), 5);
  });

  it('builds a launch-relative ENU grid from a tile block', () => {
    const origin = { lat: toRad(52.2), lon: toRad(-1.5) };
    const { tiles: ids, reachM } = tileBlockAround(origin);
    expect(ids).toHaveLength(9);
    expect(reachM).toBeGreaterThan(700);
    // Synthetic terrain rising 0.5 m per global pixel eastwards, 100 m at the launch point.
    const gx0 = lonToTileX(origin.lon, 15) * TILE_SIZE - 0.5;
    const tiles: TerrainTile[] = ids.map(({ tx, ty }) => {
      const h = new Float32Array(TILE_SIZE * TILE_SIZE);
      for (let j = 0; j < TILE_SIZE; j++) for (let i = 0; i < TILE_SIZE; i++) h[j * TILE_SIZE + i] = 100 + 0.5 * (tx * TILE_SIZE + i - gx0);
      return { z: 15, tx, ty, heights: h };
    });
    const built = buildHeightGrid(tiles, origin, 300)!;
    expect(built.coverage).toBe(1);
    expect(built.launchGroundM).toBeCloseTo(100, 3);
    expect(built.grid.sample(0, 0)).toBeCloseTo(0, 3);
    // 100 m east is ~100/pixelSize pixels → 0.5 m per pixel.
    const p = fromEnu(origin, 100, 0);
    const pixels = lonToTileX(p.lon, 15) * TILE_SIZE - (gx0 + 0.5);
    expect(built.grid.sample(100, 0)).toBeCloseTo(0.5 * pixels, 1);
    expect(built.grid.sample(0, 100)).toBeCloseTo(0, 3);
    expect(latToTileY(origin.lat, 15)).toBeGreaterThan(0);
  });

  it('returns null when the launch point has no data', () => {
    expect(buildHeightGrid([], { lat: 0.9, lon: 0 }, 100)).toBeNull();
  });
});

describe('blended terrain and obstacles', () => {
  const origin = { lat: toRad(52.2), lon: toRad(0.12) };
  const enu = (p: { lat: number; lon: number }) => {
    const R = 6371008.8;
    return { x: R * (p.lon - origin.lon) * Math.cos(origin.lat), y: R * (p.lat - origin.lat) };
  };

  it('uses the fine source where it has data and shifts the coarse one onto its datum', () => {
    // Coarse: a 0.05 slope on a +40 m datum. Fine: same slope, inside 100 m only.
    const coarse = (p: { lat: number; lon: number }) => 40 + 0.05 * enu(p).x;
    const fine = (p: { lat: number; lon: number }) => {
      const e = enu(p);
      return Math.abs(e.x) < 100 && Math.abs(e.y) < 100 ? 0.05 * e.x : NaN;
    };
    const b = buildBlendedGrid(origin, 200, coarse, fine)!;
    expect(b.launchGroundM).toBeCloseTo(0, 6);
    expect(b.fineCoverage).toBeGreaterThan(0.2);
    expect(b.fineCoverage).toBeLessThan(0.3);
    // Continuous across the edge of the fine data: 0.05 × x everywhere.
    for (const x of [-150, -50, 0, 99, 101, 150]) expect(b.grid.sample(x, 20)).toBeCloseTo(0.05 * x, 3);
  });

  it('falls back to either source alone', () => {
    expect(buildBlendedGrid(origin, 50, () => 12, null)!.launchGroundM).toBe(12);
    expect(buildBlendedGrid(origin, 50, null, () => 7)!.launchGroundM).toBe(7);
    expect(buildBlendedGrid(origin, 50, null, null)).toBeNull();
  });

  it('finds a hedge in the flight path and ignores clear air above it', () => {
    const flat = () => 0;
    // A 3 m hedge across the line of fire, 40–42 m north.
    const surfaceAbs = (p: { lat: number; lon: number }) => {
      const y = enu(p).y;
      return y > 40 && y < 42 ? 3 : 0;
    };
    const surface = buildSurfaceGrid(origin, 100, surfaceAbs, 0, flat, 1);
    const low = new Float64Array([0, 0, 1, 0, 20, 2, 0, 41, 1.5, 0, 60, 0.5]);
    const o = findObstacle(low, surface, flat)!;
    expect(o.distance).toBeCloseTo(41, 6);
    expect(o.featureHeight).toBeGreaterThan(2);
    const high = new Float64Array([0, 0, 1, 0, 20, 8, 0, 41, 9, 0, 60, 0.5]);
    expect(findObstacle(high, surface, flat)).toBeNull();
  });
});
