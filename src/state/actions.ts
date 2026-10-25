/** User actions and startup: profiles, sessions, weather, shot recording, calibration, wizards, export. */

import { effect } from '@preact/signals';
import { circularMean, toDeg, toRad, wrapPi } from '../core/angles';
import { airDensity, DEFAULT_SHEAR_EXPONENT, dragFactor, KELVIN, referenceWind, windVector } from '../core/atmosphere';
import type { CalShot } from '../core/calibration';
import { mean, std } from '../core/filters';
import { bearing } from '../core/geo';
import { landmarkOffset } from '../core/orientation';
import * as store from '../data/db';
import { DEFAULT_SETTINGS, defaultCannon, defaultProjectile, newId } from '../data/defaults';
import type { AppSettings, Atmosphere, CannonProfile, GameState, Projectile, Session, Shot } from '../data/model';
import { matchMarks, type SpotInvite, type SpotMarks } from '../data/spotter';
import { fetchWeather, fetchWindProfile } from '../data/weather';
import { distanceM as distanceM_, enuOf, geoOf, latLonOf, type LatLon } from '../geoDeg';
import { DEFAULT_RINGS, scoreShot } from '../core/game';
import { refreshCorrections, setShotHandler, startStandingMark, unlockAim } from './sensors';
import { groundHeights, solver } from './solver';
import {
  atmosphere,
  cannon,
  cannons,
  declinationDeg,
  fitBusy,
  fitResult,
  lastFix,
  launch,
  launchSpeed,
  liveAim,
  lockedAim,
  potatoMassKg,
  powerSetting,
  prediction,
  projectile,
  projectiles,
  ready,
  recording,
  session,
  sessions,
  settings,
  shear,
  shots,
  steady,
  target,
  terrain,
  toast,
  wizard,
  type AimReading,
} from './store';

const SESSION_GAP_MS = 8 * 3600 * 1000;

export async function bootstrap(): Promise<void> {
  const [stored, cs, ps, ss, sh] = await Promise.all([
    store.loadSettings(),
    store.allProfiles(),
    store.allProjectiles(),
    store.allSessions(),
    store.allShots(),
  ]);
  if (!cs.length) {
    const c = defaultCannon();
    await store.putProfile(c);
    cs.push(c);
  }
  if (!ps.length) {
    const p = defaultProjectile(cs[0]!.barrelDiameterM);
    await store.putProjectile(p);
    ps.push(p);
  }
  const s: AppSettings = { ...DEFAULT_SETTINGS, ...stored };
  // Settings saved before the wind-profile option: the old shear toggle meant the 1/7 rule.
  const legacy = stored as Partial<AppSettings> & { windShear?: boolean };
  if (stored.windProfile === undefined && legacy.windShear !== undefined) s.windProfile = legacy.windShear ? 'rule' : 'off';
  // Settings saved before satellite presets existed: a tile URL means the custom provider.
  if (stored.satelliteProvider === undefined && s.satelliteUrl) s.satelliteProvider = 'custom';
  const c = cs.find((x) => x.id === s.activeCannonId) ?? cs[0]!;
  s.activeCannonId = c.id;
  if (!c.settings.some((x) => x.id === s.activeSettingId)) s.activeSettingId = c.settings[0]?.id ?? '';
  if (!ps.some((x) => x.id === s.activeProjectileId)) s.activeProjectileId = ps[0]!.id;

  const latest = [...ss].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1);
  let sess = latest;
  if (!sess || Date.now() - Date.parse(sess.startedAt) > SESSION_GAP_MS) {
    sess = { id: newId(), startedAt: new Date().toISOString(), landmarks: [] };
    await store.putSession(sess);
  }

  settings.value = s;
  cannons.value = cs;
  projectiles.value = ps;
  session.value = sess;
  sessions.value = ss.some((x) => x.id === sess.id) ? ss : [...ss, sess];
  shots.value = sh;
  if (s.atmosphere) atmosphere.value = s.atmosphere;
  await store.saveSettings({ activeCannonId: s.activeCannonId, activeSettingId: s.activeSettingId, activeProjectileId: s.activeProjectileId });

  // Fetch weather when the launch point is set, unless the user entered it by hand or it is fresh.
  effect(() => {
    const l = launch.value;
    const atm = atmosphere.peek();
    if (!l || atm.source === 'manual') return;
    if (atm.fetchedAt && Date.now() - Date.parse(atm.fetchedAt) < 3600 * 1000) return;
    void fetchWeatherNow(true);
  });
  setShotHandler(shotDetected);
  ready.value = true;
}

