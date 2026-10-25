/**
 * Terrarium elevation tiles → a local ENU height grid sampled bilinearly by the integrator.
 * The source survey can be coarser than its ~3 m pixels, so this is a smooth ground model:
 * good for hills and dips, blind to hedges, trees and buildings.
 */

import type { GroundFn } from './ballistics';
import { fromEnu, latToTileY, lonToTileX, TILE_SIZE, type Geo } from './geo';

export const TERRAIN_ZOOM = 15;
export const GRID_SPACING = 2;

/** h = (256 R + G + B / 256) − 32768 metres. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Decode an RGBA pixel buffer (e.g. ImageData.data) to heights. */
export function decodeTerrariumPixels(rgba: ArrayLike<number>, out?: Float32Array): Float32Array {
  const n = rgba.length >> 2;
  const h = out ?? new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    h[i] = decodeTerrarium(rgba[j]!, rgba[j + 1]!, rgba[j + 2]!);
  }
  return h;
}

export interface TerrainTile {
  z: number;
  tx: number;
  ty: number;
  /** TILE_SIZE × TILE_SIZE heights, row-major; null if the tile could not be loaded. */
  heights: Float32Array | null;
}

/** Height lookup across a block of tiles in global pixel coordinates at one zoom. */
export class TileMosaic {
  private readonly tiles = new Map<string, Float32Array>();
  constructor(
    readonly zoom: number,
    tiles: readonly TerrainTile[],
  ) {
    for (const t of tiles) {
      if (t.z === zoom && t.heights) this.tiles.set(`${t.tx},${t.ty}`, t.heights);
    }
  }

  get size(): number {
    return this.tiles.size;
  }

  /** Height of integer pixel (ix, iy) in global pixel space, NaN if its tile is missing. */
  pixel(ix: number, iy: number): number {
    const tx = Math.floor(ix / TILE_SIZE);
    const ty = Math.floor(iy / TILE_SIZE);
    const t = this.tiles.get(`${tx},${ty}`);
    if (!t) return NaN;
    return t[(iy - ty * TILE_SIZE) * TILE_SIZE + (ix - tx * TILE_SIZE)]!;
  }

  /** Bilinear height at a geographic position (pixel centres at +0.5). */
  sampleGeo(p: Geo): number {
    const gx = lonToTileX(p.lon, this.zoom) * TILE_SIZE - 0.5;
    const gy = latToTileY(p.lat, this.zoom) * TILE_SIZE - 0.5;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const h00 = this.pixel(ix, iy);
    const h10 = this.pixel(ix + 1, iy);
    const h01 = this.pixel(ix, iy + 1);
    const h11 = this.pixel(ix + 1, iy + 1);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }
}

/** Regular ENU height grid with bilinear sampling, clamped at the edges. */
export class HeightGrid {
  constructor(
    /** ENU x of column 0, m. */
    readonly x0: number,
    /** ENU y of row 0, m. */
    readonly y0: number,
    readonly spacing: number,
    readonly nx: number,
    readonly ny: number,
    /** Row-major heights relative to the launch ground, m. */
    readonly data: Float32Array,
  ) {}

  sample(x: number, y: number): number {
    const { nx, ny, spacing, data } = this;
    let fx = (x - this.x0) / spacing;
    let fy = (y - this.y0) / spacing;
    if (fx < 0) fx = 0;
    else if (fx > nx - 1) fx = nx - 1;
    if (fy < 0) fy = 0;
    else if (fy > ny - 1) fy = ny - 1;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    if (i > nx - 2) i = nx - 2;
    if (j > ny - 2) j = ny - 2;
    const tx = fx - i;
    const ty = fy - j;
    const r0 = j * nx + i;
    const r1 = r0 + nx;
    return (data[r0]! * (1 - tx) + data[r0 + 1]! * tx) * (1 - ty) + (data[r1]! * (1 - tx) + data[r1 + 1]! * tx) * ty;
  }

