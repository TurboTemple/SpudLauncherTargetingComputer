/** Open-Meteo forecast client: temperature, surface pressure and 10 m wind. Free, no key. */

import { fitShearExponent } from '../core/atmosphere';
import type { Atmosphere } from './model';

export function weatherUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(5),
    longitude: lon.toFixed(5),
    current: 'temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'ms',
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

interface OpenMeteoCurrent {
  time?: string;
  temperature_2m?: number;
  surface_pressure?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
}

/** Hourly winds at 10/80/120 m and the 15-minute forecast for the next ~2 hours. */
export function windProfileUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(5),
    longitude: lon.toFixed(5),
    hourly: 'wind_speed_10m,wind_speed_80m,wind_speed_120m',
    minutely_15: 'wind_speed_10m,wind_gusts_10m,wind_direction_10m',
    past_hours: '1',
    forecast_hours: '3',
    past_minutely_15: '1',
    forecast_minutely_15: '9',
    timeformat: 'unixtime',
    wind_speed_unit: 'ms',
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

interface Series {
  time?: number[];
  [k: string]: number[] | undefined;
}

/** Index of the time step nearest `nowS`, or -1. */
function nearest(times: readonly number[] | undefined, nowS: number): number {
  if (!times?.length) return -1;
  let best = 0;
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i]! - nowS) < Math.abs(times[best]! - nowS)) best = i;
  return best;
}

export interface WindProfile {
  shearExponent?: number;
  profile?: { z: number; speed: number }[];
  trend?: { t: number; speed: number; gust?: number; fromDeg?: number }[];
}

/** Parse the profile/trend response; tolerant of missing series (coverage varies by region). */
export function parseWindProfile(json: { hourly?: Series; minutely_15?: Series }, nowS: number): WindProfile {
  const out: WindProfile = {};
  const h = json.hourly;
  const i = nearest(h?.time, nowS);
  if (h && i >= 0) {
    const s10 = h.wind_speed_10m?.[i];
    const levels = [
      { z: 80, speed: h.wind_speed_80m?.[i] },
      { z: 120, speed: h.wind_speed_120m?.[i] },
    ].filter((l): l is { z: number; speed: number } => typeof l.speed === 'number');
    if (typeof s10 === 'number') {
      out.profile = [{ z: 10, speed: s10 }, ...levels];
      const a = fitShearExponent(s10, levels);
      if (a !== null) out.shearExponent = a;
    }
  }
  const m = json.minutely_15;
  if (m?.time?.length && m.wind_speed_10m) {
    out.trend = m.time
      .map((t, k) => ({
        t,
        speed: m.wind_speed_10m![k]!,
        ...(m.wind_gusts_10m?.[k] !== undefined ? { gust: m.wind_gusts_10m[k]! } : {}),
        ...(m.wind_direction_10m?.[k] !== undefined ? { fromDeg: m.wind_direction_10m[k]! } : {}),
      }))
      .filter((p) => Number.isFinite(p.speed));
  }
  return out;
}

export async function fetchWindProfile(lat: number, lon: number, signal?: AbortSignal): Promise<WindProfile> {
  const res = await fetch(windProfileUrl(lat, lon), { signal });
  if (!res.ok) throw new Error(`Wind profile request failed (HTTP ${res.status})`);
  return parseWindProfile(await res.json(), Date.now() / 1000);
}

export async function fetchWeather(lat: number, lon: number, signal?: AbortSignal): Promise<Atmosphere> {
  const res = await fetch(weatherUrl(lat, lon), { signal });
  if (!res.ok) throw new Error(`Weather request failed (HTTP ${res.status})`);
  const json = (await res.json()) as { current?: OpenMeteoCurrent };
  const c = json.current;
  if (!c || c.temperature_2m === undefined || c.surface_pressure === undefined) throw new Error('Weather response missing fields');
  return {
    tempC: c.temperature_2m,
    pressureHpa: c.surface_pressure, // hPa; × 100 for pascals
    windSpeedMs: c.wind_speed_10m ?? 0,
    windFromDeg: c.wind_direction_10m ?? 0, // meteorological: direction the wind blows FROM
    ...(c.wind_gusts_10m !== undefined ? { windGustsMs: c.wind_gusts_10m } : {}),
    source: 'open-meteo',
    fetchedAt: new Date().toISOString(),
  };
}

const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** "Picking up", "Easing" or "Steady", judged against the value now. */
export function trendVerdict(trend: NonNullable<Atmosphere['trend']>, nowS: number): string | null {
  const future = trend.filter((p) => p.t >= nowS - 450);
  if (future.length < 3) return null;
  const now = future[0]!.speed;
  const peak = future.reduce((a, p) => (p.speed > a.speed ? p : a));
  const low = future.reduce((a, p) => (p.speed < a.speed ? p : a));
  if (peak.speed >= now * 1.3 && peak.speed - now >= 1.5) return `Picking up: ${peak.speed.toFixed(1)} m/s by ${hhmm(peak.t)}`;
  if (low.speed <= now * 0.7 && now - low.speed >= 1.5) return `Easing: ${low.speed.toFixed(1)} m/s by ${hhmm(low.t)}`;
  return 'Steady for the next two hours';
}

