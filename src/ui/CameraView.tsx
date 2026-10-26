/**
 * Camera view: the rear camera's picture with the locked shot drawn over it (arc, landing point,
 * 90% zone, target). Lock the aim on the barrel, then unstrap the phone and point it downrange
 * from the launch point. Heading uses the same corrections as the aim (compass, declination,
 * landmark sighting), so a sighted landmark is the best check that it lines up.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { cameraRotation, focalFromFov, project, type Projector } from '../core/camera';
import { ellipsePolygon } from '../core/uncertainty';
import type { Vec3 } from '../core/vec';
import { enuOf } from '../geoDeg';
import { updateSettings } from '../state/actions';
import { cameraPose, lockAim } from '../state/sensors';
import { cameraOpen, launch, liveAim, lockedAim, prediction, settings, target, targetSolution, zone } from '../state/store';
import { fmt } from './format';

/** How the overlay is drawn, from the skin's --cam-* tokens (skins.css). */
interface CamStyle {
  path: string;
  ring: string;
  impact: string;
  target: string;
  halo: string;
  text: string;
  labelBg: string;
  labelEdge: string;
  font: string;
  reticle: string;
  /** Glow around lines, px (0: none). */
  glow: number;
}

function readCamStyle(): CamStyle {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, d: string) => cs.getPropertyValue(name).trim() || d;
  return {
    path: v('--cam-path', '#1a6dff'),
    ring: v('--cam-ring', '#ff8c00'),
    impact: v('--cam-impact', '#e00000'),
    target: v('--cam-target', '#d58cff'),
    halo: v('--cam-halo', 'rgba(255,255,255,0.9)'),
    text: v('--cam-text', '#fff'),
    labelBg: v('--cam-label-bg', 'rgba(0,0,0,0.75)'),
    labelEdge: v('--cam-label-edge', 'transparent'),
    font: v('--cam-font', 'system-ui, sans-serif'),
    reticle: v('--cam-reticle', 'cross'),
    glow: parseFloat(v('--cam-glow', '0')) || 0,
  };
}

/** HUD corner labels per skin and theme. */
function hudLabels(skin: string, dark: boolean): [string, string] | null {
  if (skin === 'military') return ['● REC', dark ? 'NV' : 'WHT HOT'];
  if (skin === 'spy') return ['AR link', 'Scanning'];
  if (skin === 'retro') return ['CAM 1 ● REC', dark ? 'CH-1' : 'LCD-TV'];
  return null;
}

/** The centre mark: a plain cross, a mil-scale sight, a ring, or a boxed cross. */
function reticle(ctx: CanvasRenderingContext2D, x: number, y: number, dpr: number, st: CamStyle): void {
  const k = dpr;
  ctx.save();
  ctx.strokeStyle = st.text;
  ctx.fillStyle = st.text;
  ctx.lineWidth = 1.5 * k;
  ctx.shadowBlur = st.glow ? st.glow * k : 0;
  ctx.shadowColor = st.text;
  ctx.beginPath();
  if (st.reticle === 'mil') {
    // Gapped crosshair with a tick every 15 px, like the mil scale in a sight.
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      ctx.moveTo(x + dx * 12 * k, y + dy * 12 * k);
      ctx.lineTo(x + dx * 72 * k, y + dy * 72 * k);
      for (let t = 27; t <= 72; t += 15) {
        ctx.moveTo(x + dx * t * k - dy * 4 * k, y + dy * t * k - dx * 4 * k);
        ctx.lineTo(x + dx * t * k + dy * 4 * k, y + dy * t * k + dx * 4 * k);
      }
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2 * k, 0, 2 * Math.PI);
    ctx.fill();
  } else if (st.reticle === 'ring') {
    ctx.arc(x, y, 26 * k, 0, 2 * Math.PI);
    for (let a = 0; a < 4; a++) {
      const c = Math.cos((a * Math.PI) / 2);
      const s = Math.sin((a * Math.PI) / 2);
      ctx.moveTo(x + c * 30 * k, y + s * 30 * k);
      ctx.lineTo(x + c * 44 * k, y + s * 44 * k);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2.5 * k, 0, 2 * Math.PI);
    ctx.fill();
  } else if (st.reticle === 'box') {
    ctx.lineWidth = 2 * k;
    ctx.moveTo(x - 10 * k, y);
    ctx.lineTo(x + 10 * k, y);
    ctx.moveTo(x, y - 10 * k);
    ctx.lineTo(x, y + 10 * k);
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      ctx.moveTo(x + sx * 28 * k, y + sy * 18 * k);
      ctx.lineTo(x + sx * 28 * k, y + sy * 28 * k);
      ctx.lineTo(x + sx * 18 * k, y + sy * 28 * k);
    }
    ctx.stroke();
  } else {
    ctx.moveTo(x - 10 * k, y);
    ctx.lineTo(x + 10 * k, y);
    ctx.moveTo(x, y - 10 * k);
    ctx.lineTo(x, y + 10 * k);
    ctx.stroke();
  }
  ctx.restore();
}