export function updateSettings(patch: Partial<AppSettings>): void {
  settings.value = { ...settings.value, ...patch };
  void store.saveSettings(patch);
}

// --- Profiles ------------------------------------------------------------------------

export async function saveCannon(c: CannonProfile): Promise<void> {
  const list = cannons.value.filter((x) => x.id !== c.id);
  const idx = cannons.value.findIndex((x) => x.id === c.id);
  list.splice(idx < 0 ? list.length : idx, 0, c);
  cannons.value = list;
  await store.putProfile(c);
  refreshCorrections();
}

export async function addCannon(): Promise<void> {
  const c = defaultCannon();
  c.name = `Cannon ${cannons.value.length + 1}`;
  await saveCannon(c);
  updateSettings({ activeCannonId: c.id, activeSettingId: c.settings[0]!.id });
}

export async function removeCannon(id: string): Promise<void> {
  if (cannons.value.length <= 1) return;
  cannons.value = cannons.value.filter((c) => c.id !== id);
  await store.deleteProfile(id);
  if (settings.value.activeCannonId === id) {
    const c = cannons.value[0]!;
    updateSettings({ activeCannonId: c.id, activeSettingId: c.settings[0]?.id ?? '' });
  }
}

export async function saveProjectile(p: Projectile): Promise<void> {
  const idx = projectiles.value.findIndex((x) => x.id === p.id);
  const list = projectiles.value.slice();
  if (idx < 0) list.push(p);
  else list[idx] = p;
  projectiles.value = list;
  await store.putProjectile(p);
}

export async function addProjectile(): Promise<void> {
  const p = defaultProjectile(cannon.value?.barrelDiameterM ?? 0.05);
  p.name = `Projectile ${projectiles.value.length + 1}`;
  await saveProjectile(p);
  updateSettings({ activeProjectileId: p.id });
}

export async function removeProjectile(id: string): Promise<void> {
  if (projectiles.value.length <= 1) return;
  projectiles.value = projectiles.value.filter((p) => p.id !== id);
  await store.deleteProjectile(id);
  if (settings.value.activeProjectileId === id) updateSettings({ activeProjectileId: projectiles.value[0]!.id });
}

// --- Session -------------------------------------------------------------------------

export async function updateSession(patch: Partial<Session>): Promise<void> {
  const s = session.value;
  if (!s) return;
  const next = { ...s, ...patch };
  session.value = next;
  sessions.value = sessions.value.map((x) => (x.id === next.id ? next : x));
  await store.putSession(next);
  refreshCorrections();
}

export async function startNewSession(): Promise<void> {
  const s: Session = { id: newId(), startedAt: new Date().toISOString(), landmarks: [] };
  session.value = s;
  sessions.value = [...sessions.value, s];
  await store.putSession(s);
  launch.value = null;
  refreshCorrections();
  toast('New session started: set the launch point and sight a landmark');
}

export function acknowledgeSafety(): void {
  if (session.value) updateSettings({ safetyAckSession: session.value.id });
}

// --- Launch point and weather --------------------------------------------------------

export function setLaunchFromMap(p: LatLon): void {
  launch.value = { lat: p.lat, lon: p.lon, accuracyM: 1, source: 'map' };
}

export function setAtmosphere(a: Atmosphere): void {
  atmosphere.value = a;
  updateSettings({ atmosphere: a });
}