  /** True if (x, y) lies inside the grid. */
  contains(x: number, y: number): boolean {
    return (
      x >= this.x0 && y >= this.y0 && x <= this.x0 + (this.nx - 1) * this.spacing && y <= this.y0 + (this.ny - 1) * this.spacing
    );
  }

  ground(): GroundFn {
    return (x, y) => this.sample(x, y);
  }
}

export interface BuiltGrid {
  grid: HeightGrid;
  /** Absolute height of the launch point's ground, m above sea level. */
  launchGroundM: number;
  /** Share of grid points that had data (missing ones are set to launch ground). */
  coverage: number;
}

/**
 * Resample tiles once into a square ENU grid centred on the launch point, heights relative to
 * the launch ground. Returns null if the launch point itself has no data.
 */
export function buildHeightGrid(
  tiles: readonly TerrainTile[],
  origin: Geo,
  halfSizeM: number,
  spacing = GRID_SPACING,
  zoom = TERRAIN_ZOOM,
): BuiltGrid | null {
  const mosaic = new TileMosaic(zoom, tiles);
  const launch = mosaic.sampleGeo(origin);
  if (!Number.isFinite(launch)) return null;
  const n = Math.floor((2 * halfSizeM) / spacing) + 1;
  const x0 = -((n - 1) / 2) * spacing;
  const data = new Float32Array(n * n);
  let valid = 0;
  for (let j = 0; j < n; j++) {
    const y = x0 + j * spacing;
    for (let i = 0; i < n; i++) {
      const h = mosaic.sampleGeo(fromEnu(origin, x0 + i * spacing, y));
      if (Number.isFinite(h)) {
        data[j * n + i] = h - launch;
        valid++;
      } else {
        data[j * n + i] = 0;
      }
    }
  }
  return { grid: new HeightGrid(x0, x0, spacing, n, n, data), launchGroundM: launch, coverage: valid / (n * n) };
}

/** Tiles in the 3 × 3 block around a point, and how far the block reaches from it in each direction. */
export function tileBlockAround(p: Geo, zoom = TERRAIN_ZOOM): { tiles: { tx: number; ty: number }[]; reachM: number } {
  const fx = lonToTileX(p.lon, zoom);
  const fy = latToTileY(p.lat, zoom);
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  const tiles: { tx: number; ty: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles.push({ tx: cx + dx, ty: cy + dy });
  // Distance from p to the nearest block edge, in tile units then metres.
  const fracX = fx - cx;
  const fracY = fy - cy;
  const minTiles = Math.min(1 + fracX, 2 - fracX, 1 + fracY, 2 - fracY);
  const tileM = (156543.03 * Math.cos(p.lat) * TILE_SIZE) / 2 ** zoom;
  return { tiles, reachM: minTiles * tileM };
}

/** Ground profile along an azimuth for the side view: distances and heights. */
export function profileAlong(ground: GroundFn, azimuth: number, length: number, step = 2): { d: number[]; h: number[] } {
  const d: number[] = [];
  const h: number[] = [];
  const sx = Math.sin(azimuth);
  const sy = Math.cos(azimuth);
  for (let s = 0; s <= length + 1e-9; s += step) {
    d.push(s);
    h.push(ground(s * sx, s * sy));
  }
  return { d, h };
}

// --- Finer terrain (e.g. 1 m LIDAR) blended over the tile grid, and surface obstacles ------

/** Absolute height (m) at a geographic position; NaN where the source has no data. */
export type GeoSampler = (p: Geo) => number;

/** Median of a sample (for datum offsets between sources). */
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface BlendedGrid extends BuiltGrid {
  /** Share of grid points taken from the fine source. */
  fineCoverage: number;
}

/**
 * Square ENU grid of heights relative to the launch ground: the fine source where it has data,
 * the coarse source elsewhere, shifted by the median difference between the two so there is no
 * step at the edge of the fine data (the sources use different vertical datums).
 */
export function buildBlendedGrid(
  origin: Geo,
  halfSizeM: number,
  coarse: GeoSampler | null,
  fine: GeoSampler | null,
  spacing = GRID_SPACING,
): BlendedGrid | null {
  const fineLaunch = fine ? fine(origin) : NaN;
  const coarseLaunch = coarse ? coarse(origin) : NaN;
  const launch = Number.isFinite(fineLaunch) ? fineLaunch : coarseLaunch;
  if (!Number.isFinite(launch)) return null;
  const n = Math.floor((2 * halfSizeM) / spacing) + 1;
  const x0 = -((n - 1) / 2) * spacing;

  // Datum offset from a sparse sample of points where both sources have data.
  const diffs: number[] = [];
  if (fine && coarse) {
    const stride = Math.max(1, Math.floor(n / 60));
    for (let j = 0; j < n; j += stride)
      for (let i = 0; i < n; i += stride) {
        const g = fromEnu(origin, x0 + i * spacing, x0 + j * spacing);
        const f = fine(g);
        const c = coarse(g);
        if (Number.isFinite(f) && Number.isFinite(c)) diffs.push(c - f);
      }
  }
  const offset = median(diffs);

  const data = new Float32Array(n * n);
  let valid = 0;
  let fromFine = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const g = fromEnu(origin, x0 + i * spacing, x0 + j * spacing);
      const f = fine ? fine(g) : NaN;
      let h: number;
      if (Number.isFinite(f)) {
        h = f;
        fromFine++;
        valid++;
      } else {
        const c = coarse ? coarse(g) : NaN;
        if (Number.isFinite(c)) {
          h = c - offset;
          valid++;
        } else {
          h = launch;
        }
      }
      data[j * n + i] = h - launch;
    }
  }
  return { grid: new HeightGrid(x0, x0, spacing, n, n, data), launchGroundM: launch, coverage: valid / (n * n), fineCoverage: fromFine / (n * n) };
}

