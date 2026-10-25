/**
 * Fetch and decode Terrarium tiles (runs inside the worker). Tiles reach the Workbox runtime
 * cache through the normal fetch path, so a field opened once keeps working offline.
 * If tiles are missing or pixel reads are blocked (CORS), the caller falls back to flat ground.
 */

import type { Geo } from '../core/geo';
import { TILE_SIZE } from '../core/geo';
import { buildHeightGrid, decodeTerrariumPixels, tileBlockAround, TERRAIN_ZOOM, type BuiltGrid, type TerrainTile } from '../core/terrain';

export const TERRAIN_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRAIN_ATTRIBUTION =
  'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> (Mapzen, USGS, Copernicus and others)';

/** Largest grid half-size, m; the 3 × 3 block guarantees ≥ ~750 m, the grid stays ≤ 1 km. */
const MAX_HALF_SIZE = 1000;

export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

async function fetchTile(template: string, z: number, tx: number, ty: number): Promise<TerrainTile> {
  try {
    const res = await fetch(tileUrl(template, z, tx, ty), { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    // Throws a SecurityError if the image is cross-origin without CORS.
    const img = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
    return { z, tx, ty, heights: decodeTerrariumPixels(img.data) };
  } catch {
    return { z, tx, ty, heights: null };
  }
}

export async function loadTerrainGrid(origin: Geo, template = TERRAIN_TILE_URL): Promise<(BuiltGrid & { halfSizeM: number }) | null> {
  const { tiles: ids, reachM } = tileBlockAround(origin, TERRAIN_ZOOM);
  const tiles = await Promise.all(ids.map(({ tx, ty }) => fetchTile(template, TERRAIN_ZOOM, tx, ty)));
  if (tiles.every((t) => !t.heights)) return null;
  const halfSizeM = Math.min(MAX_HALF_SIZE, Math.floor(reachM));
  const built = buildHeightGrid(tiles, origin, halfSizeM);
  return built ? { ...built, halfSizeM } : null;
}