export async function fetchWeatherNow(quiet = false): Promise<void> {
  const where = launch.value ?? lastFix.value;
  if (!where) {
    if (!quiet) toast('Need a launch point or GPS fix to fetch weather', 'warn');
    return;
  }
  try {
    // The profile and trend are extras: if that request fails, current weather still applies.
    const [wx, profile] = await Promise.allSettled([fetchWeather(where.lat, where.lon), fetchWindProfile(where.lat, where.lon)]);
    if (wx.status === 'rejected') throw wx.reason;
    setAtmosphere({ ...wx.value, ...(profile.status === 'fulfilled' ? profile.value : {}) });
    if (!quiet) toast('Weather updated');
  } catch (e) {
    if (!quiet) toast(`Weather fetch failed: ${(e as Error).message}`, 'error');
  }
}

// --- Shot recording ------------------------------------------------------------------

/** Freeze the current aim, launch point, weather and settings into a draft shot. Returns an error message or null. */
export function beginRecord(): string | null {
  const a = lockedAim.value ?? liveAim.value;
  const l = launch.value;
  const c = cannon.value;
  const ps = powerSetting.value;
  const p = projectile.value;
  const v = launchSpeed.value;
  const pred = prediction.value;
  const sess = session.value;
  if (!a) return 'No aim yet: start the sensors';
  if (!l) return 'Set the launch point first';
  if (!c || !ps || !p || !v || !sess) return 'Set up a cannon and projectile first';
  lockedAim.value = a;
  const impact = pred ? latLonOf(l, pred.impact[0], pred.impact[1]) : l;
  const ground = terrain.value.launchGroundM;
  const draft: Shot = {
    id: newId(),
    sessionId: sess.id,
    time: new Date().toISOString(),
    cannonId: c.id,
    settingId: ps.id,
    projectileId: p.id,
    massKg: potatoMassKg.value,
    launch: { lat: l.lat, lon: l.lon, groundHeightM: Number.isFinite(ground) ? ground : 0, accuracyM: l.accuracyM },
    aim: {
      elevationRawDeg: a.elevationRawDeg,
      azimuthRawDeg: a.azimuthRawDeg,
      mountOffsetDeg: c.mountTiltOffsetDeg,
      declinationDeg: declinationDeg.value ?? 0,
      headingBiasDeg: sess.headingBiasDeg ?? 0,
    },
    atmosphere: { ...atmosphere.value },
    conditions: { muzzleHeightM: c.muzzleHeightM, shearExponent: shear.value.alpha, v0: v.v0, dragScale: p.dragScale },
    predicted: { lat: impact.lat, lon: impact.lon, flightTimeS: pred?.tof ?? NaN },
  };
  const g = settings.value.game;
  const t = target.value;
  if (g && t) draft.game = { id: g.id, player: g.player, target: { lat: t.lat, lon: t.lon } };
  recording.value = { draft, firedAt: null, standing: null };
  return null;
}

/** Start the flight clock; `at` is a performance time in seconds (the detected jolt), default now. */
/** Score a game shot once its impact is known (no-op for other shots). */
export function scoreGameShot(s: Shot): Shot {
  if (!s.game || !s.impact) return s;
  const distanceM = distanceM_(s.game.target, s.impact);
  const rings = settings.value.game?.id === s.game.id ? settings.value.game.rings : undefined;
  return { ...s, game: { ...s.game, distanceM, points: scoreShot(distanceM, rings) } };
}

export function startGame(players: string[]): void {
  const list = players.map((p) => p.trim()).filter(Boolean);
  const names = list.length ? list : ['Player 1'];
  updateSettings({ game: { id: newId(), players: names, player: names[0]!, rings: DEFAULT_RINGS.map((r) => ({ ...r })), rotate: true } });
}

export function updateGame(patch: Partial<GameState>): void {
  const g = settings.value.game;
  if (g) updateSettings({ game: { ...g, ...patch } });
}

export function endGame(): void {
  updateSettings({ game: null });
}

