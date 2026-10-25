/** Side view: height against distance along the current azimuth, path over the ground profile, apex marked. */

import { aim, prediction, sideProfile, tab, targetSolution } from '../state/store';
import { fmt } from './format';

const W = 360;
const H = 170;
const M = { l: 34, r: 10, t: 12, b: 24 };

export function SideView() {
  const pr = prediction.value;
  const a = aim.value;
  const prof = sideProfile.value;
  if (!pr || !a) return <p class="muted">No prediction yet.</p>;
  const az = (a.azimuthDeg * Math.PI) / 180;
  const sx = Math.sin(az);
  const sy = Math.cos(az);
  const pts: [number, number][] = [];
  for (let i = 0; i < pr.path.length; i += 3) pts.push([pr.path[i]! * sx + pr.path[i + 1]! * sy, pr.path[i + 2]!]);
  const ts = tab.value === 'target' ? targetSolution.value : null;
  const tgt = ts ? ([ts.solution.distance * Math.cos(az - ts.solution.bearing), ts.targetZ] as [number, number]) : null;

  let dMax = Math.max(...pts.map((p) => p[0]), 10, tgt?.[0] ?? 0);
  if (prof) dMax = Math.max(dMax, prof.d[prof.d.length - 1] ?? 0);
  const zs = [...pts.map((p) => p[1]), ...(prof?.h ?? [0]), 0, tgt?.[1] ?? 0];
  const zMin = Math.min(...zs) - 1;
  const zMax = Math.max(...zs) + 2;
  const X = (d: number) => M.l + (d / dMax) * (W - M.l - M.r);
  const Y = (z: number) => H - M.b - ((z - zMin) / (zMax - zMin)) * (H - M.t - M.b);

  const ground = prof
    ? `M${X(0)},${Y(zMin)} ` + prof.d.map((d, i) => `L${X(d).toFixed(1)},${Y(prof.h[i]!).toFixed(1)}`).join(' ') + ` L${X(prof.d[prof.d.length - 1]!)},${Y(zMin)} Z`
    : `M${X(0)},${Y(0)} L${X(dMax)},${Y(0)} L${X(dMax)},${Y(zMin)} L${X(0)},${Y(zMin)} Z`;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  const apexD = pr.apex[0] * sx + pr.apex[1] * sy;
  const impD = pr.impact[0] * sx + pr.impact[1] * sy;

  return (
    <svg class="sideview" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Side view of the predicted path over the ground">
      <path class="sv-ground" d={ground} />
      <path class="sv-path" d={path} />
      <circle class="sv-apex" cx={X(apexD)} cy={Y(pr.apex[2])} r={4} />
      <text class="sv-label" x={X(apexD)} y={Y(pr.apex[2]) - 7} text-anchor="middle">
        apex {fmt(pr.apex[2])} m
      </text>
      <circle class="sv-impact" cx={X(impD)} cy={Y(pr.impact[2])} r={4} />
      {tgt && <circle class="sv-target" cx={X(tgt[0])} cy={Y(tgt[1])} r={5} />}
      <line class="sv-axis" x1={M.l} y1={H - M.b} x2={W - M.r} y2={H - M.b} />
      <line class="sv-axis" x1={M.l} y1={M.t} x2={M.l} y2={H - M.b} />
      <text class="sv-tick" x={M.l} y={H - 6} text-anchor="start">
        0
      </text>
      <text class="sv-tick" x={W - M.r} y={H - 6} text-anchor="end">
        {fmt(dMax, 0)} m
      </text>
      <text class="sv-tick" x={M.l - 4} y={Y(zMax) + 10} text-anchor="end">
        {fmt(zMax, 0)}
      </text>
      <text class="sv-tick" x={M.l - 4} y={Y(zMin)} text-anchor="end">
        {fmt(zMin, 0)}
      </text>
    </svg>
  );
}
