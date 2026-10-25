/** Shot statistics: where shots landed relative to their predictions, group size, and launch speed through the day. */

import { useState } from 'preact/hooks';
import { missStats, type Miss } from '../core/stats';
import { enuOf } from '../geoDeg';
import { cannons, fitResult, shots } from '../state/store';
import { LineChart, MissScatter, niceTicks, timeTicks } from './charts';
import { fmt, timeOf } from './format';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

export function ShotStats() {
  const [basis, setBasis] = useState<'atTime' | 'fit'>('atTime');
  const fit = fitResult.value;
  const marked = shots.value.filter((s) => s.impact && !s.excluded);
  if (marked.length === 0) {
    return (
      <section class="card">
        <h2>Statistics</h2>
        <p class="muted">Mark where a few shots landed to see how close the predictions are.</p>
      </section>
    );
  }
  const residual = new Map((fit?.result.residuals ?? []).map((r) => [r.id, r]));
  const useFit = basis === 'fit' && residual.size > 0;
  const misses: (Miss & { label: string })[] = marked.flatMap((s, i) => {
    const label = `#${i + 1} ${timeOf(s.time)}`;
    if (useFit) {
      const r = residual.get(s.id);
      // Residual is predicted − marked; the miss is marked − predicted.
      return r ? [{ down: -r.down, cross: -r.cross, label }] : [];
    }
    const az = ((s.aim.azimuthRawDeg + s.aim.declinationDeg + s.aim.headingBiasDeg) * Math.PI) / 180;
    const e = enuOf(s.predicted, s.impact!);
    return [{ down: e.x * Math.sin(az) + e.y * Math.cos(az), cross: e.x * Math.cos(az) - e.y * Math.sin(az), label }];
  });
  const st = missStats(misses);
  const extent = Math.max(5, ...misses.map((m) => Math.hypot(m.down, m.cross)));
  const rings = niceTicks(0, extent, 3).filter((r) => r > 0).slice(0, 3);

  // Launch speed per shot (from the fit), one series per power setting.
  const settingName = Object.fromEntries(cannons.value.flatMap((c) => c.settings.map((s) => [s.id, s.label])));
  const shotTime = new Map(shots.value.map((s) => [s.id, Date.parse(s.firedAt ?? s.time) / 1000]));
  const speedSeries = Object.entries(fit?.result.speedScatter ?? {})
    .map(([id, sc]) => ({
      label: settingName[id] ?? 'Setting',
      points: sc.perShot.filter((p) => Number.isFinite(p.v0) && shotTime.has(p.id)).map((p) => [shotTime.get(p.id)!, p.v0] as const).sort((a, b) => a[0] - b[0]),
    }))
    .filter((s) => s.points.length >= 2)
    .slice(0, 3)
    .map((s, i) => ({ ...s, color: SERIES[i]!, dots: true }));

  return (
    <section class="card">
      <header class="card-head">
        <h2>Statistics</h2>
        {residual.size > 0 && (
          <select class="compact-select" value={basis} onChange={(e) => setBasis((e.target as HTMLSelectElement).value as 'atTime' | 'fit')} aria-label="Compare against">
            <option value="atTime">vs prediction at the time</option>
            <option value="fit">vs fitted model</option>
          </select>
        )}
      </header>
      <p>
        Half the shots landed within <strong>{fmt(st.cep)} m</strong> of the prediction
        {st.n >= 5 ? (
          <>
            , 90% within <strong>{fmt(st.r90)} m</strong>
          </>
        ) : null}
        . On average {fmt(Math.abs(st.meanDown))} m {st.meanDown >= 0 ? 'long' : 'short'} and {fmt(Math.abs(st.meanCross))} m{' '}
        {st.meanCross >= 0 ? 'right' : 'left'} ({st.n} shots).
      </p>
      {st.n >= 3 && Math.hypot(st.meanDown, st.meanCross) > st.cep * 0.6 && (
        <p class="small">The misses lean one way: a fit (Calibration above) should remove most of that bias.</p>
      )}
      <MissScatter title="Where shots landed relative to their predictions" points={misses.map((m) => ({ x: m.cross, y: m.down, label: m.label }))} color="var(--series-1)" rings={rings} />
      <h3>Launch speed per shot</h3>
      {speedSeries.length ? (
        <LineChart
          title="Launch speed implied by each shot, through the day"
          series={speedSeries}
          xTicks={timeTicks(Math.min(...speedSeries.flatMap((s) => s.points.map((p) => p[0]))), Math.max(...speedSeries.flatMap((s) => s.points.map((p) => p[0]))))}
          xFormat={(t) => {
            const span = Math.max(...speedSeries.flatMap((s) => s.points.map((p) => p[0]))) - Math.min(...speedSeries.flatMap((s) => s.points.map((p) => p[0])));
            return new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(span < 600 ? { second: '2-digit' } : {}) });
          }}
          yFormat={(v) => fmt(v, 0)}
          yUnit="m/s"
          xLabel="Time fired"
          height={150}
        />
      ) : (
        <p class="muted small">Fit at least two shots of a setting to see its launch speed shot by shot (warm-up, pressure loss, fuel mix).</p>
      )}
    </section>
  );
}
