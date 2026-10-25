/**
 * Lat/lon ↔ local ENU (equirectangular about the launch point) and Web Mercator tile maths.
 * All angles in radians. At ≤ 2 km the flat frame is far more accurate than the sensors.
 */

import { wrapTau } from './angles';

/** Mean Earth radius, m. */
export const EARTH_R = 6371008.8;

/** Geographic position, radians. */
export interface Geo {
  lat: number;
  lon: number;
}

export interface Enu2 {
  x: number;
  y: number;
}

/** x = R (λ − λ0) cos φ0, y = R (φ − φ0). */
export function toEnu(origin: Geo, p: Geo): Enu2 {
  return {
    x: EARTH_R * (p.lon - origin.lon) * Math.cos(origin.lat),
    y: EARTH_R * (p.lat - origin.lat),
  };
}

/** Exact inverse of toEnu. */
export function fromEnu(origin: Geo, x: number, y: number): Geo {
  return {
    lat: origin.lat + y / EARTH_R,
    lon: origin.lon + x / (EARTH_R * Math.cos(origin.lat)),
  };
}

/** Bearing (radians clockwise from true north, [0, 2π)) of an ENU offset. */
export function enuBearing(x: number, y: number): number {
  return wrapTau(Math.atan2(x, y));
}

/** Bearing from origin to p in the local frame. */
export function bearing(origin: Geo, p: Geo): number {
  const e = toEnu(origin, p);
  return enuBearing(e.x, e.y);
}

export function distance(origin: Geo, p: Geo): number {
  const e = toEnu(origin, p);
  return Math.hypot(e.x, e.y);
}

// --- Web Mercator tiles ---------------------------------------------------------------

export const TILE_SIZE = 256;

/** Continuous tile x for longitude (radians) at zoom z: (λ° + 180) / 360 × 2^z. */
export function lonToTileX(lon: number, z: number): number {
  return ((lon / Math.PI + 1) / 2) * 2 ** z;
}

/** Continuous tile y: (1 − ln(tan φ + sec φ) / π) / 2 × 2^z. */
export function latToTileY(lat: number, z: number): number {
  return ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * 2 ** z;
}

export function tileXToLon(tx: number, z: number): number {
  return ((tx / 2 ** z) * 2 - 1) * Math.PI;
}

export function tileYToLat(ty: number, z: number): number {
  const n = Math.PI * (1 - (2 * ty) / 2 ** z);
  return Math.atan(Math.sinh(n));
}

/** Ground size of one pixel, m: 156,543.03 × cos φ / 2^z. */
export function pixelSizeM(lat: number, z: number): number {
  return (156543.03 * Math.cos(lat)) / 2 ** z;
}
