import { describe, expect, it } from 'vitest';
import { toRad } from '../src/core/angles';
import { bearing, fromEnu, latToTileY, lonToTileX, pixelSizeM, tileXToLon, tileYToLat, toEnu } from '../src/core/geo';
import { createRng } from '../src/core/random';

describe('geo', () => {
  it('ENU round trip stays under 1 mm within 2 km', () => {
    const rng = createRng(1);
    for (let n = 0; n < 1000; n++) {
      const origin = { lat: toRad(-70 + 140 * rng.next()), lon: toRad(-180 + 360 * rng.next()) };
      const x = (rng.next() * 2 - 1) * 2000;
      const y = (rng.next() * 2 - 1) * 2000;
      const p = fromEnu(origin, x, y);
      const e = toEnu(origin, p);
      expect(Math.hypot(e.x - x, e.y - y)).toBeLessThan(1e-3);
    }
  });

  it('bearings are clockwise from north', () => {
    const o = { lat: toRad(52), lon: toRad(-1) };
    expect(bearing(o, fromEnu(o, 0, 100))).toBeCloseTo(0, 9);
    expect(bearing(o, fromEnu(o, 100, 0))).toBeCloseTo(Math.PI / 2, 9);
    expect(bearing(o, fromEnu(o, -100, 0))).toBeCloseTo((3 * Math.PI) / 2, 9);
  });

  it('Web Mercator tile maths', () => {
    expect(lonToTileX(0, 15)).toBeCloseTo(2 ** 14, 9);
    expect(latToTileY(0, 15)).toBeCloseTo(2 ** 14, 9);
    const lat = toRad(51.5);
    const lon = toRad(-0.12);
    expect(tileYToLat(latToTileY(lat, 15), 15)).toBeCloseTo(lat, 12);
    expect(tileXToLon(lonToTileX(lon, 15), 15)).toBeCloseTo(lon, 12);
    // About 2.9 m per pixel at zoom 15 at UK latitudes.
    expect(pixelSizeM(toRad(52), 15)).toBeGreaterThan(2.8);
    expect(pixelSizeM(toRad(52), 15)).toBeLessThan(3.0);
  });
});
