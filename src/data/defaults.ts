import type { AppSettings, Atmosphere, CannonProfile, Projectile } from './model';

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function defaultCannon(): CannonProfile {
  return {
    id: newId(),
    name: 'My cannon',
    barrelDiameterM: 0.05,
    muzzleHeightM: 1.0,
    mountReversed: false,
    mountTiltOffsetDeg: 0,
    settings: [{ id: newId(), label: 'Standard', v0: 40, v0Sigma: 3.2 }],
  };
}

export function defaultProjectile(diameterM = 0.05): Projectile {
  return { id: newId(), name: 'Potato', massKg: 0.15, diameterM, cd: 0.6, dragScale: 1, dragScaleSigma: 0.1 };
}

/** 15 °C at 1013.25 hPa gives ρ = 1.225 kg/m³. */
export const DEFAULT_ATMOSPHERE: Atmosphere = { tempC: 15, pressureHpa: 1013.25, windSpeedMs: 0, windFromDeg: 0, source: 'default' };

export const DEFAULT_SETTINGS: AppSettings = {
  emaTauS: 0.15,
  steadyWindowS: 0.5,
  steadyElevStdDeg: 0.15,
  steadyAzStdDeg: 0.5,
  autoLock: false,
  autoLockAfterS: 1,
  onTargetElevDeg: 0.3,
  onTargetAzDeg: 1,
  windProfile: 'forecast',
  elevationSigmaDeg: 0.3,
  azimuthSigmaDeg: 3,
  azimuthSigmaLandmarkDeg: 1,
  v0SigmaFrac: 0.08,
  dragScaleSigmaFrac: 0.1,
  windSigmaMs: 1.5,
  gustWidening: true,
  audio: true,
  theme: 'light',
  skin: 'plain',
  tintMap: true,
  effects: true,
  satelliteProvider: 'none',
  maptilerKey: '',
  esriKey: '',
  satelliteUrl: '',
  satelliteAttribution: '',
  mapBase: 'map',
  devMode: false,
  activeCannonId: '',
  activeSettingId: '',
  activeProjectileId: '',
  safetyAckSession: '',
  nextMassKg: null,
  useEaLidar: true,
  game: null,
  spotter: null,
  cameraFovDeg: 68,
  cameraHeightM: 1.5,
  showFootprint: true,
  autoDetect: false,
  detectThresholdMs2: 25,
  countdown: true,
  countdownVoice: true,
};

export const LIMITS = {
  massKg: [0.02, 1],
  diameterM: [0.02, 0.12],
  cd: [0.2, 1.5],
  dragScale: [0.3, 3],
  v0: [5, 150],
  muzzleHeightM: [0, 3],
} as const;
