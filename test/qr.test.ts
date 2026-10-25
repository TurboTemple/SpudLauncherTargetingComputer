import jsQR from 'jsqr';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { marksLink } from '../src/data/spotter';

/** Rasterise a QR matrix as the app draws it (black on white, quiet zone) and decode it again. */
function roundTrip(text: string): string | null {
  const qr = encode(text, { ecc: 'L', border: 2 });
  const scale = 4;
  const w = qr.size * scale;
  const px = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const on = qr.data[Math.floor(y / scale)]![Math.floor(x / scale)];
      const i = 4 * (y * w + x);
      px[i] = px[i + 1] = px[i + 2] = on ? 0 : 255;
      px[i + 3] = 255;
    }
  return jsQR(px, w, w)?.data ?? null;
}

describe('QR codes', () => {
  it('a spotter link with 20 marks encodes and decodes', async () => {
    const marks = Array.from({ length: 20 }, (_, i) => ({ t: 1_793_000_000 + 37 * i, lat: 52.2 + i * 3e-4, lon: 0.12 - i * 2e-4 }));
    const link = await marksLink('https://turbotemple.github.io/SpudLauncherTargetingComputer/', 'a1b2c3d4-0000-4000-8000-123456789abc', marks);
    expect(roundTrip(link)).toBe(link);
  });
});
