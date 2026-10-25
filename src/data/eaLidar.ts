/**
 * Environment Agency LIDAR Composite, 1 m, England (Open Government Licence v3.0), fetched from
 * the EA's OGC WCS as Deflate-compressed GeoTIFF resampled to ~2 m. Two layers: the DTM (bare
 * ground) and the first-return DSM (ground plus trees, hedges and buildings). Runs in the worker.
 */

import { DEG, toDeg } from '../core/angles';
import { EARTH_R, type Geo } from '../core/geo';
import type { GeoSampler } from '../core/terrain';
import { rasterSampler, readTiff, type Inflate } from '../core/tiff';

export const EA_ATTRIBUTION =
  'Ground: <a href="https://environment.data.gov.uk/survey">Environment Agency LIDAR</a> &copy; EA, <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">OGL v3.0</a>';

/** Half-size of the LIDAR area around the launch point, m (about 550 KB per layer). */
export const EA_HALF_SIZE_M = 500;

const LAYERS = {
  dtm: { dataset: '13787b9a-26a4-4775-8523-806d13af58fc', coverage: 'Lidar_Composite_Elevation_DTM_1m' },
  dsm: { dataset: 'df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb', coverage: 'Lidar_Composite_Elevation_FZ_DSM_1m' },
} as const;
export type EaLayer = keyof typeof LAYERS;

/** Rough box around England; outside it there is no EA data, so no request is made. */
export function inEngland(latDeg: number, lonDeg: number): boolean {
  return latDeg > 49.8 && latDeg < 55.9 && lonDeg > -6.5 && lonDeg < 1.9;
}

const SNAP = 0.002; // degrees: nearby launch points share a request, so the offline cache hits

export function eaBbox(origin: Geo, halfM: number): { south: number; west: number; north: number; east: number } {
  const dLat = toDeg(halfM / EARTH_R);
  const dLon = toDeg(halfM / (EARTH_R * Math.cos(origin.lat)));
  const lat = origin.lat / DEG;
  const lon = origin.lon / DEG;
  const down = (v: number) => +(Math.floor(v / SNAP) * SNAP).toFixed(4);
  const up = (v: number) => +(Math.ceil(v / SNAP) * SNAP).toFixed(4);
  return { south: down(lat - dLat), west: down(lon - dLon), north: up(lat + dLat), east: up(lon + dLon) };
}

export function eaCoverageUrl(layer: EaLayer, b: ReturnType<typeof eaBbox>): string {
  const { dataset, coverage } = LAYERS[layer];
  const crs = 'http://www.opengis.net/def/crs/EPSG/0/4326';
  return (
    `https://environment.data.gov.uk/geoservices/datasets/${dataset}/wcs?service=WCS&version=2.0.1&request=GetCoverage` +
    `&coverageId=${dataset}__${coverage}&subset=Lat(${b.south},${b.north})&subset=Long(${b.west},${b.east})` +
    `&subsettingCrs=${crs}&outputCrs=${crs}&format=image/tiff&scalefactor=0.5&geotiff:compression=Deflate`
  );
}

const inflate: Inflate = async (bytes) => {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** One LIDAR layer around a point as an absolute-height sampler, or null if there is no data. */
export async function loadEaLayer(layer: EaLayer, origin: Geo, halfM = EA_HALF_SIZE_M): Promise<GeoSampler | null> {
  try {
    const res = await fetch(eaCoverageUrl(layer, eaBbox(origin, halfM)), { mode: 'cors' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('tiff')) return null;
    const raster = await readTiff(await res.arrayBuffer(), inflate);
    let valid = 0;
    for (const v of raster.data) if (!Number.isNaN(v)) valid++;
    if (valid < raster.data.length * 0.01) return null;
    const s = rasterSampler(raster);
    return (p) => s(p.lon / DEG, p.lat / DEG);
  } catch {
    return null;
  }
}
