/** Application state as Preact signals. Degrees at this layer; radians only inside core/. */

import { computed, signal } from '@preact/signals';
import { toRad } from '../core/angles';
import { airDensity, dragFactor, gustSigma, KELVIN, windSigma, windVector } from '../core/atmosphere';
import type { CalResult } from '../core/calibration';
import { interpolateV0 } from '../core/calibration';
import type { SteadyStats } from '../core/filters';
import type { MonteCarloResult, Spreads, ZoneInputs } from '../core/uncertainty';
import { DEFAULT_ATMOSPHERE, DEFAULT_SETTINGS } from '../data/defaults';
import type { AppSettings, Atmosphere, CannonProfile, PowerSetting, Projectile, Session, Shot } from '../data/model';
import type { AverageResult, Fix } from '../sensors/gps';
import type { HeadingMode, SensorPermission } from '../sensors/orientation';
import type { LatLon } from '../geoDeg';
import type { Prediction, ResponseMap, TerrainStatus, ZoneResult } from '../types';

export type Tab = 'aim' | 'target' | 'shots' | 'setup';
export const tab = signal<Tab>('aim');

// --- Stored configuration ------------------------------------------------------------
export const ready = signal(false);
export const settings = signal<AppSettings>(DEFAULT_SETTINGS);
export const cannons = signal<CannonProfile[]>([]);
export const projectiles = signal<Projectile[]>([]);
export const session = signal<Session | null>(null);
export const sessions = signal<Session[]>([]);
export const shots = signal<Shot[]>([]);
export const atmosphere = signal<Atmosphere>(DEFAULT_ATMOSPHERE);

export const cannon = computed<CannonProfile | null>(() => cannons.value.find((c) => c.id === settings.value.activeCannonId) ?? cannons.value[0] ?? null);
export const powerSetting = computed<PowerSetting | null>(
  () => cannon.value?.settings.find((s) => s.id === settings.value.activeSettingId) ?? cannon.value?.settings[0] ?? null,
);
export const projectile = computed<Projectile | null>(
  () => projectiles.value.find((p) => p.id === settings.value.activeProjectileId) ?? projectiles.value[0] ?? null,
);

/** Launch speed in use: calibrated value, else interpolated from calibrated numeric settings, else the entered value. */
export const effectiveV0 = computed<{ v0: number; source: 'fit' | 'interpolated' | 'entered' } | null>(() => {
  const s = powerSetting.value;
  if (!s) return null;
  if (s.fittedAt) return { v0: s.v0, source: 'fit' };
  if (s.numeric !== undefined) {
    const pts = (cannon.value?.settings ?? []).filter((o) => o.fittedAt && o.numeric !== undefined).map((o) => ({ numeric: o.numeric!, v0: o.v0 }));
    if (pts.length >= 2) {
      const r = interpolateV0(pts, s.numeric);
      if (r) return { v0: r.v0, source: 'interpolated' };
    }
  }
  return { v0: s.v0, source: 'entered' };
});

export const calibrated = computed(() => effectiveV0.value?.source === 'fit' || effectiveV0.value?.source === 'interpolated');

export const airRho = computed(() => airDensity(atmosphere.value.pressureHpa * 100, atmosphere.value.tempC + KELVIN));

/** Drag factor at drag scale 1 for the current projectile and air, 1/m. */
export const kUnit = computed(() => {
  const p = projectile.value;
  return p ? dragFactor(airRho.value, p.cd, p.diameterM, p.massKg, 1) : 0;
});

// --- Sensors -------------------------------------------------------------------------
export const sensorPermission = signal<SensorPermission>('unknown');
export const sensorsRunning = signal(false);
export const headingMode = signal<HeadingMode | null>(null);
export const northReferenced = signal(false);
export const compassAccuracy = signal<number | null>(null);
/** Declination at the launch point, degrees east (null until known). */
export const declinationDeg = signal<number | null>(null);
export const simulatorOn = signal(false);
export const simState = signal({ alphaDeg: 0, betaDeg: 30, gammaDeg: 0, noiseDeg: 0.03 });

export interface AimReading {
  t: number;
  /** Smoothed, before mount offset. */
  elevationRawDeg: number;
  /** Smoothed, magnetic (or relative), before declination and bias. */
  azimuthRawDeg: number;
  /** Corrected. */
  elevationDeg: number;
  azimuthDeg: number;
}

export const liveAim = signal<AimReading | null>(null);
export const steady = signal<SteadyStats | null>(null);
export const lockedAim = signal<AimReading | null>(null);
/** Time (performance seconds) of the last metal warning. */
export const metalWarningAt = signal(0);
export const aim = computed(() => lockedAim.value ?? liveAim.value);