export function CameraView() {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = lockedAim.value;
  const hud = hudLabels(settings.value.skin, settings.value.theme === 'dark');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch((e: Error) => setError(e.message || 'Camera unavailable'));
    if (!navigator.mediaDevices) setError('Camera unavailable (needs HTTPS)');

    let style = readCamStyle();
    let styleKey = '';
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const key = `${settings.peek().skin}/${settings.peek().theme}`;
      if (key !== styleKey) {
        style = readCamStyle();
        styleKey = key;
      }
      const st = style;
      const c = canvas.current;
      const v = video.current;
      if (!c || !v) return;
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth * dpr;
      const H = c.clientHeight * dpr;
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
      const pose = cameraPose();
      const l = launch.peek();
      const pr = prediction.peek();
      if (!pose || !l) return;
      // The picture fills the screen (object-fit: cover); FOV is across its long side.
      const vw = v.videoWidth || W;
      const vh = v.videoHeight || H;
      const scale = Math.max(W / vw, H / vh);
      const cam: Projector = {
        f: focalFromFov(Math.max(vw, vh), (settings.peek().cameraFovDeg * Math.PI) / 180) * scale,
        cx: W / 2,
        cy: H / 2,
        screenAngle: screen.orientation?.angle ?? 0,
      };
      const R = cameraRotation(pose.alpha, pose.beta, pose.gamma, pose.correction);
      const eye: Vec3 = [0, 0, settings.peek().cameraHeightM];
      const P = (p: Vec3) => project(R, eye, p, cam);
      const line = (pts: (ReturnType<typeof P> | null)[], color: string, width: number) => {
        ctx.beginPath();
        let pen = false;
        for (const q of pts) {
          if (!q) {
            pen = false;
            continue;
          }
          if (pen) ctx.lineTo(q.u, q.v);
          else ctx.moveTo(q.u, q.v);
          pen = true;
        }
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = st.halo;
        ctx.lineWidth = width + 4 * dpr;
        ctx.stroke();
        glow(color);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
        glow(null);
      };
      const glow = (color: string | null) => {
        ctx.shadowBlur = color && st.glow ? st.glow * dpr : 0;
        ctx.shadowColor = color ?? 'transparent';
      };
      const label = (text: string, u: number, vv: number) => {
        ctx.font = `700 ${16 * dpr}px ${st.font}`;
        const w = ctx.measureText(text).width + 14 * dpr;
        ctx.fillStyle = st.labelBg;
        ctx.fillRect(u - w / 2, vv - 30 * dpr, w, 24 * dpr);
        ctx.strokeStyle = st.labelEdge;
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeRect(u - w / 2, vv - 30 * dpr, w, 24 * dpr);
        ctx.fillStyle = st.text;
        ctx.textAlign = 'center';
        glow(st.text);
        ctx.fillText(text, u, vv - 12 * dpr);
        glow(null);
      };

      // Horizon, for a sense of level.
      const horizon: (ReturnType<typeof P> | null)[] = [];
      for (let a = 0; a < 360; a += 3) horizon.push(P([5000 * Math.sin((a * Math.PI) / 180), 5000 * Math.cos((a * Math.PI) / 180), eye[2]]));
      ctx.setLineDash([6 * dpr, 6 * dpr]);
      line(horizon, 'rgba(255,255,255,0.5)', 1 * dpr);
      ctx.setLineDash([]);

      const z = zone.peek();
      if (pr && z) {
        const ring = ellipsePolygon(z.mean, z.ellipses[1]!).map(([x, y]) => P([x, y, pr.impact[2]]));
        line([...ring, ring[0]!], st.ring, 3 * dpr);
      }
      if (pr) {
        const path: (ReturnType<typeof P> | null)[] = [];
        for (let i = 0; i < pr.path.length; i += 3) path.push(P([pr.path[i]!, pr.path[i + 1]!, pr.path[i + 2]!]));
        line(path, st.path, 4 * dpr);
        const hit = P(pr.impact);
        if (hit && hit.u > 0 && hit.u < W && hit.v > 0 && hit.v < H) {
          ctx.beginPath();
          ctx.arc(hit.u, hit.v, 12 * dpr, 0, 2 * Math.PI);
          ctx.lineWidth = 5 * dpr;
          ctx.strokeStyle = st.halo;
          ctx.stroke();
          ctx.lineWidth = 3 * dpr;
          ctx.strokeStyle = st.impact;
          glow(st.impact);
          ctx.stroke();
          glow(null);
          label(`${fmt(pr.range, 0)} m`, hit.u, hit.v - 12 * dpr);
        } else {
          // Off screen: an arrow at the edge pointing the way to turn.
          const q = P([pr.impact[0], pr.impact[1], pr.impact[2]]);
          let ang: number;
          if (q) ang = Math.atan2(q.v - H / 2, q.u - W / 2);
          else ang = 0;
          const r = Math.min(W, H) * 0.42;
          const ax = W / 2 + r * Math.cos(ang);
          const ay = H / 2 + r * Math.sin(ang);
          ctx.save();
          ctx.translate(ax, ay);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.moveTo(18 * dpr, 0);
          ctx.lineTo(-12 * dpr, -14 * dpr);
          ctx.lineTo(-12 * dpr, 14 * dpr);
          ctx.closePath();
          ctx.fillStyle = st.impact;
          ctx.strokeStyle = st.halo;
          ctx.lineWidth = 3 * dpr;
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
      const t = target.peek();
      const ts = targetSolution.peek();
      if (t) {
        const e = enuOf(l, t);
        const q = P([e.x, e.y, ts?.targetZ ?? 0]);
        if (q) {
          ctx.beginPath();
          ctx.arc(q.u, q.v, 10 * dpr, 0, 2 * Math.PI);
          ctx.lineWidth = 4 * dpr;
          ctx.strokeStyle = st.target;
          glow(st.target);
          ctx.stroke();
          glow(null);
        }
      }
      reticle(ctx, W / 2, H / 2, dpr, st);
    };
    draw();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div class="camera-view">
      <video ref={video} autoplay playsInline muted />
      <canvas ref={canvas} />
      {hud && (
        <div class="cam-hud" aria-hidden="true">
          <i class="cam-fx" />
          <i class="cam-frame" />
          <i class="cam-ring" />
          <span class="cam-label cam-label-l">{hud[0]}</span>
          <span class="cam-label cam-label-r">{hud[1]}</span>
        </div>
      )}
      <div class="camera-top">
        {locked ? (
          <span>
            Locked: {fmt(locked.elevationDeg)}° tilt, {fmt(locked.azimuthDeg, 0)}°. Stand at the launch point and look downrange.
          </span>
        ) : (
          <span>
            Lock the aim on the barrel first, or the shot will follow the camera.{' '}
            <button class="btn btn-small btn-primary" disabled={!liveAim.value} onClick={lockAim}>
              Lock now
            </button>
          </span>
        )}
        {error && <span class="camera-error">{error}</span>}
      </div>
      <div class="camera-bottom">
        <label class="slider">
          <span>Field of view {fmt(settings.value.cameraFovDeg, 0)}° (adjust until a landmark lines up)</span>
          <input
            type="range"
            min={40}
            max={100}
            step={0.5}
            value={settings.value.cameraFovDeg}
            onInput={(e) => updateSettings({ cameraFovDeg: parseFloat((e.target as HTMLInputElement).value) })}
          />
        </label>
        <button class="btn btn-big btn-primary" onClick={() => (cameraOpen.value = false)}>
          Close
        </button>
      </div>
    </div>
  );
}
