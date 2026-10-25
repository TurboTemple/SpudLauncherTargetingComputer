/**
 * Wind at a glance on the Aim screen: a north-up compass (wind arrow and barrel line), speed and
 * gusts, the wind split into head/tail and cross components for the current aim, and how far it
 * moves this shot.
 */

import { fetchWeatherNow } from '../state/actions';
import { shearFactor } from '../core/atmosphere';
import { aim, atmosphere, prediction, shear, wind10, windEffect, windSpread } from '../state/store';
import { ago, compassPoint, fmt } from './format';
import { WindTrend } from './WindTrend';

const CALM = 0.3; // m/s

function Compass({ windTo, barrel }: { windTo: number | null; barrel: number | null }) {
  const c = 34;
  return (
    <svg class="compass" viewBox="0 0 68 68" width="68" height="68" role="img" aria-label="Wind direction compass, north up">
      <circle class="compass-ring" cx={c} cy={c} r={30} />
      <text class="compass-n" x={c} y={13} text-anchor="middle">
        N
      </text>
      {barrel !== null && <line class="compass-barrel" x1={c} y1={c} x2={c} y2={c - 19} transform={`rotate(${barrel} ${c} ${c})`} />}
      {windTo !== null && (
        // Drawn pointing north, then turned to where the wind blows.
        <g class="wind-arrow" transform={`rotate(${windTo} ${c} ${c})`}>
          <line x1={c} y1={c + 20} x2={c} y2={c - 12} />
          <polygon points={`${c},${c - 24} ${c - 8},${c - 10} ${c + 8},${c - 10}`} />
        </g>
      )}
    </svg>
  );
}

export function WindPanel() {
  const atm = atmosphere.value;
  const a = aim.value;
  const ws = windSpread.value;
  const eff = windEffect.value;
  const speed = wind10.value.speed;
  const sh = shear.value;
  const apexZ = prediction.value?.apex[2];
  const calm = speed < CALM;
  const windTo = calm ? null : (atm.windFromDeg + 180) % 360;

  // Components relative to the barrel: along > 0 is a tailwind, cross > 0 pushes right.
  let parts: string[] = [];
  let effect: string | null = null;
  if (a) {
    const az = (a.azimuthDeg * Math.PI) / 180;
    const from = (atm.windFromDeg * Math.PI) / 180;
    const we = -speed * Math.sin(from);
    const wn = -speed * Math.cos(from);
    const along = we * Math.sin(az) + wn * Math.cos(az);
    const cross = we * Math.cos(az) - wn * Math.sin(az);
    if (!calm) {
      parts = [
        Math.abs(along) < 0.1 ? 'no head/tailwind' : `${along > 0 ? 'Tailwind' : 'Headwind'} ${fmt(Math.abs(along))} m/s`,
        Math.abs(cross) < 0.1 ? 'no crosswind' : `${fmt(Math.abs(cross))} m/s from the ${cross > 0 ? 'left' : 'right'}`,
      ];
    }
    if (eff && !calm) {
      const down = eff[0] * Math.sin(az) + eff[1] * Math.cos(az);
      const side = eff[0] * Math.cos(az) - eff[1] * Math.sin(az);
      const bits = [
        Math.abs(side) >= 0.1 ? `${fmt(Math.abs(side))} m ${side > 0 ? 'right' : 'left'}` : null,
        Math.abs(down) >= 0.1 ? `${fmt(Math.abs(down))} m ${down > 0 ? 'long' : 'short'}` : null,
      ].filter(Boolean);
      effect = bits.length ? `Moves this shot ${bits.join(', ')}` : 'Barely moves this shot';
    }
  }

  const source =
    atm.source === 'open-meteo'
      ? `Forecast, 10 m height, ${ago(atm.fetchedAt)}`
      : atm.source === 'manual'
        ? 'Your reading'
        : 'No weather yet: still air assumed';

  return (
    <section class="card wind">
      <Compass windTo={windTo} barrel={a ? a.azimuthDeg : null} />
      <div class="wind-text">
        <p class="wind-main">
          {calm ? (
            'Calm'
          ) : (
            <>
              <strong>{fmt(speed)} m/s</strong> from {compassPoint(atm.windFromDeg)} ({fmt(atm.windFromDeg, 0)}°)
              {wind10.value.gust !== undefined && <>, gusts {fmt(wind10.value.gust)} m/s</>}
            </>
          )}
        </p>
        {parts.length > 0 && <p class="small">{parts.join(' · ')}</p>}
        {effect && <p class="small">{effect}</p>}
        {!calm && sh.alpha > 0 && apexZ !== undefined && apexZ > 12 && (
          <p class="small">
            At the apex ({fmt(apexZ, 0)} m up): {fmt(shearFactor(apexZ, sh.alpha), 2)}× the 10 m wind (
            {sh.source === 'forecast' ? `forecast profile, α ${fmt(sh.alpha, 2)}` : '1/7 rule of thumb'})
          </p>
        )}
        {atm.source === 'manual' && atm.measuredAtM !== undefined && atm.measuredAtM < 5 && sh.alpha > 0 && (
          <p class="muted tiny">
            Your {fmt(atm.windSpeedMs)} m/s at hand height is about {fmt(speed)} m/s at 10 m.
          </p>
        )}
        <p class="muted tiny">
          {source}. Landing zone allows ±{fmt(ws.total)} m/s
          {ws.gust > 0.05 ? ' (widened for gusts)' : ''}.{' '}
          <button class="link" onClick={() => void fetchWeatherNow()}>
            {atm.source === 'manual' ? 'Use forecast' : 'Refresh'}
          </button>
        </p>
        {atm.source === 'open-meteo' && atm.trend && <WindTrend trend={atm.trend} />}
      </div>
    </section>
  );
}
