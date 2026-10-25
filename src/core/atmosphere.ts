/** Air density, wind vectors and the combined drag factor. SI units throughout. */

import type { Vec3 } from './vec';

/** Specific gas constant for dry air, J/(kg K). Humidity is ignored (< 1% effect). */
export const R_DRY = 287.05;
export const DEFAULT_RHO = 1.225;
export const KELVIN = 273.15;

/** ρ = p / (R_d T); p in pascals, T in kelvin. */
export function airDensity(pressurePa: number, tempK: number): number {
  return pressurePa / (R_DRY * tempK);
}

/**
 * Wind vector in ENU from speed and the direction it blows FROM (radians from true north).
 * w = −s (sin φ_from, cos φ_from, 0).
 */
export function windVector(speed: number, fromRad: number): Vec3 {
  return [-speed * Math.sin(fromRad), -speed * Math.cos(fromRad), 0];
}

/** Inverse of windVector: speed and FROM direction (radians, [0, 2π)). */
export function windFromVector(w: Vec3): { speed: number; fromRad: number } {
  const speed = Math.hypot(w[0], w[1]);
  const from = Math.atan2(-w[0], -w[1]);
  return { speed, fromRad: from < 0 ? from + 2 * Math.PI : from };
}

/** Rule-of-thumb shear exponent for open country. */
export const DEFAULT_SHEAR_EXPONENT = 1 / 7;

/**
 * Power-law wind shear: w(z) = w_ref (z / 10)^α, z clamped to ≥ 1 m.
 * Returns the multiplier applied to the 10 m reference wind.
 */
export function shearFactor(z: number, alpha = DEFAULT_SHEAR_EXPONENT): number {
  return Math.pow(Math.max(z, 1) / 10, alpha);
}

/** The 10 m wind implied by a reading taken at `heightM` (e.g. a handheld meter at ~1.5 m). */
export function referenceWind(speed: number, heightM: number | undefined, alpha: number): number {
  return heightM !== undefined && heightM > 0 && alpha > 0 ? speed / shearFactor(heightM, alpha) : speed;
}

/**
 * Shear exponent α fitted to wind speeds at several heights (least squares through the 10 m
 * value on log–log axes). Null when the 10 m wind is too light for the ratio to mean anything.
 * Clamped to [0, 0.5]: very stable night air can exceed 0.5, but then a forecast is unreliable.
 */
export function fitShearExponent(speed10: number, levels: readonly { z: number; speed: number }[]): number | null {
  if (!(speed10 >= 1)) return null;
  let sxy = 0;
  let sxx = 0;
  for (const { z, speed } of levels) {
    if (!(z > 10) || !(speed > 0)) continue;
    const x = Math.log(z / 10);
    sxy += x * Math.log(speed / speed10);
    sxx += x * x;
  }
  if (sxx === 0) return null;
  return Math.min(0.5, Math.max(0, sxy / sxx));
}

/**
 * Peak factor for gusts: a reported gust is roughly the mean wind plus about three standard
 * deviations of its turbulence (typical for short gusts within the reporting hour).
 */
export const GUST_PEAK_FACTOR = 3;

/** Turbulent wind spread (1σ, m/s) implied by a mean speed and the gust reported with it. */
export function gustSigma(mean: number, gust: number | undefined, peak = GUST_PEAK_FACTOR): number {
  if (gust === undefined || !Number.isFinite(gust)) return 0;
  return Math.max(0, gust - mean) / peak;
}

/**
 * Wind uncertainty per horizontal axis (1σ, m/s): the steady-air base (forecast error, local
 * shelter) combined with gust turbulence, as independent errors.
 */
export function windSigma(base: number, mean: number, gust?: number): number {
  return Math.hypot(base, gustSigma(mean, gust));
}

/** k = ρ C_d A / (2m), A = π d² / 4, times the calibrated drag scale. Units 1/m. */
export function dragFactor(rho: number, cd: number, diameterM: number, massKg: number, dragScale = 1): number {
  const area = (Math.PI * diameterM * diameterM) / 4;
  return (dragScale * rho * cd * area) / (2 * massKg);
}

/** Terminal speed √(g/k); Infinity with no drag. */
export function terminalSpeed(k: number, g: number): number {
  return k > 0 ? Math.sqrt(g / k) : Infinity;
}
