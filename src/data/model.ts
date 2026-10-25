/**
 * Stored records. Shots keep the raw sensor aim and each correction separately, so a later fit
 * can re-derive everything from scratch. Degrees here (storage and UI edge); core/ is radians.
 */

export interface CannonProfile {
  id: string;
  name: string;
  barrelDiameterM: number;
  muzzleHeightM: number;
  mountReversed: boolean; // top edge towards the breech
  mountTiltOffsetDeg: number; // from the reversal calibration
  /** Uncertainty of the mount offset from the reversal readings, deg (absent = never calibrated). */
  mountTiltSigmaDeg?: number;
  settings: PowerSetting[];
}

export interface PowerSetting {
  id: string;
  label: string; // "60 psi", "2 squirts"
  numeric?: number; // for interpolation, e.g. 60
  v0: number; // m/s, from calibration
  v0Sigma: number; // m/s shot-to-shot scatter, from calibration
  /** Set when a fit has produced v0 for this setting. Uncalibrated until then. */
  fittedAt?: string;
}

export interface Projectile {
  id: string;
  name: string;
  massKg: number;
  diameterM: number;
  cd: number;
  dragScale: number;
  dragScaleSigma: number;
  fittedAt?: string;
}

export interface Atmosphere {
  tempC: number;
  pressureHpa: number;
  windSpeedMs: number;
  windFromDeg: number; // true north, blowing FROM
  windGustsMs?: number;
  source: 'open-meteo' | 'manual' | 'default';
  fetchedAt?: string;
}

export interface Session {
  id: string;
  startedAt: string;
  headingBiasDeg?: number; // from landmark sighting or fit
  /** How the current heading bias was set. */
  headingBiasSource?: 'landmark' | 'fit';
  landmarks: { lat: number; lon: number }[];
}

export interface Shot {
  id: string;
  sessionId: string;
  time: string; // ISO 8601
  cannonId: string;
  settingId: string;
  projectileId: string;
  launch: { lat: number; lon: number; groundHeightM: number; accuracyM: number };
  aim: {
    elevationRawDeg: number; // before mount offset
    azimuthRawDeg: number; // before declination and bias
    mountOffsetDeg: number;
    declinationDeg: number;
    headingBiasDeg: number;
  };
  atmosphere: Atmosphere;
  /** Settings frozen at lock time. */
  conditions: { muzzleHeightM: number; windShear: boolean; v0: number; dragScale: number };
  predicted: { lat: number; lon: number; flightTimeS: number };
  impact?: { lat: number; lon: number; sigmaM: number; method: 'tap' | 'gps'; groundHeightM?: number };
  flightTimeS?: number;
  excluded?: boolean; // user dropped it from fits
}

export interface AppSettings {
  /** Barrel-vector smoothing time constant, s. */
  emaTauS: number;
  steadyWindowS: number;
  steadyElevStdDeg: number;
  steadyAzStdDeg: number;
  autoLock: boolean;
  autoLockAfterS: number;
  onTargetElevDeg: number;
  onTargetAzDeg: number;
  windShear: boolean;
  /** Default input spreads (1σ). */
  elevationSigmaDeg: number;
  azimuthSigmaDeg: number;
  azimuthSigmaLandmarkDeg: number;
  v0SigmaFrac: number;
  dragScaleSigmaFrac: number;
  windSigmaMs: number;
  audio: boolean;
  theme: 'light' | 'dark';
  satelliteUrl: string;
  satelliteAttribution: string;
  devMode: boolean;
  activeCannonId: string;
  activeSettingId: string;
  activeProjectileId: string;
  /** Session id for which the safety reminder was acknowledged. */
  safetyAckSession: string;
  /** Last weather (fetched or manual), restored on start. */
  atmosphere?: Atmosphere;
}

export interface ExportBundle {
  app: 'spud-app';
  schemaVersion: number;
  exportedAt: string;
  profiles: CannonProfile[];
  projectiles: Projectile[];
  sessions: Session[];
  shots: Shot[];
  settings: Partial<AppSettings>;
}
