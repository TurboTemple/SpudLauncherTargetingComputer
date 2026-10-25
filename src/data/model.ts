/**
 * Stored records. Shots keep the raw sensor aim and each correction separately, so a later fit
 * can re-derive everything from scratch. Degrees here (storage and UI edge); core/ is radians.
 */

import type { SatelliteProviderId } from './satellite';
import type { SpotInvite, SpotMark } from './spotter';

export interface CannonProfile {
  id: string;
  name: string;
  barrelDiameterM: number;
  muzzleHeightM: number;
  mountReversed: boolean; // top edge towards the breech
  mountTiltOffsetDeg: number; // from the reversal calibration
  /** Uncertainty of the mount offset from the reversal readings, deg (absent = never calibrated). */
  mountTiltSigmaDeg?: number;
  /**
   * Every shot gets the same energy, so a lighter potato leaves faster (v ∝ 1/√m). Setting
   * speeds are then for a potato of the projectile's typical weight.
   */
  massAffectsSpeed?: boolean;
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
  /** Typical (reference) weight; each shot can record its own. */
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
  /** Manual readings: height the wind was measured at, m (a handheld reading is ~1.5 m). */
  measuredAtM?: number;
  /** Forecast wind profile: shear exponent fitted to 10/80/120 m speeds, and those speeds. */
  shearExponent?: number;
  profile?: { z: number; speed: number }[];
  /** Forecast wind for the next ~2 hours in 15-minute steps (unix seconds). */
  trend?: { t: number; speed: number; gust?: number; fromDeg?: number }[];
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
  /** This potato's weight, kg (absent: the projectile's typical weight). */
  massKg?: number;
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
  conditions: {
    muzzleHeightM: number;
    /** Old records: true meant the 1/7 power law. */
    windShear?: boolean;
    /** Shear exponent used (0 = uniform wind). */
    shearExponent?: number;
    v0: number;
    dragScale: number;
  };
  predicted: { lat: number; lon: number; flightTimeS: number };
  impact?: { lat: number; lon: number; sigmaM: number; method: 'tap' | 'gps' | 'spotter'; groundHeightM?: number };
  flightTimeS?: number;
  /** When it was fired (ISO 8601); used to match a spotter's marks. */
  firedAt?: string;
  /** Fired time came from the accelerometer, not a tap. */
  detected?: boolean;
  /** Target-game entry: who fired, at which target, and the score once the impact is marked. */
  game?: { id: string; player: string; target: { lat: number; lon: number }; distanceM?: number; points?: number };
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
  /** How wind changes with height: forecast profile, the 1/7 rule of thumb, or uniform. */
  windProfile: 'forecast' | 'rule' | 'off';
  /** Default input spreads (1σ). */
  elevationSigmaDeg: number;
  azimuthSigmaDeg: number;
  azimuthSigmaLandmarkDeg: number;
  v0SigmaFrac: number;
  dragScaleSigmaFrac: number;
  windSigmaMs: number;
  /** Widen the wind uncertainty using the reported gusts. */
  gustWidening: boolean;
  audio: boolean;
  theme: 'light' | 'dark';
  satelliteProvider: SatelliteProviderId;
  /** Provider API keys: kept on this phone only, never exported. */
  maptilerKey: string;
  esriKey: string;
  /** Custom provider. */
  satelliteUrl: string;
  satelliteAttribution: string;
  /** Base layer last chosen on the map. */
  mapBase: 'map' | 'satellite';
  devMode: boolean;
  activeCannonId: string;
  activeSettingId: string;
  activeProjectileId: string;
  /** Session id for which the safety reminder was acknowledged. */
  safetyAckSession: string;
  /** This phone is spotting for someone else's shots (opened from their invite). */
  spotter: { invite: SpotInvite; marks: SpotMark[] } | null;
  /** Camera view: field of view across the long side of the picture, degrees. */
  cameraFovDeg: number;
  /** Camera view: height of the phone above the ground, m. */
  cameraHeightM: number;
  /** Target game in progress (null when not playing). */
  game: GameState | null;
  /** Draw the keep-clear area (furthest any shot could land) on the map. */
  showFootprint: boolean;
  /** Detect shots from the jolt of firing (accelerometer). */
  autoDetect: boolean;
  /** Jolt threshold, m/s² (gravity removed). */
  detectThresholdMs2: number;
  /** Count down to the predicted landing after firing. */
  countdown: boolean;
  /** Speak the countdown (else beeps). */
  countdownVoice: boolean;
  /** Use Environment Agency 1 m LIDAR ground and surface data where available (England). */
  useEaLidar: boolean;
  /** Weight of the next potato, kg; null means the projectile's typical weight. */
  nextMassKg: number | null;
  /** Last weather (fetched or manual), restored on start. */
  atmosphere?: Atmosphere;
}

export interface GameState {
  id: string;
  players: string[];
  /** Whose turn it is. */
  player: string;
  rings: { radius: number; points: number }[];
  /** Pass to the next player after each saved shot. */
  rotate: boolean;
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
