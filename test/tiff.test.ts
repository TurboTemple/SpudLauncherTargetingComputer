import { readFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { rasterSampler, readTiff, type Inflate } from '../src/core/tiff';

const inflate: Inflate = async (b) => new Uint8Array(inflateSync(b));

interface Opts {
  le: boolean;
  tiled: boolean;
  deflate: boolean;
  geo: 'matrix' | 'tiepoint';
  nodata?: number;
}

/** Writes a small single-band float32 GeoTIFF (just enough of the format to exercise the reader). */
function makeTiff(w: number, h: number, value: (c: number, r: number) => number, o: Opts): ArrayBuffer {
  const tile = 8;
  const blocks: Uint8Array[] = [];
  const pack = (rows: number[][]) => {
    const n = rows.reduce((a, r) => a + r.length, 0);
    const b = new DataView(new ArrayBuffer(4 * n));
    let k = 0;
    for (const r of rows) for (const v of r) b.setFloat32(4 * k++, v, o.le);
    const raw = new Uint8Array(b.buffer);
    return o.deflate ? new Uint8Array(deflateSync(raw)) : raw;
  };
  if (o.tiled) {
    for (let r0 = 0; r0 < h; r0 += tile)
      for (let c0 = 0; c0 < w; c0 += tile)
        blocks.push(pack(Array.from({ length: tile }, (_, r) => Array.from({ length: tile }, (_, c) => (r0 + r < h && c0 + c < w ? value(c0 + c, r0 + r) : 0)))));
  } else {
    for (let r = 0; r < h; r += 3) blocks.push(pack(Array.from({ length: Math.min(3, h - r) }, (_, k) => Array.from({ length: w }, (_, c) => value(c, r + k)))));
  }
  const tags: [number, number, number[] | string][] = [
    [256, 3, [w]],
    [257, 3, [h]],
    [258, 3, [32]],
    [259, 3, [o.deflate ? 8 : 1]],
    [277, 3, [1]],
    [339, 3, [3]],
  ];
  if (o.tiled) tags.push([322, 3, [tile]], [323, 3, [tile]], [324, 4, []], [325, 4, blocks.map((b) => b.length)]);
  else tags.push([273, 4, []], [278, 3, [3]], [279, 4, blocks.map((b) => b.length)]);
  if (o.geo === 'matrix') tags.push([34264, 12, [0.001, 0, 0, 10, 0, -0.0005, 0, 50, 0, 0, 0, 0, 0, 0, 0, 1]]);
  else tags.push([33550, 12, [0.001, 0.0005, 0]], [33922, 12, [0, 0, 0, 10, 50, 0]]);
  if (o.nodata !== undefined) tags.push([42113, 2, `${o.nodata}\0`]);
  tags.sort((a, b) => a[0] - b[0]);
  const size = (t: number) => ({ 2: 1, 3: 2, 4: 4, 12: 8 })[t]!;
  const count = (v: number[] | string) => (typeof v === 'string' ? v.length : v.length || blocks.length);
  // Layout: header, IFD, out-of-line values, then data blocks.
  const ifdSize = 2 + 12 * tags.length + 4;
  let extra = 0;
  for (const [, t, v] of tags) if (size(t) * count(v) > 4) extra += size(t) * count(v);
  const dataStart = 8 + ifdSize + extra;
  const total = dataStart + blocks.reduce((a, b) => a + b.length, 0);
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint16(0, o.le ? 0x4949 : 0x4d4d);
  dv.setUint16(2, 42, o.le);
  dv.setUint32(4, 8, o.le);
  dv.setUint16(8, tags.length, o.le);
  const offsets: number[] = [];
  let d = dataStart;
  for (const b of blocks) {
    offsets.push(d);
    u8.set(b, d);
    d += b.length;
  }
  let ext = 8 + ifdSize;
  tags.forEach(([tag, type, v0], i) => {
    const v = Array.isArray(v0) && v0.length === 0 ? offsets : v0;
    const e = 10 + 12 * i;
    const n = count(v);
    dv.setUint16(e, tag, o.le);
    dv.setUint16(e + 2, type, o.le);
    dv.setUint32(e + 4, n, o.le);
    const at = size(type) * n > 4 ? ext : e + 8;
    if (size(type) * n > 4) {
      dv.setUint32(e + 8, ext, o.le);
      ext += size(type) * n;
    }
    for (let k = 0; k < n; k++) {
      if (typeof v === 'string') dv.setUint8(at + k, v.charCodeAt(k));
      else if (type === 3) dv.setUint16(at + 2 * k, v[k]!, o.le);
      else if (type === 4) dv.setUint32(at + 4 * k, v[k]!, o.le);
      else dv.setFloat64(at + 8 * k, v[k]!, o.le);
    }
  });
  return buf;
}

describe('TIFF reader', () => {
  const W = 19;
  const H = 13;
  const f = (c: number, r: number) => 100 + c + 0.1 * r;
  for (const le of [true, false])
    for (const tiled of [true, false])
      for (const deflate of [true, false])
        for (const geo of ['matrix', 'tiepoint'] as const) {
          it(`${le ? 'LE' : 'BE'} ${tiled ? 'tiled' : 'stripped'} ${deflate ? 'deflate' : 'raw'} ${geo}`, async () => {
            const r = await readTiff(makeTiff(W, H, f, { le, tiled, deflate, geo }), inflate);
            expect([r.width, r.height]).toEqual([W, H]);
            expect(r.data[0]).toBeCloseTo(f(0, 0), 4);
            expect(r.data[(H - 1) * W + W - 1]).toBeCloseTo(f(W - 1, H - 1), 4);
            expect(r.transform).toEqual([0.001, 0, 10, 0, -0.0005, 50]);
            // Pixel (3, 4) centre in map units samples back to its value.
            const s = rasterSampler(r);
            expect(s(10 + 0.001 * 3.5, 50 - 0.0005 * 4.5)).toBeCloseTo(f(3, 4), 4);
            // Bilinear between pixel centres.
            expect(s(10 + 0.001 * 4, 50 - 0.0005 * 4.5)).toBeCloseTo((f(3, 4) + f(4, 4)) / 2, 4);
          });
        }

  it('maps nodata to NaN and samples NaN next to it', async () => {
    const r = await readTiff(makeTiff(6, 6, (c) => (c === 0 ? -9999 : 5), { le: true, tiled: false, deflate: false, geo: 'matrix', nodata: -9999 }));
    expect(Number.isNaN(r.data[0]!)).toBe(true);
    const s = rasterSampler(r);
    expect(Number.isNaN(s(10 + 0.001 * 0.9, 50 - 0.0005 * 2))).toBe(true);
    expect(s(10 + 0.001 * 3, 50 - 0.0005 * 2)).toBe(5);
    expect(Number.isNaN(s(0, 0))).toBe(true);
  });

  it('needs an inflate function for Deflate data', async () => {
    await expect(readTiff(makeTiff(4, 4, () => 1, { le: true, tiled: true, deflate: true, geo: 'matrix' }))).rejects.toThrow(/inflate/);
  });

  it('reads real Environment Agency 1 m LIDAR samples (DTM and first-return DSM)', async () => {
    const load = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url)).buffer as ArrayBuffer;
    const dtm = await readTiff(load('ea-dtm-sample.tif'), inflate);
    const dsm = await readTiff(load('ea-dsm-sample.tif'), inflate);
    expect([dtm.width, dtm.height]).toEqual([70, 69]);
    const centre = [0.1215, 52.2053] as const;
    const g = rasterSampler(dtm)(...centre);
    const sfc = rasterSampler(dsm)(...centre);
    // Central Cambridge: ground a few metres above sea level; the surface is never below it.
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(40);
    expect(sfc).toBeGreaterThanOrEqual(g - 0.5);
    // About 1 m pixels.
    expect(dtm.transform[0] * 111_320 * Math.cos((52.2 * Math.PI) / 180)).toBeGreaterThan(0.8);
  });
});
