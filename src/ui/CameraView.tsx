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

export function CameraView() {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = lockedAim.value;

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

    const draw = () => {
      raf = requestAnimationFrame(draw);
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
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = width + 4 * dpr;
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      };
      const label = (text: string, u: number, vv: number) => {
        ctx.font = `700 ${16 * dpr}px system-ui, sans-serif`;
        const w = ctx.measureText(text).width + 12 * dpr;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(u - w / 2, vv - 30 * dpr, w, 24 * dpr);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(text, u, vv - 12 * dpr);
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
        line([...ring, ring[0]!], '#ff8c00', 3 * dpr);
      }
      if (pr) {
        const path: (ReturnType<typeof P> | null)[] = [];
        for (let i = 0; i < pr.path.length; i += 3) path.push(P([pr.path[i]!, pr.path[i + 1]!, pr.path[i + 2]!]));
        line(path, '#1a6dff', 4 * dpr);
        const hit = P(pr.impact);
        if (hit && hit.u > 0 && hit.u < W && hit.v > 0 && hit.v < H) {
          ctx.beginPath();
          ctx.arc(hit.u, hit.v, 12 * dpr, 0, 2 * Math.PI);
          ctx.lineWidth = 5 * dpr;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
          ctx.lineWidth = 3 * dpr;
          ctx.strokeStyle = '#e00000';
          ctx.stroke();
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
          ctx.fillStyle = '#e00000';
          ctx.strokeStyle = '#fff';
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
          ctx.strokeStyle = '#d58cff';
          ctx.stroke();
        }
      }
      // Centre cross.
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 10 * dpr, H / 2);
      ctx.lineTo(W / 2 + 10 * dpr, H / 2);
      ctx.moveTo(W / 2, H / 2 - 10 * dpr);
      ctx.lineTo(W / 2, H / 2 + 10 * dpr);
      ctx.stroke();
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
