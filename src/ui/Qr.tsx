/** A QR code drawn as SVG (black on white with a quiet zone, whatever the theme). */

import { encode } from 'uqr';

export function Qr({ text, label }: { text: string; label: string }) {
  const qr = encode(text, { ecc: 'L', border: 2 });
  let d = '';
  qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x},${y}h1v1h-1z`)));
  return (
    <svg class="qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={label} shape-rendering="crispEdges">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
