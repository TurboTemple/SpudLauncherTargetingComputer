/** UI-edge conversions between degree lat/lon (storage, Leaflet) and the radian core frame. */

import { DEG } from './core/angles';
import { fromEnu, toEnu, type Geo } from './core/geo';

export interface LatLon {
  lat: number;
  lon: number;
}

export const geoOf = (p: LatLon): Geo => ({ lat: p.lat * DEG, lon: p.lon * DEG });

/** ENU (m) of p relative to origin, both in degrees. */
export function enuOf(origin: LatLon, p: LatLon): { x: number; y: number } {
  return toEnu(geoOf(origin), geoOf(p));
}

/** Degrees lat/lon of an ENU offset from origin. */
export function latLonOf(origin: LatLon, x: number, y: number): LatLon {
  const g = fromEnu(geoOf(origin), x, y);
  return { lat: g.lat / DEG, lon: g.lon / DEG };
}

export function distanceM(a: LatLon, b: LatLon): number {
  const e = enuOf(a, b);
  return Math.hypot(e.x, e.y);
}