export function markFired(at = performance.now() / 1000, detected = false): void {
  const r = recording.value;
  if (!r) return;
  const firedAt = new Date(Date.now() - (performance.now() / 1000 - at) * 1000).toISOString();
  recording.value = { ...r, firedAt: at, draft: { ...r.draft, flightTimeS: undefined, firedAt, ...(detected ? { detected: true } : {}) } };
}

/**
 * The accelerometer felt a shot. Freeze the aim from just before the jolt (recoil disturbs the
 * sensors), start a shot record if none is open, and start its flight clock.
 */
export function shotDetected(at: number, magnitude: number, preShot: AimReading | null): void {
  const open = recording.value;
  if (open) {
    if (open.firedAt === null && open.draft.flightTimeS === undefined) markFired(at, true);
    return;
  }
  if (preShot) lockedAim.value = preShot;
  const err = beginRecord();
  if (err) {
    toast(`Shot detected but not recorded: ${err}`, 'warn');
    return;
  }
  markFired(at, true);
  toast(`Shot detected (${magnitude.toFixed(0)} m/s² jolt). Tap Landed when it lands.`);
}

export function markLanded(): void {
  const r = recording.value;
  if (r?.firedAt) recording.value = { ...r, firedAt: null, draft: { ...r.draft, flightTimeS: performance.now() / 1000 - r.firedAt } };
}

/** Mark the impact by long-press on the map (σ 2 m). */
export async function markImpactAt(p: LatLon): Promise<void> {
  const r = recording.value;
  if (!r) return;
  const l = r.draft.launch;
  const e = enuOf(l, p);
  const h = terrain.value.loaded ? await groundHeights([[e.x, e.y]]) : null;
  const cur = recording.value;
  if (!cur) return;
  recording.value = {
    ...cur,
    draft: {
      ...cur.draft,
      impact: { lat: p.lat, lon: p.lon, sigmaM: 2, method: 'tap', ...(h ? { groundHeightM: l.groundHeightM + h[0]! } : {}) },
    },
  };
}

export function markImpactByGps(): void {
  startStandingMark();
}

export async function saveRecord(): Promise<void> {
  const r = recording.value;
  if (!r) return;
  const shot = scoreGameShot(r.draft);
  await store.putShot(shot);
  shots.value = [...shots.value, shot];
  recording.value = null;
  unlockAim();
  const g = settings.value.game;
  if (shot.game?.points !== undefined) {
    toast(`${shot.game.player}: ${shot.game.distanceM!.toFixed(1)} m from the target, ${shot.game.points} points`, 'info', 6000);
  } else {
    toast(shot.impact ? 'Shot saved' : 'Shot saved without an impact mark (not used for fitting)');
  }
  if (g && shot.game && g.rotate && g.players.length > 1) {
    const i = g.players.indexOf(g.player);
    updateGame({ player: g.players[(i + 1) % g.players.length]! });
  }
}

export function cancelRecord(): void {
  recording.value = null;
  unlockAim();
}

export async function toggleExclude(id: string): Promise<void> {
  const s = shots.value.find((x) => x.id === id);
  if (!s) return;
  const next = { ...s, excluded: !s.excluded };
  shots.value = shots.value.map((x) => (x.id === id ? next : x));
  await store.putShot(next);
}

export async function removeShot(id: string): Promise<void> {
  shots.value = shots.value.filter((x) => x.id !== id);
  await store.deleteShot(id);
}

// --- Calibration ---------------------------------------------------------------------

