/** Drives the solver worker: live prediction, landing zone, terrain, target solutions, Monte Carlo, fits. */

import { computed, effect } from '@preact/signals';
import { toRad } from '../core/angles';
import { windVector } from '../core/atmosphere';
import type { BaseLaunch } from '../core/inverse';
import { TERRAIN_TILE_URL } from '../data/terrainTiles';
import { enuOf, geoOf, latLonOf, type LatLon } from '../geoDeg';
import { declinationDeg as fetchDeclination } from '../sensors/declination';
import { SolverClient } from '../worker/client';
import { refreshCorrections } from './sensors';
import {
  atmosphere,
  cannon,
  declinationDeg,
  effectiveV0,
  kUnit,
  launch,
  monteCarlo,
  monteCarloBusy,
  prediction,
  projectile,
  settings,
  shotInputs,
  sideProfile,
  sideViewOpen,
  spreads,
  target,
  targetSolution,
  terrain,
  toast,
  windEffect,
  zone,
} from './store';

export const solver = new SolverClient();

const ZONE_INTERVAL_MS = 300; // ellipses refresh at ~3 Hz; the pin runs at sensor rate
let framePending = false;
let zoneDirty = true;
let lastZoneAt = 0;
let zoneTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePredict(): void {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => void runPredict());
}

async function runPredict(): Promise<void> {
  framePending = false;
  const inp = shotInputs.peek();
  if (!inp) {
    prediction.value = null;
    zone.value = null;
    windEffect.value = null;
    return;
  }
  const now = performance.now();
  const wantZone = zoneDirty && now - lastZoneAt >= ZONE_INTERVAL_MS;
  if (wantZone) {
    zoneDirty = false;
    lastZoneAt = now;
  } else if (zoneDirty && !zoneTimer) {
    zoneTimer = setTimeout(() => {
      zoneTimer = null;
      schedulePredict();
    }, ZONE_INTERVAL_MS - (now - lastZoneAt));
  }
  const res = await solver.request({ kind: 'predict', shot: inp, zone: wantZone ? spreads.peek() : null, profile: sideViewOpen.peek() });
  if (!res) {
    if (wantZone) {
      zoneDirty = true;
      lastZoneAt = 0;
    }
    return;
  }
  prediction.value = res.prediction;
  if (res.zone) zone.value = res.zone;
  if (res.windEffect) windEffect.value = res.windEffect;
  if (res.profile) sideProfile.value = res.profile;
  const mc = monteCarlo.peek();
  const l = launch.peek();
  if (mc && l) {
    const e = enuOf(mc.origin, latLonOf(l, res.prediction.impact[0], res.prediction.impact[1]));
    if (Math.hypot(e.x - mc.mean[0], e.y - mc.mean[1]) > Math.max(3, 0.05 * res.prediction.range)) monteCarlo.value = null;
  }
}

/** Launch conditions without the aim (target solving should not re-run at sensor rate). */
export const baseLaunch = computed<BaseLaunch | null>(() => {
  const c = cannon.value;
  const p = projectile.value;
  const v = effectiveV0.value;
  if (!c || !p || !v) return null;
  const atm = atmosphere.value;
  return {
    v0: v.v0,
    k: kUnit.value * p.dragScale,
    wind: windVector(atm.windSpeedMs, toRad(atm.windFromDeg)),
    windShear: settings.value.windShear,
    h0: c.muzzleHeightM,
  };
});

let targetTimer: ReturnType<typeof setTimeout> | null = null;

export function initSolver(): void {
  // Live prediction whenever any input changes.
  effect(() => {
    void shotInputs.value;
    void spreads.value;
    void terrain.value.state;
    void sideViewOpen.value;
    zoneDirty = true;
    schedulePredict();
  });

  // Terrain and declination follow the launch point.
  let lastLaunch = '';
  effect(() => {
    const l = launch.value;
    const key = l ? `${l.lat.toFixed(7)},${l.lon.toFixed(7)}` : '';
    if (key === lastLaunch) return;
    lastLaunch = key;
    void loadTerrain(l);
    if (l) {
      void fetchDeclination(l.lat, l.lon).then((d) => {
        if (d !== null && launch.peek() === l) {
          declinationDeg.value = d;
          refreshCorrections();
        }
      });
    }
  });

  // Target solutions follow the target, launch point, conditions and terrain.
  effect(() => {
    const t = target.value;
    const l = launch.value;
    const base = baseLaunch.value;
    void terrain.value.state;
    if (targetTimer) clearTimeout(targetTimer);
    if (!t || !l || !base) {
      targetSolution.value = null;
      return;
    }
    targetTimer = setTimeout(async () => {
      const res = await solver.request({ kind: 'target', base, target: enuOf(l, t) });
      if (res && target.peek() === t) targetSolution.value = res;
    }, 120);
  });
}

async function loadTerrain(l: LatLon | null): Promise<void> {
  if (!l) {
    terrain.value = { state: 'none', loaded: false, launchGroundM: NaN, coverage: 0, halfSizeM: 0 };
    await solver.request({ kind: 'terrain', origin: null, tileUrl: TERRAIN_TILE_URL });
    return;
  }
  terrain.value = { ...terrain.peek(), state: 'loading' };
  const res = await solver.request({ kind: 'terrain', origin: geoOf(l), tileUrl: TERRAIN_TILE_URL });
  if (!res) return; // superseded by a newer launch point
  terrain.value = { ...res, state: res.loaded ? 'loaded' : 'flat' };
  if (!res.loaded) toast('Terrain unavailable: flat ground assumed', 'warn');
}

/** Ground heights (relative to launch ground) at ENU points; zeros on flat ground. */
export async function groundHeights(points: [number, number][]): Promise<number[] | null> {
  const res = await solver.request({ kind: 'ground', points });
  return res ? res.heights : null;
}

export async function runMonteCarlo(n = 500): Promise<void> {
  const inp = shotInputs.peek();
  const sp = spreads.peek();
  const l = launch.peek();
  if (!inp || !sp || !l) return;
  monteCarloBusy.value = true;
  const z = zone.peek();
  const res = await solver.request({
    kind: 'montecarlo',
    shot: inp,
    spreads: sp,
    n,
    seed: (Date.now() & 0x7fffffff) >>> 0,
    reference: z ? { mean: z.mean, cov: z.cov } : null,
  });
  monteCarloBusy.value = false;
  if (res) monteCarlo.value = { ...res, origin: { lat: l.lat, lon: l.lon } };
}
