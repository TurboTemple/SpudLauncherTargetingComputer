/** Sensor pipeline: orientation → barrel vector → smoothing → corrections → steadiness; GPS → launch point. */

import { toDeg, toRad } from '../core/angles';
import { HeadingJumpDetector, SteadinessDetector, VectorEma } from '../core/filters';
import { directionToAim } from '../core/orientation';
import { FixAverager, watchGps, type Fix } from '../sensors/gps';
import { HeadingProvider, requestOrientationPermission, startOrientation, type OrientationSample } from '../sensors/orientation';
import { replay, SensorRecorder, type Recording } from '../sensors/recorder';
import { startSimulator } from '../sensors/simulator';
import { WakeLockManager } from '../sensors/wakeLock';
import {
  cannon,
  compassAccuracy,
  declinationDeg,
  gpsError,
  headingMode,
  lastFix,
  launch,
  launchAveraging,
  liveAim,
  lockedAim,
  metalWarningAt,
  northReferenced,
  recording,
  sensorPermission,
  sensorsRunning,
  session,
  settings,
  simState,
  simulatorOn,
  steady,
  toast,
  type AimReading,
} from './store';

const heading = new HeadingProvider();
const ema = new VectorEma(0.15);
const steadiness = new SteadinessDetector();
const metal = new HeadingJumpDetector();
export const recorder = new SensorRecorder();
export const wakeLock = new WakeLockManager();

let stopOrientation: (() => void) | null = null;
let stopGps: (() => void) | null = null;
let stopSim: (() => void) | null = null;
let stopReplay: (() => void) | null = null;
let launchAverager: FixAverager | null = null;
let standingAverager: FixAverager | null = null;

const wrap360 = (d: number) => ((d % 360) + 360) % 360;

/** Corrected angles from raw: elevation − mount offset; azimuth + declination + heading bias. */
export function correctAim(elevationRawDeg: number, azimuthRawDeg: number): { elevationDeg: number; azimuthDeg: number } {
  const c = cannon.peek();
  return {
    elevationDeg: elevationRawDeg - (c?.mountTiltOffsetDeg ?? 0),
    azimuthDeg: wrap360(azimuthRawDeg + (declinationDeg.peek() ?? 0) + (session.peek()?.headingBiasDeg ?? 0)),
  };
}

export function handleOrientation(s: OrientationSample): void {
  recorder.add({ type: 'orientation', sample: s });
  // Events arriving prove access, whatever requestPermission() reported.
  if (s.mode !== 'simulator' && sensorPermission.peek() !== 'granted') sensorPermission.value = 'granted';
  const raw = heading.process(s, cannon.peek()?.mountReversed ?? false);
  if (headingMode.peek() !== raw.mode) headingMode.value = raw.mode;
  if (northReferenced.peek() !== raw.northReferenced) northReferenced.value = raw.northReferenced;
  if (raw.compassAccuracy !== undefined && compassAccuracy.peek() !== raw.compassAccuracy) compassAccuracy.value = raw.compassAccuracy;

  const st = settings.peek();
  ema.tau = st.emaTauS;
  steadiness.thresholds = { window: st.steadyWindowS, elevationStd: toRad(st.steadyElevStdDeg), azimuthStd: toRad(st.steadyAzStdDeg) };
  const d = ema.update(raw.d, s.t);
  const a = directionToAim(d);
  const elevationRawDeg = toDeg(a.elevation);
  const azimuthRawDeg = toDeg(a.azimuth);
  const reading: AimReading = { t: s.t, elevationRawDeg, azimuthRawDeg, ...correctAim(elevationRawDeg, azimuthRawDeg) };
  liveAim.value = reading;

  const stats = steadiness.push(s.t, toRad(reading.elevationDeg), toRad(reading.azimuthDeg));
  steady.value = stats;
  // Jumps are judged on the unsmoothed vector; smoothing would hide them.
  const un = directionToAim(raw.d);
  if (raw.northReferenced && metal.push(s.t, un.elevation, un.azimuth)) metalWarningAt.value = s.t;

  if (st.autoLock && !lockedAim.peek() && stats.steadyFor >= st.autoLockAfterS) lockAim();
}