export function toCalShot(s: Shot, p: Projectile, massAffectsSpeed = false): CalShot | null {
  if (!s.impact || s.excluded) return null;
  const e = enuOf(s.launch, s.impact);
  const rho = airDensity(s.atmosphere.pressureHpa * 100, s.atmosphere.tempC + KELVIN);
  const z = s.impact.groundHeightM !== undefined ? s.impact.groundHeightM - s.launch.groundHeightM : 0;
  const alpha = s.conditions.shearExponent ?? (s.conditions.windShear ? DEFAULT_SHEAR_EXPONENT : 0);
  return {
    id: s.id,
    setting: s.settingId,
    projectile: s.projectileId,
    session: s.sessionId,
    elevation: toRad(s.aim.elevationRawDeg - s.aim.mountOffsetDeg),
    azimuth: toRad(s.aim.azimuthRawDeg + s.aim.declinationDeg + s.aim.headingBiasDeg),
    h0: s.conditions.muzzleHeightM,
    kUnit: dragFactor(rho, p.cd, p.diameterM, s.massKg ?? p.massKg, 1),
    ...(massAffectsSpeed && s.massKg ? { speedScale: Math.sqrt(p.massKg / s.massKg) } : {}),
    wind: windVector(
      referenceWind(s.atmosphere.windSpeedMs, s.atmosphere.source === 'manual' ? s.atmosphere.measuredAtM : undefined, alpha),
      toRad(s.atmosphere.windFromDeg),
    ),
    shearExponent: alpha,
    impact: { x: e.x, y: e.y, z },
    sigmaM: s.impact.sigmaM,
    ...(s.flightTimeS !== undefined && Number.isFinite(s.flightTimeS) ? { flightTime: s.flightTimeS } : {}),
  };
}

export async function runFit(): Promise<void> {
  const byId = new Map(projectiles.value.map((p) => [p.id, p]));
  const energyCannons = new Set(cannons.value.filter((c) => c.massAffectsSpeed).map((c) => c.id));
  const cal = shots.value.flatMap((s) => {
    const p = byId.get(s.projectileId);
    const c = p ? toCalShot(s, p, energyCannons.has(s.cannonId)) : null;
    return c ? [c] : [];
  });
  if (cal.length === 0) {
    toast('Need marked shots to fit', 'warn');
    return;
  }
  const v0: Record<string, number> = {};
  for (const c of cannons.value) for (const st of c.settings) v0[st.id] = st.v0;
  const dragScale = Object.fromEntries(projectiles.value.map((p) => [p.id, p.dragScale]));
  fitBusy.value = true;
  const res = await solver.request({ kind: 'fit', shots: cal, start: { v0, dragScale, headingBias: {} } });
  fitBusy.value = false;
  if (res) fitResult.value = { result: res, at: new Date().toISOString(), shotIds: cal.map((c) => c.id) };
}

export async function applyFit(): Promise<void> {
  const f = fitResult.value;
  if (!f) return;
  const r = f.result;
  const at = f.at;
  for (const c of cannons.value) {
    let changed = false;
    const settingsNext = c.settings.map((st) => {
      const fv = r.v0[st.id];
      if (!fv?.fitted) return st;
      changed = true;
      const scatter = r.speedScatter[st.id]?.sigma;
      return { ...st, v0: fv.value, v0Sigma: scatter !== undefined && Number.isFinite(scatter) ? scatter : st.v0Sigma, fittedAt: at };
    });
    if (changed) await saveCannon({ ...c, settings: settingsNext });
  }
  for (const p of projectiles.value) {
    const fv = r.dragScale[p.id];
    if (!fv?.fitted) continue;
    await saveProjectile({ ...p, dragScale: fv.value, dragScaleSigma: Number.isFinite(fv.se) ? fv.se : p.dragScaleSigma, fittedAt: at });
  }
  const sess = session.value;
  const b = sess ? r.headingBias[sess.id] : undefined;
  if (sess && b?.fitted) {
    const last = shots.value.filter((s) => s.sessionId === sess.id).at(-1);
    await updateSession({ headingBiasDeg: (last?.aim.headingBiasDeg ?? 0) + toDeg(b.value), headingBiasSource: 'fit' });
  }
  toast('Calibration applied');
}

// --- Wizards -------------------------------------------------------------------------

/**
 * Wait (up to 4 s) for STEADY so the smoothing has settled, then average the raw tilt for 2 s.
 * STEADY only counts once a full window has passed since the tap, so it reflects the new position.
 */
