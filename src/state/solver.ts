/** Drives the solver worker: live prediction, landing zone, terrain, target solutions, Monte Carlo, fits. */

import { computed, effect } from '@preact/signals';
import { toRad } from '../core/angles';
import { windVector } from '../core/atmosphere';
import type { RangeRow } from '../core/footprint';
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
  footprint,
  kUnit,
  launchSpeed,
  launch,
  monteCarlo,
  monteCarloBusy,
  potatoMassKg,
  prediction,
  projectile,
  settings,
  shotInputs,
  sideProfile,
  sideViewOpen,
  spreads,
  target,
  targetSolution,
  shear,
  terrain,
  toast,
  wind10,
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
  const v = launchSpeed.value;
  if (!c || !p || !v) return null;
  const atm = atmosphere.value;
  return {
    v0: v.v0,
    k: kUnit.value * p.dragScale,
    wind: windVector(wind10.value.speed, toRad(atm.windFromDeg)),
    shearExponent: shear.value.alpha,
    h0: c.muzzleHeightM,
  };
});

const footprintKey = computed(() => {
  const sp = spreads.value;
  return sp ? `${sp.v0.toFixed(3)}|${sp.dragScale.toFixed(4)}|${sp.windE.toFixed(3)}` : '';
});

let targetTimer: ReturnType<typeof setTimeout> | null = null;
let footprintTimer: ReturnType<typeof setTimeout> | null = null;

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

  // Terrain and declination follow the launch point (and the LIDAR setting).
  let lastLaunch = '';
  effect(() => {
    const l = launch.value;
    const key = l ? `${l.lat.toFixed(7)},${l.lon.toFixed(7)},${settings.value.useEaLidar}` : '';
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

  // Keep-clear footprint: depends on conditions, the speed/drag/wind spreads and terrain, never
  // on the aim. (The full spreads change at sensor rate with tilt noise, which the footprint
  // does not use, so it watches a key of only what it uses.)
  effect(() => {
    const base = baseLaunch.value;
    void footprintKey.value;
    const sp = spreads.peek();
    const show = settings.value.showFootprint;
    const l = launch.value;
    void terrain.value.state;
    if (footprintTimer) clearTimeout(footprintTimer);
    if (!base || !sp || !show || !l) {
      footprint.value = null;
      return;
    }
    const p = projectile.peek();
    footprintTimer = setTimeout(async () => {
      const res = await solver.request({
        kind: 'footprint',
        conditions: base,
        spreads: { v0: sp.v0, dragFrac: p && p.dragScale > 0 ? sp.dragScale / p.dragScale : 0.1, wind: sp.windE },
      });
      if (res) footprint.value = { points: res.points, maxReach: Math.max(...res.points.map((q) => q.reach)) };
    }, 600);
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
    await solver.request({ kind: 'terrain', origin: null, tileUrl: TERRAIN_TILE_URL, ea: false });
    return;
  }
  terrain.value = { ...terrain.peek(), state: 'loading' };
  const res = await solver.request({ kind: 'terrain', origin: geoOf(l), tileUrl: TERRAIN_TILE_URL, ea: settings.peek().useEaLidar });
  if (!res) return; // superseded by a newer launch point
  terrain.value = { ...res, state: res.loaded ? 'loaded' : 'flat' };
  if (!res.loaded) toast('Terrain unavailable: flat ground assumed', 'warn');
}

/** Ground heights (relative to launch ground) at ENU points; zeros on flat ground. */
export async function groundHeights(points: [number, number][]): Promise<number[] | null> {
  const res = await solver.request({ kind: 'ground', points });
  return res ? res.heights : null;
}

/** Range card toward an azimuth (degrees) for the current conditions and potato. */
export async function requestRangeCard(azimuthDeg: number): Promise<RangeRow[] | null> {
  const base = baseLaunch.peek();
  if (!base) return null;
  const res = await solver.request({ kind: 'rangecard', conditions: base, azimuth: toRad(azimuthDeg), massKg: potatoMassKg.peek() });
  return res?.rows ?? null;
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
