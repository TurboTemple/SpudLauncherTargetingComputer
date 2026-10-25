/**
 * Small SVG charts: thin 2px lines, ≥ 8px markers with a surface ring, hairline grid, a legend
 * for two or more series, a crosshair tooltip that lists every series, and a table view so no
 * value is reachable only by hovering. Series colours come from --series-1..3 (validated for
 * colour-vision deficiency on the card surface in both themes).
 */

import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';

export interface LineSeries {
  label: string;
  /** CSS colour, normally var(--series-N). */
  color: string;
  points: readonly (readonly [number, number])[];
  /** Draw markers at each point (for sparse data). */
  dots?: boolean;
  /** Draw no line, markers only. */
  noLine?: boolean;
}

/** Round tick values spanning [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** Time axis ticks (unix seconds): start and end, plus round steps in between when they fit. */
export function timeTicks(t0: number, t1: number, stepS?: number): number[] {
  if (!(t1 > t0)) return [t0];
  if (!stepS) return [t0, t1];
  const out = [t0];
  for (let t = Math.ceil(t0 / stepS) * stepS; t < t1; t += stepS) if (t - t0 > stepS / 3 && t1 - t > stepS / 3) out.push(t);
  out.push(t1);
  return out;
}

function Legend({ series }: { series: readonly { label: string; color: string; dots?: boolean; noLine?: boolean }[] }) {
  if (series.length < 2) return null;
  return (
    <div class="chart-legend">
      {series.map((s) => (
        <span key={s.label} class="chart-key">
          <svg width="18" height="10" aria-hidden="true">
            {s.noLine ? <circle cx="9" cy="5" r="4" fill={s.color} /> : <line x1="1" y1="5" x2="17" y2="5" stroke={s.color} stroke-width="2" stroke-linecap="round" />}
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}

function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details class="chart-table">
      <summary>Show as table</summary>
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

interface LineChartProps {
  title: string;
  series: readonly LineSeries[];
  xFormat: (x: number) => string;
  yFormat: (y: number) => string;
  yUnit: string;
  xLabel: string;
  height?: number;
  yMin?: number;
  yMax?: number;
  xDomain?: [number, number];
  /** Explicit x tick positions (e.g. for time axes); default: round numbers. */
  xTicks?: number[];
  /** Extra SVG drawn under the data, given the scales. */
  under?: (X: (x: number) => number, Y: (y: number) => number) => ComponentChildren;
}

const W = 340;
const M = { l: 38, r: 10, t: 8, b: 26 };

export function LineChart({ title, series, xFormat, yFormat, yUnit, xLabel, height = 150, yMin, yMax, xDomain, xTicks, under }: LineChartProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return <p class="muted small">No data yet.</p>;
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const [x0, x1] = xDomain ?? [Math.min(...xs), Math.max(...xs)];
  const yLo = yMin ?? Math.min(...ys);
  const yHi = Math.max(yMax ?? -Infinity, ...ys);
  const yt = niceTicks(yLo, yHi === yLo ? yLo + 1 : yHi, 4);
  const ya = Math.min(yLo, yt[0]!);
  const yb = Math.max(yHi, yt[yt.length - 1]!);
  const H = height;
  const X = (x: number) => M.l + ((x - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const Y = (y: number) => H - M.b - ((y - ya) / (yb - ya || 1)) * (H - M.t - M.b);
  const xt = (xTicks ?? niceTicks(x0, x1, 3)).filter((v) => v >= x0 && v <= x1);
  const uniqX = [...new Set(xs)].sort((a, b) => a - b);

  const onMove = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = uniqX[0]!;
    for (const x of uniqX) if (Math.abs(X(x) - px) < Math.abs(X(best) - px)) best = x;
    setHover(best);
  };
  const near = (s: LineSeries, x: number) => s.points.find((p) => p[0] === x) ?? null;

  return (
    <figure class="chart">
      <Legend series={series} />
      <div class="chart-plot">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={title}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {yt.map((v) => (
            <g key={v}>
              <line class="chart-grid" x1={M.l} x2={W - M.r} y1={Y(v)} y2={Y(v)} />
              <text class="chart-tick" x={M.l - 4} y={Y(v) + 3} text-anchor="end">
                {yFormat(v)}
              </text>
            </g>
          ))}
          {xt.map((v) => (
            <text key={v} class="chart-tick" x={X(v)} y={H - 8} text-anchor={X(v) < M.l + 20 ? 'start' : X(v) > W - M.r - 20 ? 'end' : 'middle'}>
              {xFormat(v)}
            </text>
          ))}
          {under?.(X, Y)}
          {series.map((s) =>
            s.noLine ? null : (
              <polyline
                key={s.label}
                class="chart-line"
                stroke={s.color}
                points={s.points.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}
              />
            ),
          )}
          {series.map((s) => (s.dots || s.noLine ? s.points.map((p, i) => <circle key={`${s.label}${i}`} class="chart-dot" cx={X(p[0])} cy={Y(p[1])} r={4} fill={s.color} />) : null))}
          {hover !== null && (
            <g>
              <line class="chart-crosshair" x1={X(hover)} x2={X(hover)} y1={M.t} y2={H - M.b} />
              {series.map((s) => {
                const p = near(s, hover);
                return p ? <circle key={s.label} class="chart-dot" cx={X(p[0])} cy={Y(p[1])} r={4} fill={s.color} /> : null;
              })}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div class="chart-tip" style={{ left: `${(X(hover) / W) * 100}%` }}>
            <div class="chart-tip-x">{xFormat(hover)}</div>
            {series.map((s) => {
              const p = near(s, hover);
              return p ? (
                <div key={s.label} class="chart-tip-row">
                  <svg width="12" height="6" aria-hidden="true">
                    <line x1="0" y1="3" x2="12" y2="3" stroke={s.color} stroke-width="2" />
                  </svg>
                  <strong>
                    {yFormat(p[1])} {yUnit}
                  </strong>{' '}
                  {s.label}
                </div>
              ) : null;
            })}
          </div>
        )}
      </div>
      <figcaption class="muted tiny">{xLabel}</figcaption>
      <TableView
        head={[xLabel, ...series.map((s) => `${s.label} (${yUnit})`)]}
        rows={uniqX.map((x) => [xFormat(x), ...series.map((s) => {
          const p = near(s, x);
          return p ? yFormat(p[1]) : '—';
        })])}
      />
    </figure>
  );
}

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
}

/** Equal-axis scatter (metres), centred on 0, with reference rings. */
export function MissScatter({ title, points, color, rings }: { title: string; points: readonly ScatterPoint[]; color: string; rings: readonly number[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return <p class="muted small">No marked shots yet.</p>;
  const S = 280;
  const c = S / 2;
  const extent = Math.max(...rings, ...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 1.08;
  const k = (c - 14) / extent;
  const onMove = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * S;
    const py = ((e.clientY - r.top) / r.height) * S;
    let best = -1;
    let bd = 24; // px hit radius
    points.forEach((p, i) => {
      const d = Math.hypot(c + p.x * k - px, c - p.y * k - py);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best >= 0 ? best : null);
  };
  const h = hover !== null ? points[hover] : null;
  return (
    <figure class="chart">
      <div class="chart-plot chart-square">
        <svg ref={svg} viewBox={`0 0 ${S} ${S}`} role="img" aria-label={title} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          <line class="chart-grid" x1={0} x2={S} y1={c} y2={c} />
          <line class="chart-grid" x1={c} x2={c} y1={0} y2={S} />
          {rings.map((r) => (
            <g key={r}>
              <circle class="chart-ring" cx={c} cy={c} r={r * k} />
              <text class="chart-tick" x={c + r * k * 0.71 + 2} y={c - r * k * 0.71 - 2}>
                {r} m
              </text>
            </g>
          ))}
          <text class="chart-tick" x={c} y={10} text-anchor="middle">
            long
          </text>
          <text class="chart-tick" x={c} y={S - 4} text-anchor="middle">
            short
          </text>
          <text class="chart-tick" x={4} y={c - 4}>
            left
          </text>
          <text class="chart-tick" x={S - 4} y={c - 4} text-anchor="end">
            right
          </text>
          {points.map((p, i) => (
            <circle key={i} class={`chart-dot ${hover === i ? 'hot' : ''}`} cx={c + p.x * k} cy={c - p.y * k} r={hover === i ? 6 : 4.5} fill={color} />
          ))}
        </svg>
        {h && (
          <div class="chart-tip" style={{ left: `${((c + h.x * k) / S) * 100}%`, top: `${((c - h.y * k) / S) * 100}%` }}>
            <div class="chart-tip-row">
              <strong>
                {Math.abs(h.x).toFixed(1)} m {h.x >= 0 ? 'right' : 'left'}, {Math.abs(h.y).toFixed(1)} m {h.y >= 0 ? 'long' : 'short'}
              </strong>
            </div>
            <div class="chart-tip-x">{h.label}</div>
          </div>
        )}
      </div>
      <TableView
        head={['Shot', 'Sideways (m, + right)', 'Downrange (m, + long)']}
        rows={points.map((p) => [p.label, p.x.toFixed(1), p.y.toFixed(1)])}
      />
    </figure>
  );
}