// --- GPS and launch point ------------------------------------------------------------
export const lastFix = signal<Fix | null>(null);
export const gpsError = signal<string | null>(null);
export interface LaunchPoint extends LatLon {
  accuracyM: number;
  source: 'gps' | 'map';
}
export const launch = signal<LaunchPoint | null>(null);
export const launchAveraging = signal<AverageResult | null>(null);
export const terrain = signal<TerrainStatus & { state: 'none' | 'loading' | 'loaded' | 'flat' }>({
  state: 'none',
  loaded: false,
  launchGroundM: NaN,
  coverage: 0,
  halfSizeM: 0,
});

// --- Prediction ----------------------------------------------------------------------
export const prediction = signal<Prediction | null>(null);
export const zone = signal<ZoneResult | null>(null);
export const sideViewOpen = signal(false);
export const sideProfile = signal<{ d: number[]; h: number[] } | null>(null);
export const monteCarlo = signal<(MonteCarloResult & { origin: LatLon }) | null>(null);
export const monteCarloBusy = signal(false);

export const shotInputs = computed<ZoneInputs | null>(() => {
  const a = aim.value;
  const c = cannon.value;
  const p = projectile.value;
  const v = effectiveV0.value;
  if (!a || !c || !p || !v) return null;
  const atm = atmosphere.value;
  return {
    v0: v.v0,
    elevation: toRad(a.elevationDeg),
    azimuth: toRad(a.azimuthDeg),
    dragScale: p.dragScale,
    kUnit: kUnit.value,
    wind: windVector(atm.windSpeedMs, toRad(atm.windFromDeg)),
    windShear: settings.value.windShear,
    h0: c.muzzleHeightM,
  };
});

/** Wind uncertainty per axis for the landing zone: the steady-air setting, widened for gusts. */
export const windSpread = computed(() => {
  const s = settings.value;
  const atm = atmosphere.value;
  const gusts = s.gustWidening ? atm.windGustsMs : undefined;
  return { base: s.windSigmaMs, gust: gustSigma(atm.windSpeedMs, gusts), total: windSigma(s.windSigmaMs, atm.windSpeedMs, gusts) };
});

/** How far the wind moves the predicted impact (ENU, m): impact with wind − impact in still air. */
export const windEffect = signal<[number, number] | null>(null);

/** Input spreads (1σ) from the table in the spec, replaced by calibration where available. */
export const spreads = computed<Spreads | null>(() => {
  const s = settings.value;
  const c = cannon.value;
  const ps = powerSetting.value;
  const p = projectile.value;
  const v = effectiveV0.value;
  if (!c || !ps || !p || !v) return null;
  const sensorStdDeg = (steady.value?.elevationStd ?? 0) * (180 / Math.PI);
  const elevationDeg =
    c.mountTiltSigmaDeg !== undefined ? Math.max(0.05, Math.hypot(sensorStdDeg, c.mountTiltSigmaDeg)) : s.elevationSigmaDeg;
  const azimuthDeg = session.value?.headingBiasSource === 'landmark' ? s.azimuthSigmaLandmarkDeg : s.azimuthSigmaDeg;
  const l = launch.value;
  return {
    elevation: toRad(elevationDeg),
    azimuth: toRad(azimuthDeg),
    v0: ps.fittedAt ? ps.v0Sigma : s.v0SigmaFrac * v.v0,
    dragScale: p.fittedAt ? p.dragScaleSigma : s.dragScaleSigmaFrac * p.dragScale,
    windE: windSpread.value.total,
    windN: windSpread.value.total,
    launch: l ? (l.source === 'map' ? 0.5 : l.accuracyM / 2) : 5,
  };
});

// --- Target --------------------------------------------------------------------------
export const target = signal<LatLon | null>(null);
export const targetSolution = signal<ResponseMap['target'] | null>(null);
export const selectedArc = signal<'low' | 'high' | null>(null);

// --- Shot recording and calibration ---------------------------------------------------
export interface RecordState {
  draft: Shot;
  firedAt: number | null;
  standing: AverageResult | null;
}
export const recording = signal<RecordState | null>(null);
export const fitResult = signal<{ result: CalResult; at: string; shotIds: string[] } | null>(null);
export const fitBusy = signal(false);

// --- Wizards and messages ------------------------------------------------------------
export type Wizard =
  | { kind: 'mount'; step: 1 | 2 | 3; e1?: { mean: number; sd: number }; e2?: { mean: number; sd: number }; capturing: boolean }
  | { kind: 'landmark'; picked: LatLon | null; offsets: number[] };
export const wizard = signal<Wizard | null>(null);

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'error';
}
export const toasts = signal<Toast[]>([]);
let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 4000): void {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), ms);
}

export const installPrompt = signal<(Event & { prompt: () => Promise<void> }) | null>(null);
export const updateAvailable = signal<(() => void) | null>(null);

/** What a long-press on the map does right now. */
export type MapAction = 'launch' | 'target' | 'impact' | 'landmark' | null;
export const mapAction = computed<MapAction>(() => {
  const w = wizard.value;
  if (w?.kind === 'landmark') return 'landmark';
  if (recording.value) return 'impact';
  if (tab.value === 'target') return 'target';
  if (tab.value === 'aim') return 'launch';
  return null;
});