function captureElevation(ms = 2000): Promise<{ mean: number; sd: number }> {
  return new Promise((resolve) => {
    const vals: number[] = [];
    const t0 = performance.now();
    const windowMs = settings.peek().steadyWindowS * 1000 + 100;
    let collecting = false;
    const begin = () => {
      if (collecting) return;
      collecting = true;
      setTimeout(() => {
        dispose();
        resolve({ mean: mean(vals), sd: std(vals) });
      }, ms);
    };
    const settle = setTimeout(begin, 4000);
    const dispose = effect(() => {
      const a = liveAim.value;
      if (!collecting && steady.value?.steady && performance.now() - t0 >= windowMs) {
        clearTimeout(settle);
        begin();
      }
      if (collecting && a) vals.push(a.elevationRawDeg);
    });
  });
}

export function startMountWizard(): void {
  wizard.value = { kind: 'mount', step: 1, capturing: false };
}

/** Capture e1 (step 1) or e2 (step 2) as a 2 s average of the raw elevation. */
export async function captureMountStep(): Promise<void> {
  const w = wizard.value;
  if (w?.kind !== 'mount' || w.capturing || !liveAim.value) return;
  wizard.value = { ...w, capturing: true };
  const r = await captureElevation();
  const cur = wizard.value;
  if (cur?.kind !== 'mount') return;
  wizard.value = w.step === 1 ? { ...cur, e1: r, step: 2, capturing: false } : { ...cur, e2: r, step: 3, capturing: false };
}

export async function finishMountWizard(): Promise<void> {
  const w = wizard.value;
  const c = cannon.value;
  if (w?.kind !== 'mount' || !w.e1 || !w.e2 || !c) return;
  // Offset = (e1 + e2) / 2; the surface slope (e1 − e2) / 2 drops out.
  const offset = (w.e1.mean + w.e2.mean) / 2;
  const sigma = 0.5 * Math.hypot(w.e1.sd, w.e2.sd);
  await saveCannon({ ...c, mountTiltOffsetDeg: offset, mountTiltSigmaDeg: Math.max(sigma, 0.02) });
  wizard.value = null;
  toast(`Mount offset ${offset.toFixed(2)}° saved`);
}

export function startLandmarkWizard(): void {
  if (!launch.value) {
    toast('Set the launch point before sighting landmarks', 'warn');
    return;
  }
  wizard.value = { kind: 'landmark', picked: null, offsets: [] };
}

export function pickLandmark(p: LatLon): void {
  const w = wizard.value;
  if (w?.kind === 'landmark') wizard.value = { ...w, picked: p };
}

/** Barrel pointed at the picked landmark: offset = map bearing − measured azimuth (after declination). */
export async function setLandmark(): Promise<void> {
  const w = wizard.value;
  const l = launch.value;
  const a = liveAim.value;
  if (w?.kind !== 'landmark' || !w.picked || !l || !a) return;
  const mapBearing = bearing(geoOf(l), geoOf(w.picked));
  const measured = toRad(a.azimuthRawDeg + (declinationDeg.value ?? 0));
  const offsets = [...w.offsets, landmarkOffset(mapBearing, measured)];
  const avg = offsets.length > 1 ? wrapPi(circularMean(offsets)) : offsets[0]!;
  const landmarks = [...(session.value?.landmarks ?? []).slice(-1), { lat: w.picked.lat, lon: w.picked.lon }];
  await updateSession({ headingBiasDeg: toDeg(avg), headingBiasSource: 'landmark', landmarks });
  if (offsets.length >= 2) {
    const spread = Math.abs(toDeg(wrapPi(offsets[0]! - offsets[1]!)));
    wizard.value = null;
    toast(`Heading offset ${toDeg(avg).toFixed(1)}° from 2 landmarks (they differ by ${spread.toFixed(1)}°)`);
  } else {
    wizard.value = { kind: 'landmark', picked: null, offsets };
    toast(`Heading offset ${toDeg(avg).toFixed(1)}° set. Sight a second landmark to average, or finish.`);
  }
}

export function closeWizard(): void {
  wizard.value = null;
}

// --- Spotter -------------------------------------------------------------------------

