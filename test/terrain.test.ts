import { describe, expect, it } from 'vitest';
import { toRad } from '../src/core/angles';
import { fromEnu, latToTileY, lonToTileX, TILE_SIZE } from '../src/core/geo';
import { createRng } from '../src/core/random';
import { buildHeightGrid, decodeTerrarium, decodeTerrariumPixels, HeightGrid, tileBlockAround, type TerrainTile } from '../src/core/terrain';

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
