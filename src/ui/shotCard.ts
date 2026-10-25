/**
 * Shareable shot card: a 1080 × 1350 PNG with a map (OpenStreetMap tiles, attributed) showing
 * the path, landing zone and landing, and a panel of numbers with a side-on arc. Shared through
 * the system share sheet where files can be shared, otherwise downloaded.
 */

import { DEG } from '../core/angles';
import { latToTileY, lonToTileX, TILE_SIZE } from '../core/geo';
import { latLonOf, type LatLon } from '../geoDeg';

export interface ShotCardSpec {
  title: string;
  subtitle: string;
  launch: LatLon;
  /** ENU path x, y, z triples (relative to the launch point). */
  path: ArrayLike<number>;
  impact: [number, number];
  /** 90% landing zone outline (ENU). */
  zone?: [number, number][];
  marked?: LatLon;
  target?: LatLon;
  /** Big numbers: [label, value] pairs. */
  stats: [string, string][];
  note?: string;
}

const W = 1080;
const H = 1350;
const MAP_H = 800;
const OSM = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

export async function renderShotCard(spec: ShotCardSpec): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  // Everything to frame, in lat/lon.
  const enu = (x: number, y: number) => latLonOf(spec.launch, x, y);
  const pts: LatLon[] = [spec.launch, enu(...spec.impact)];
  for (let i = 0; i < spec.path.length; i += 3) pts.push(enu(spec.path[i]!, spec.path[i + 1]!));
  spec.zone?.forEach(([x, y]) => pts.push(enu(x, y)));
  if (spec.marked) pts.push(spec.marked);
  if (spec.target) pts.push(spec.target);

  // Largest zoom (≤ 18) that fits the frame with padding.
  const gx = (p: LatLon, z: number) => lonToTileX(p.lon * DEG, z) * TILE_SIZE;
  const gy = (p: LatLon, z: number) => latToTileY(p.lat * DEG, z) * TILE_SIZE;
  let z = 18;
  for (; z > 3; z--) {
    const xs = pts.map((p) => gx(p, z));
    const ys = pts.map((p) => gy(p, z));
    if (Math.max(...xs) - Math.min(...xs) < W - 200 && Math.max(...ys) - Math.min(...ys) < MAP_H - 200) break;
  }
  const xs = pts.map((p) => gx(p, z));
  const ys = pts.map((p) => gy(p, z));
  const ox = (Math.max(...xs) + Math.min(...xs)) / 2 - W / 2;
  const oy = (Math.max(...ys) + Math.min(...ys)) / 2 - MAP_H / 2;
  const X = (p: LatLon) => gx(p, z) - ox;
  const Y = (p: LatLon) => gy(p, z) - oy;

  // Tiles under the map area.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, MAP_H);
  ctx.clip();
  ctx.fillStyle = '#ddd';
  ctx.fillRect(0, 0, W, MAP_H);
  const jobs: Promise<void>[] = [];
  for (let ty = Math.floor(oy / TILE_SIZE); ty <= Math.floor((oy + MAP_H) / TILE_SIZE); ty++) {
    for (let tx = Math.floor(ox / TILE_SIZE); tx <= Math.floor((ox + W) / TILE_SIZE); tx++) {
      jobs.push(
        fetch(OSM(z, tx, ty), { mode: 'cors' })
          .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('tile'))))
          .then((b) => createImageBitmap(b))
          .then((img) => ctx.drawImage(img, tx * TILE_SIZE - ox, ty * TILE_SIZE - oy))
          .catch(() => {}),
      );
    }
  }
  await Promise.all(jobs);

  const stroke = (draw: () => void, color: string, width: number, halo = true) => {
    if (halo) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = width + 6;
      ctx.beginPath();
      draw();
      ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    draw();
    ctx.stroke();
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (spec.zone?.length) {
    const ring = spec.zone.map(([x, y]) => enu(x, y));
    ctx.fillStyle = 'rgba(255,122,0,0.15)';
    ctx.beginPath();
    ring.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    ctx.closePath();
    ctx.fill();
    stroke(() => {
      ring.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
      ctx.closePath();
    }, '#ff7a00', 4);
  }
  stroke(() => {
    for (let i = 0; i < spec.path.length; i += 3) {
      const p = enu(spec.path[i]!, spec.path[i + 1]!);
      if (i) ctx.lineTo(X(p), Y(p));
      else ctx.moveTo(X(p), Y(p));
    }
  }, '#0040e0', 6);
  const dot = (p: LatLon, r: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(X(p), Y(p), r + 4, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(X(p), Y(p), r, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  if (spec.target) {
    for (const [r, c] of [
      [22, '#8b00d6'],
      [14, '#fff'],
      [7, '#8b00d6'],
    ] as const)
      dot(spec.target, r, c);
  }
  dot(spec.launch, 14, '#0040e0');
  const imp = enu(...spec.impact);
  ctx.beginPath();
  ctx.arc(X(imp), Y(imp), 18, 0, 2 * Math.PI);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#e00000';
  ctx.stroke();
  if (spec.marked) dot(spec.marked, 12, '#00a83a');
  ctx.restore();

  // Attribution, as OpenStreetMap requires.
  ctx.font = '22px system-ui, sans-serif';
  const attr = '© OpenStreetMap contributors';
  const aw = ctx.measureText(attr).width;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(W - aw - 24, MAP_H - 36, aw + 24, 36);
  ctx.fillStyle = '#333';
  ctx.fillText(attr, W - aw - 12, MAP_H - 11);

  // Panel.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, MAP_H, W, 4);
  ctx.fillStyle = '#000';
  ctx.font = '800 52px system-ui, sans-serif';
  ctx.fillText(spec.title, 40, MAP_H + 74);
  ctx.font = '30px system-ui, sans-serif';
  ctx.fillStyle = '#444';
  ctx.fillText(spec.subtitle, 40, MAP_H + 118);
  const cols = 3;
  spec.stats.slice(0, 6).forEach(([label, value], i) => {
    const cx = 40 + (i % cols) * 340;
    const cy = MAP_H + 180 + Math.floor(i / cols) * 112;
    ctx.fillStyle = '#555';
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText(label.toUpperCase(), cx, cy);
    ctx.fillStyle = '#000';
    ctx.font = '800 54px system-ui, sans-serif';
    ctx.fillText(value, cx, cy + 56);
  });
  // Side-on arc (stylised: each axis scaled to fill the strip).
  const sideTop = MAP_H + 400;
  const sideH = H - sideTop - 70;
  let dMax = 1;
  let hMax = 1;
  const az = Math.atan2(spec.impact[0], spec.impact[1]);
  const side: [number, number][] = [];
  for (let i = 0; i < spec.path.length; i += 3) {
    const d = spec.path[i]! * Math.sin(az) + spec.path[i + 1]! * Math.cos(az);
    side.push([d, spec.path[i + 2]!]);
    dMax = Math.max(dMax, d);
    hMax = Math.max(hMax, spec.path[i + 2]!);
  }
  const kx = (W - 80) / dMax;
  const ky = sideH / hMax;
  ctx.strokeStyle = '#bbb';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(40, sideTop + sideH);
  ctx.lineTo(W - 40, sideTop + sideH);
  ctx.stroke();
  ctx.strokeStyle = '#0040e0';
  ctx.lineWidth = 6;
  ctx.beginPath();
  side.forEach(([d, h], i) => (i ? ctx.lineTo(40 + d * kx, sideTop + sideH - h * ky) : ctx.moveTo(40 + d * kx, sideTop + sideH - h * ky)));
  ctx.stroke();
  ctx.fillStyle = '#666';
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillText(spec.note ?? 'Spud Trajectory · estimates only', 40, H - 28);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the card'))), 'image/png'));
}

export async function shareShotCard(spec: ShotCardSpec, name: string): Promise<void> {
  const blob = await renderShotCard(spec);
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: spec.title });
      return;
    } catch {
      /* cancelled: fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
