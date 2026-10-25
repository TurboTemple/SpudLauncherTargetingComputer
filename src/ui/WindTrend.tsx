/** The next two hours of forecast wind (15-minute steps): speed and gusts, plus a one-line verdict. */

import type { Atmosphere } from '../data/model';
import { trendVerdict } from '../data/weather';
import { LineChart, timeTicks } from './charts';
import { fmt } from './format';

const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function WindTrend({ trend }: { trend: NonNullable<Atmosphere['trend']> }) {
  const nowS = Date.now() / 1000;
  const pts = trend.filter((p) => p.t >= nowS - 900);
  if (pts.length < 2) return null;
  const verdict = trendVerdict(trend, nowS);
  const series = [{ label: 'Wind', color: 'var(--series-1)', points: pts.map((p) => [p.t, p.speed] as const) }];
  const gusts = pts.filter((p) => p.gust !== undefined);
  if (gusts.length) series.push({ label: 'Gusts', color: 'var(--series-2)', points: gusts.map((p) => [p.t, p.gust!] as const) });
  return (
    <details class="wind-trend">
      <summary>{verdict ?? 'Wind forecast'}</summary>
      <LineChart
        title="Forecast wind speed and gusts for the next two hours"
        series={series}
        xTicks={timeTicks(pts[0]!.t, pts[pts.length - 1]!.t, 1800)}
        xFormat={hhmm} yFormat={(v) => fmt(v, 0)} yUnit="m/s" xLabel="Time, 10 m height" yMin={0} height={130} />
    </details>
  );
}