export function lockAim(): void {
  const a = liveAim.peek();
  if (a) lockedAim.value = a;
}

export function unlockAim(): void {
  lockedAim.value = null;
}

/** Re-apply corrections after declination, bias or mount offset change. */
export function refreshCorrections(): void {
  const fix = (r: AimReading | null) => (r ? { ...r, ...correctAim(r.elevationRawDeg, r.azimuthRawDeg) } : null);
  liveAim.value = fix(liveAim.peek());
  if (lockedAim.peek()) lockedAim.value = fix(lockedAim.peek());
}

export function handleFix(f: Fix): void {
  recorder.add({ type: 'gps', fix: f });
  lastFix.value = f;
  gpsError.value = null;
  if (launchAverager) {
    const r = launchAverager.push(f);
    launchAveraging.value = r;
    if (r.done) {
      launchAverager = null;
      launch.value = { lat: r.lat, lon: r.lon, accuracyM: r.accuracy, source: 'gps' };
      toast(`Launch point set from ${r.count} GPS fixes (±${r.accuracy.toFixed(1)} m)`);
    }
  }
  const rec = recording.peek();
  if (standingAverager && rec) {
    const r = standingAverager.push(f);
    recording.value = { ...rec, standing: r };
    if (r.done) {
      standingAverager = null;
      recording.value = {
        ...rec,
        standing: null,
        draft: { ...rec.draft, impact: { lat: r.lat, lon: r.lon, sigmaM: Math.max(r.accuracy, 1), method: 'gps' } },
      };
    }
  }
}

/** Average 10 s of fixes better than 10 m for the launch point. */
export function averageLaunchFromGps(): void {
  launchAverager = new FixAverager(10, 10);
  launchAveraging.value = launchAverager.result();
}

export function cancelLaunchAveraging(): void {
  launchAverager = null;
  launchAveraging.value = null;
}

/** "I'm standing on it": 5 s GPS average for the impact mark. */
export function startStandingMark(): void {
  standingAverager = new FixAverager(5, 50);
  const rec = recording.peek();
  if (rec) recording.value = { ...rec, standing: standingAverager.result() };
}

/** Start everything; must run from a tap so iOS can show its permission prompt. */
export async function startSensors(): Promise<void> {
  const perm = await requestOrientationPermission();
  sensorPermission.value = perm;
  // Listen even after a reported refusal: some browsers still deliver events, and the first one flips the state.
  if (perm !== 'unsupported' && !stopOrientation && !simulatorOn.peek()) stopOrientation = startOrientation(handleOrientation);
  if (!stopGps) stopGps = watchGps(handleFix, (msg) => (gpsError.value = msg));
  void wakeLock.enable();
  sensorsRunning.value = true;
  if (!launch.peek() && !launchAverager) averageLaunchFromGps();
}

export function resetFilters(): void {
  heading.reset();
  ema.reset();
  steadiness.reset();
  metal.reset();
}

export function setSimulator(on: boolean): void {
  simulatorOn.value = on;
  resetFilters();
  if (on) {
    stopOrientation?.();
    stopOrientation = null;
    stopSim ??= startSimulator(() => simState.peek(), handleOrientation);
    sensorsRunning.value = true;
  } else {
    stopSim?.();
    stopSim = null;
    if (sensorsRunning.peek() && sensorPermission.peek() !== 'unsupported') stopOrientation = startOrientation(handleOrientation);
  }
}

export function replayRecording(rec: Recording, done: () => void): void {
  stopReplay?.();
  stopOrientation?.();
  stopOrientation = null;
  stopSim?.();
  stopSim = null;
  resetFilters();
  sensorsRunning.value = true;
  stopReplay = replay(rec, { orientation: handleOrientation, gps: handleFix, done });
}

export function stopReplaying(): void {
  stopReplay?.();
  stopReplay = null;
}