/** Apply a spotter's marks to shots (and an open record) by matching on fire time. */
export async function importSpotterMarks(marks: SpotMarks): Promise<void> {
  const rec = recording.value;
  const pool: (Shot & { open?: true })[] = [...shots.value.filter((s) => !s.impact), ...(rec && !rec.draft.impact ? [{ ...rec.draft, open: true as const }] : [])];
  const fired = pool
    .filter((s) => s.firedAt)
    .map((s) => ({ id: s.id, firedAt: Date.parse(s.firedAt!) / 1000, flightTime: s.predicted.flightTimeS }));
  const pairs = matchMarks(
    marks.m.map(([t, lat, lon]) => ({ t, lat, lon })),
    fired,
  );
  let matched = 0;
  for (const { mark, shotId } of pairs) {
    if (!shotId) continue;
    const s = pool.find((x) => x.id === shotId)!;
    const l = s.launch;
    const e = enuOf(l, mark);
    const h = terrain.value.loaded && launch.value && Math.abs(launch.value.lat - l.lat) < 1e-4 ? await groundHeights([[e.x, e.y]]) : null;
    const impact = { lat: mark.lat, lon: mark.lon, sigmaM: 2, method: 'spotter' as const, ...(h ? { groundHeightM: l.groundHeightM + h[0]! } : {}) };
    if (s.open) {
      const cur = recording.value;
      if (cur) recording.value = { ...cur, draft: { ...cur.draft, impact } };
    } else {
      const next = scoreGameShot({ ...s, impact });
      shots.value = shots.value.map((x) => (x.id === next.id ? next : x));
      await store.putShot(next);
    }
    matched++;
  }
  const unmatched = pairs.length - matched;
  toast(`Spotter: ${matched} landing${matched === 1 ? '' : 's'} matched to shots${unmatched ? `, ${unmatched} unmatched (no shot fired just before)` : ''}`, matched ? 'info' : 'warn', 7000);
}

/** Open from a spotter invite: this phone becomes the spotter. */
export function becomeSpotter(invite: SpotInvite): void {
  const cur = settings.value.spotter;
  updateSettings({ spotter: cur && cur.invite.s === invite.s ? { ...cur, invite } : { invite, marks: [] } });
}

export function addSpotterMark(p: LatLon): void {
  const cur = settings.value.spotter;
  if (cur) updateSettings({ spotter: { ...cur, marks: [...cur.marks, { t: Date.now() / 1000, lat: p.lat, lon: p.lon }] } });
}

export function removeSpotterMark(t: number): void {
  const cur = settings.value.spotter;
  if (cur) updateSettings({ spotter: { ...cur, marks: cur.marks.filter((m) => m.t !== t) } });
}

export function leaveSpotterMode(): void {
  updateSettings({ spotter: null });
}

// --- Export / import -----------------------------------------------------------------

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export async function exportJson(): Promise<void> {
  download(`spud-export-${stamp()}.json`, JSON.stringify(await store.exportAll(), null, 2), 'application/json');
}

export function exportCsv(): void {
  const names = {
    cannon: Object.fromEntries(cannons.value.map((c) => [c.id, c.name])),
    setting: Object.fromEntries(cannons.value.flatMap((c) => c.settings.map((s) => [s.id, s.label]))),
    projectile: Object.fromEntries(projectiles.value.map((p) => [p.id, p.name])),
  };
  download(`spud-shots-${stamp()}.csv`, store.shotsToCsv(shots.value, names), 'text/csv');
}

export async function importJson(file: File): Promise<void> {
  try {
    const res = await store.importAll(JSON.parse(await file.text()));
    const [cs, ps, ss, sh] = await Promise.all([store.allProfiles(), store.allProjectiles(), store.allSessions(), store.allShots()]);
    cannons.value = cs;
    projectiles.value = ps;
    sessions.value = ss.some((x) => x.id === session.value?.id) || !session.value ? ss : [...ss, session.value];
    shots.value = sh;
    toast(`Imported ${res.shots} shots`);
  } catch (e) {
    toast(`Import failed: ${(e as Error).message}`, 'error');
  }
}

export { download };
