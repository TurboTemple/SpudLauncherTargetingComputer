/** IndexedDB storage: profiles, projectiles, sessions, shots, settings. Versioned with migrations. */

import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type { AppSettings, CannonProfile, ExportBundle, Projectile, Session, Shot } from './model';

interface SpudDB extends DBSchema {
  profiles: { key: string; value: CannonProfile };
  projectiles: { key: string; value: Projectile };
  sessions: { key: string; value: Session };
  shots: { key: string; value: Shot; indexes: { bySession: string; byTime: string } };
  settings: { key: string; value: { key: string; value: unknown } };
}

type UpgradeTx = IDBPTransaction<SpudDB, StoreNames<SpudDB>[], 'versionchange'>;

/**
 * One entry per schema version: MIGRATIONS[v] upgrades from version v to v + 1.
 * Never edit a released migration; append a new one and bump DB_VERSION.
 */
const MIGRATIONS: ((db: IDBPDatabase<SpudDB>, tx: UpgradeTx) => void)[] = [
  (db) => {
    db.createObjectStore('profiles', { keyPath: 'id' });
    db.createObjectStore('projectiles', { keyPath: 'id' });
    db.createObjectStore('sessions', { keyPath: 'id' });
    const shots = db.createObjectStore('shots', { keyPath: 'id' });
    shots.createIndex('bySession', 'sessionId');
    shots.createIndex('byTime', 'time');
    db.createObjectStore('settings', { keyPath: 'key' });
  },
];

export const DB_VERSION = MIGRATIONS.length;

let dbPromise: Promise<IDBPDatabase<SpudDB>> | null = null;

export function db(): Promise<IDBPDatabase<SpudDB>> {
  dbPromise ??= openDB<SpudDB>('spud-app', DB_VERSION, {
    upgrade(database, oldVersion, newVersion, tx) {
      for (let v = oldVersion; v < (newVersion ?? DB_VERSION); v++) MIGRATIONS[v]!(database, tx);
    },
  });
  return dbPromise;
}

export async function allProfiles(): Promise<CannonProfile[]> {
  return (await db()).getAll('profiles');
}
export async function putProfile(p: CannonProfile): Promise<void> {
  await (await db()).put('profiles', p);
}
export async function deleteProfile(id: string): Promise<void> {
  await (await db()).delete('profiles', id);
}

export async function allProjectiles(): Promise<Projectile[]> {
  return (await db()).getAll('projectiles');
}
export async function putProjectile(p: Projectile): Promise<void> {
  await (await db()).put('projectiles', p);
}
export async function deleteProjectile(id: string): Promise<void> {
  await (await db()).delete('projectiles', id);
}

export async function allSessions(): Promise<Session[]> {
  return (await db()).getAll('sessions');
}
export async function putSession(s: Session): Promise<void> {
  await (await db()).put('sessions', s);
}

export async function allShots(): Promise<Shot[]> {
  return (await db()).getAllFromIndex('shots', 'byTime');
}
export async function putShot(s: Shot): Promise<void> {
  await (await db()).put('shots', s);
}
export async function deleteShot(id: string): Promise<void> {
  await (await db()).delete('shots', id);
}

export async function loadSettings(): Promise<Partial<AppSettings>> {
  const rows = await (await db()).getAll('settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<AppSettings>;
}
export async function saveSettings(s: Partial<AppSettings>): Promise<void> {
  const tx = (await db()).transaction('settings', 'readwrite');
  await Promise.all([...Object.entries(s).map(([key, value]) => tx.store.put({ key, value })), tx.done]);
}

export async function exportAll(): Promise<ExportBundle> {
  const [profiles, projectiles, sessions, shots, settings] = await Promise.all([allProfiles(), allProjectiles(), allSessions(), allShots(), loadSettings()]);
  return { app: 'spud-app', schemaVersion: DB_VERSION, exportedAt: new Date().toISOString(), profiles, projectiles, sessions, shots, settings };
}

/** Merge an export into the database (records with the same id are replaced). */
export async function importAll(bundle: unknown): Promise<{ shots: number }> {
  const b = bundle as Partial<ExportBundle>;
  if (!b || b.app !== 'spud-app' || !Array.isArray(b.shots)) throw new Error('Not a Spud app export');
  if ((b.schemaVersion ?? 1) > DB_VERSION) throw new Error('Export is from a newer version of the app');
  const d = await db();
  const tx = d.transaction(['profiles', 'projectiles', 'sessions', 'shots', 'settings'], 'readwrite');
  const ops: Promise<unknown>[] = [];
  for (const p of b.profiles ?? []) ops.push(tx.objectStore('profiles').put(p));
  for (const p of b.projectiles ?? []) ops.push(tx.objectStore('projectiles').put(p));
  for (const s of b.sessions ?? []) ops.push(tx.objectStore('sessions').put(s));
  for (const s of b.shots) ops.push(tx.objectStore('shots').put(s));
  for (const [key, value] of Object.entries(b.settings ?? {})) ops.push(tx.objectStore('settings').put({ key, value }));
  await Promise.all([...ops, tx.done]);
  return { shots: b.shots.length };
}

const CSV_COLUMNS = [
  'id', 'time', 'session', 'cannon', 'setting', 'projectile',
  'launch_lat', 'launch_lon', 'launch_ground_m', 'launch_accuracy_m',
  'elevation_raw_deg', 'azimuth_raw_deg', 'mount_offset_deg', 'declination_deg', 'heading_bias_deg',
  'temp_c', 'pressure_hpa', 'wind_speed_ms', 'wind_from_deg',
  'muzzle_height_m', 'v0_ms', 'drag_scale',
  'predicted_lat', 'predicted_lon', 'predicted_flight_s',
  'impact_lat', 'impact_lon', 'impact_sigma_m', 'impact_method', 'impact_ground_m',
  'flight_time_s', 'excluded',
];

function csvCell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flat CSV of shots, one row each. */
export function shotsToCsv(shots: readonly Shot[], names: { cannon: Record<string, string>; setting: Record<string, string>; projectile: Record<string, string> }): string {
  const rows = shots.map((s) => [
    s.id, s.time, s.sessionId, names.cannon[s.cannonId] ?? s.cannonId, names.setting[s.settingId] ?? s.settingId, names.projectile[s.projectileId] ?? s.projectileId,
    s.launch.lat, s.launch.lon, s.launch.groundHeightM, s.launch.accuracyM,
    s.aim.elevationRawDeg, s.aim.azimuthRawDeg, s.aim.mountOffsetDeg, s.aim.declinationDeg, s.aim.headingBiasDeg,
    s.atmosphere.tempC, s.atmosphere.pressureHpa, s.atmosphere.windSpeedMs, s.atmosphere.windFromDeg,
    s.conditions.muzzleHeightM, s.conditions.v0, s.conditions.dragScale,
    s.predicted.lat, s.predicted.lon, s.predicted.flightTimeS,
    s.impact?.lat, s.impact?.lon, s.impact?.sigmaM, s.impact?.method, s.impact?.groundHeightM,
    s.flightTimeS, s.excluded ? 1 : 0,
  ]);
  return [CSV_COLUMNS, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