/** Surface (ground plus trees, hedges, buildings) relative to the launch ground; ground where unknown. */
export function buildSurfaceGrid(origin: Geo, halfSizeM: number, surface: GeoSampler, launchGroundM: number, ground: GroundFn, spacing = GRID_SPACING): HeightGrid {
  const n = Math.floor((2 * halfSizeM) / spacing) + 1;
  const x0 = -((n - 1) / 2) * spacing;
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * spacing;
      const y = x0 + j * spacing;
      const s = surface(fromEnu(origin, x, y));
      data[j * n + i] = Number.isFinite(s) ? Math.max(s - launchGroundM, ground(x, y)) : ground(x, y);
    }
  }
  return new HeightGrid(x0, x0, spacing, n, n, data);
}

export interface Obstacle {
  /** Horizontal distance from the launch point, m. */
  distance: number;
  x: number;
  y: number;
  /** Height of the potato there, and of the surface it meets (relative to launch ground), m. */
  z: number;
  top: number;
  /** How far the feature stands above the bare ground, m. */
  featureHeight: number;
}

/**
 * First place a path (x, y, z triples) passes below the surface model where the surface
 * stands clear of the bare ground: a tree, hedge or building in the way. Ignores the first few
 * metres (the cannon and whoever is firing it) and points outside the surface grid.
 */
export function findObstacle(
  path: ArrayLike<number>,
  surface: HeightGrid,
  ground: GroundFn,
  opts: { skipNearM?: number; minFeatureM?: number } = {},
): Obstacle | null {
  const skip = opts.skipNearM ?? 3;
  const minFeature = opts.minFeatureM ?? 1; // ignore benches, bins and survey noise
  const ox = path[0]!;
  const oy = path[1]!;
  for (let k = 3; k + 2 < path.length; k += 3) {
    const x = path[k]!;
    const y = path[k + 1]!;
    const z = path[k + 2]!;
    const d = Math.hypot(x - ox, y - oy);
    if (d < skip || !surface.contains(x, y)) continue;
    const top = surface.sample(x, y);
    const g = ground(x, y);
    if (z < top && top - g >= minFeature && z > g) {
      return { distance: d, x, y, z, top, featureHeight: top - g };
    }
  }
  return null;
}
