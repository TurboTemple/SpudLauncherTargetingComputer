/** Open-Meteo forecast client: temperature, surface pressure and 10 m wind. Free, no key. */

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
