/**
 * Minimal GeoTIFF reader for single-band elevation rasters (what OGC WCS servers return):
 * strips or tiles, little- or big-endian, float32 / int16 / int32, uncompressed or Deflate.
 * Geo-referencing from ModelTransformation or ModelPixelScale + ModelTiepoint, nodata from
 * the GDAL_NODATA tag. Decompression is injected so this module stays free of browser APIs.
 */

/** zlib-wrapped Deflate → raw bytes (DecompressionStream('deflate') in browsers, zlib in Node). */
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

export interface Raster {
  width: number;
  height: number;
  /** Row-major values; nodata is NaN. */
  data: Float32Array;
  /**
   * Pixel-corner affine transform: X = t[0]·col + t[1]·row + t[2], Y = t[3]·col + t[4]·row + t[5]
   * (X = longitude, Y = latitude for EPSG:4326). Pixel centres are at col + 0.5, row + 0.5.
   */
  transform: [number, number, number, number, number, number];
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

export async function readTiff(buf: ArrayBuffer, inflate?: Inflate): Promise<Raster> {
  const dv = new DataView(buf);
  const order = dv.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) throw new Error('Not a TIFF');
  const le = order === 0x4949;
  if (dv.getUint16(2, le) !== 42) throw new Error('Unsupported TIFF (BigTIFF?)');
  const ifd = dv.getUint32(4, le);
  const n = dv.getUint16(ifd, le);
  const tags = new Map<number, number[] | string>();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + 12 * i;
    const tag = dv.getUint16(e, le);
    const type = dv.getUint16(e + 2, le);
    const count = dv.getUint32(e + 4, le);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const at = size <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    if (type === 2) {
      let str = '';
      for (let k = 0; k < count; k++) {
        const ch = dv.getUint8(at + k);
        if (ch === 0) break;
        str += String.fromCharCode(ch);
      }
      tags.set(tag, str);
      continue;
    }
    const vals: number[] = [];
    for (let k = 0; k < count; k++) {
      switch (type) {
        case 1:
        case 7:
          vals.push(dv.getUint8(at + k));
          break;
        case 3:
          vals.push(dv.getUint16(at + 2 * k, le));
          break;
        case 4:
          vals.push(dv.getUint32(at + 4 * k, le));
          break;
        case 8:
          vals.push(dv.getInt16(at + 2 * k, le));
          break;
        case 9:
          vals.push(dv.getInt32(at + 4 * k, le));
          break;
        case 11:
          vals.push(dv.getFloat32(at + 4 * k, le));
          break;
        case 12:
          vals.push(dv.getFloat64(at + 8 * k, le));
          break;
        case 16:
          vals.push(Number(dv.getBigUint64(at + 8 * k, le)));
          break;
        default:
          vals.push(NaN);
      }
    }
    tags.set(tag, vals);
  }
  const num = (t: number, d?: number): number => {
    const v = tags.get(t);
    if (Array.isArray(v) && v.length) return v[0]!;
    if (d === undefined) throw new Error(`TIFF tag ${t} missing`);
    return d;
  };
  const arr = (t: number): number[] | null => {
    const v = tags.get(t);
    return Array.isArray(v) ? v : null;
  };

  const width = num(256);
  const height = num(257);
  const bits = num(258, 32);
  const compression = num(259, 1);
  const spp = num(277, 1);
  const format = num(339, 1); // 1 uint, 2 int, 3 float
  if (spp !== 1) throw new Error('Only single-band rasters are supported');
  if (compression !== 1 && compression !== 8 && compression !== 32946) throw new Error(`Unsupported TIFF compression ${compression}`);
  if ((compression === 8 || compression === 32946) && !inflate) throw new Error('Deflate TIFF needs an inflate function');
  if (num(317, 1) !== 1) throw new Error('TIFF predictors are not supported');
  const bytesPer = bits / 8;
  const read = (v: DataView, o: number): number => {
    if (format === 3 && bits === 32) return v.getFloat32(o, le);
    if (format === 3 && bits === 64) return v.getFloat64(o, le);
    if (format === 2 && bits === 16) return v.getInt16(o, le);
    if (format === 2 && bits === 32) return v.getInt32(o, le);
    if (bits === 16) return v.getUint16(o, le);
    if (bits === 32) return v.getUint32(o, le);
    throw new Error(`Unsupported sample format ${format}/${bits}`);
  };

  const nodataTag = tags.get(42113);
  const nodata = typeof nodataTag === 'string' && nodataTag.trim() ? parseFloat(nodataTag) : NaN;
  const isNoData = (x: number) => !Number.isFinite(x) || (!Number.isNaN(nodata) && (x === nodata || Math.abs(x - nodata) <= Math.abs(nodata) * 1e-6));

  const data = new Float32Array(width * height).fill(NaN);
  const block = async (offset: number, count: number): Promise<DataView> => {
    let bytes: Uint8Array = new Uint8Array(buf, offset, count);
    if (compression !== 1) bytes = await inflate!(bytes);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  };

  const tileW = tags.has(322) ? num(322) : 0;
  if (tileW) {
    const tileH = num(323);
    const offsets = arr(324)!;
    const counts = arr(325)!;
    const across = Math.ceil(width / tileW);
    for (let t = 0; t < offsets.length; t++) {
      const v = await block(offsets[t]!, counts[t]!);
      const c0 = (t % across) * tileW;
      const r0 = Math.floor(t / across) * tileH;
      for (let r = 0; r < tileH && r0 + r < height; r++) {
        for (let c = 0; c < tileW && c0 + c < width; c++) {
          const x = read(v, (r * tileW + c) * bytesPer);
          data[(r0 + r) * width + c0 + c] = isNoData(x) ? NaN : x;
        }
      }
    }
  } else {
    const offsets = arr(273)!;
    const counts = arr(279)!;
    const rowsPer = num(278, height);
    for (let s = 0; s < offsets.length; s++) {
      const v = await block(offsets[s]!, counts[s]!);
      const r0 = s * rowsPer;
      for (let r = 0; r < rowsPer && r0 + r < height; r++) {
        for (let c = 0; c < width; c++) {
          const x = read(v, (r * width + c) * bytesPer);
          data[(r0 + r) * width + c] = isNoData(x) ? NaN : x;
        }
      }
    }
  }

  let transform: Raster['transform'];
  const mt = arr(34264);
  const scale = arr(33550);
  const tie = arr(33922);
  if (mt && mt.length >= 8) {
    transform = [mt[0]!, mt[1]!, mt[3]!, mt[4]!, mt[5]!, mt[7]!];
  } else if (scale && tie) {
    const [i, j, , X, Y] = tie as [number, number, number, number, number];
    transform = [scale[0]!, 0, X - i * scale[0]!, 0, -scale[1]!, Y + j * scale[1]!];
  } else {
    throw new Error('TIFF has no geo-referencing');
  }
  // GeoKey 1025 (GTRasterTypeGeoKey) = 2 means PixelIsPoint: the transform refers to pixel
  // centres, so shift it back by half a pixel to the corner convention.
  const keys = arr(34735);
  if (keys) {
    for (let k = 4; k + 3 < keys.length; k += 4) {
      if (keys[k] === 1025 && keys[k + 1] === 0 && keys[k + 3] === 2) {
        transform = [transform[0], transform[1], transform[2] - 0.5 * (transform[0] + transform[1]), transform[3], transform[4], transform[5] - 0.5 * (transform[3] + transform[4])];
      }
    }
  }
  return { width, height, data, transform };
}

/** Bilinear sampler in the raster's coordinates (X, Y); NaN outside or next to nodata. */
export function rasterSampler(r: Raster): (X: number, Y: number) => number {
  const [a, b, c, d, e, f] = r.transform;
  const det = a * e - b * d;
  return (X: number, Y: number) => {
    const dx = X - c;
    const dy = Y - f;
    const col = (e * dx - b * dy) / det - 0.5;
    const row = (-d * dx + a * dy) / det - 0.5;
    const i = Math.floor(col);
    const j = Math.floor(row);
    if (i < 0 || j < 0 || i + 1 >= r.width || j + 1 >= r.height) return NaN;
    const tx = col - i;
    const ty = row - j;
    const k = j * r.width + i;
    const v00 = r.data[k]!;
    const v10 = r.data[k + 1]!;
    const v01 = r.data[k + r.width]!;
    const v11 = r.data[k + r.width + 1]!;
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  };
}
