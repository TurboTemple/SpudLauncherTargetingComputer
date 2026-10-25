/// <reference lib="webworker" />
/**
 * The only place heavy maths runs. It executes the same core/ code that Vitest runs in Node,
 * so every number on screen is covered by unit tests.
 */

import { flatGround, simulate, type GroundFn } from '../core/ballistics';
import { fitCalibration } from '../core/calibration';
import { keepClearFootprint, rangeCard } from '../core/footprint';
import { solveTarget } from '../core/inverse';
import { buildBlendedGrid, buildSurfaceGrid, findObstacle, profileAlong, type HeightGrid } from '../core/terrain';
import { linearZone, monteCarlo, sensitivities } from '../core/uncertainty';
import { DEG } from '../core/angles';
import { EA_HALF_SIZE_M, inEngland, loadEaLayer } from '../data/eaLidar';
import { loadTerrainTiles } from '../data/terrainTiles';
import type { RequestKind, ResponseMap, SolverRequest, SolverResponse, TerrainStatus } from '../types';

declare const self: DedicatedWorkerGlobalScope;

let grid: HeightGrid | null = null;
/** Ground plus trees, hedges and buildings (EA first-return DSM), relative to launch ground. */
let surface: HeightGrid | null = null;
let ground: GroundFn = flatGround;
let terrainSeq = 0;

const pending = new Map<RequestKind, SolverRequest>();
let scheduled = false;
// Cheap requests first so the live pin never waits behind a slow job.
const ORDER: RequestKind[] = ['terrain', 'predict', 'ground', 'target', 'rangecard', 'footprint', 'montecarlo', 'fit'];

function reply<K extends RequestKind>(kind: K, id: number, body: ResponseMap[K], transfer: Transferable[] = []): void {
  self.postMessage({ kind, id, body } as SolverResponse, transfer);
}

self.onmessage = (ev: MessageEvent<SolverRequest>) => {
  const req = ev.data;
  const older = pending.get(req.kind);
  if (older) self.postMessage({ kind: older.kind, id: older.id, dropped: true } as SolverResponse);
  pending.set(req.kind, req);
  if (!scheduled) {
    scheduled = true;
    setTimeout(drain, 0);
  }
};

async function drain(): Promise<void> {
  scheduled = false;
  for (const kind of ORDER) {
    const req = pending.get(kind);
    if (!req) continue;
    pending.delete(kind);
    try {
      await handle(req);
    } catch (err) {
      console.error('solver worker:', err);
      self.postMessage({ kind: req.kind, id: req.id, dropped: true } as SolverResponse);
    }
    // Yield so newer messages can replace queued ones before the next job.
    if (pending.size && !scheduled) {
      scheduled = true;
      setTimeout(drain, 0);
      return;
    }
  }
}

async function handle(req: SolverRequest): Promise<void> {
  switch (req.kind) {
    case 'terrain': {
      const seq = ++terrainSeq;
      if (!req.origin) {
        grid = null;
        surface = null;
        ground = flatGround;
        reply('terrain', req.id, { loaded: false, launchGroundM: NaN, coverage: 0, halfSizeM: 0 });
        return;
      }
      let status: TerrainStatus;
      try {
        const o = req.origin;
        const useEa = req.ea && inEngland(o.lat / DEG, o.lon / DEG);
        const [tiles, dtm, dsm] = await Promise.all([
          loadTerrainTiles(o, req.tileUrl),
          useEa ? loadEaLayer('dtm', o) : Promise.resolve(null),
          useEa ? loadEaLayer('dsm', o) : Promise.resolve(null),
        ]);
        if (seq !== terrainSeq) return; // superseded while loading
        const half = tiles ? tiles.halfSizeM : EA_HALF_SIZE_M;
        const built = buildBlendedGrid(o, half, tiles?.sample ?? null, dtm);
        if (built) {
          grid = built.grid;
          ground = grid.ground();
          surface = dsm ? buildSurfaceGrid(o, EA_HALF_SIZE_M, dsm, built.launchGroundM, ground) : null;
          status = {
            loaded: true,
            launchGroundM: built.launchGroundM,
            coverage: built.coverage,
            halfSizeM: half,
            source: built.fineCoverage > 0 ? 'lidar' : 'tiles',
            fineCoverage: built.fineCoverage,
            surface: surface !== null,
          };
        } else {
          grid = null;
          surface = null;
          ground = flatGround;
          status = { loaded: false, launchGroundM: NaN, coverage: 0, halfSizeM: 0, error: 'No terrain data available' };
        }
      } catch (e) {
        grid = null;
        surface = null;
        ground = flatGround;
        status = { loaded: false, launchGroundM: NaN, coverage: 0, halfSizeM: 0, error: String(e) };
      }
      reply('terrain', req.id, status);
      return;
    }
    case 'predict': {
      const t0 = performance.now();
      const s = req.shot;
      const r = simulate(
        { v0: s.v0, elevation: s.elevation, azimuth: s.azimuth, k: s.kUnit * s.dragScale, wind: s.wind, shearExponent: s.shearExponent, h0: s.h0 },
        { ground, recordPath: true },
      );
      const computeMs = performance.now() - t0;
      const range = Math.hypot(r.impact[0], r.impact[1]);
      let zone: ResponseMap['predict']['zone'] = null;
      let windEffect: ResponseMap['predict']['windEffect'] = null;
      if (req.zone) {
        const z = linearZone(s, req.zone, ground);
        zone = { ...z, ...sensitivities(z.J, s.azimuth) };
        const still = simulate({ v0: s.v0, elevation: s.elevation, azimuth: s.azimuth, k: s.kUnit * s.dragScale, h0: s.h0 }, { ground });
        windEffect = [r.impact[0] - still.impact[0], r.impact[1] - still.impact[1]];
      }
      const path = r.path!;
      const obstacle = surface ? findObstacle(path, surface, ground) : null;
      let profile: ResponseMap['predict']['profile'] = null;
      if (req.profile) {
        const len = Math.max(range * 1.15, 50);
        profile = profileAlong(ground, s.azimuth, len, 2);
        if (surface) {
          const sfc = surface;
          profile.surface = profileAlong((x, y) => (sfc.contains(x, y) ? sfc.sample(x, y) : ground(x, y)), s.azimuth, len, 2).h;
        }
      }
      reply(
        'predict',
        req.id,
        {
          prediction: { stop: r.stop, impact: r.impact, impactSpeed: r.impactSpeed, impactAngle: r.impactAngle, tof: r.tof, apex: r.apex, path, range, computeMs, obstacle },
          zone,
          windEffect,
          profile,
        },
        [path.buffer],
      );
      return;
    }
    case 'ground': {
      reply('ground', req.id, { heights: req.points.map(([x, y]) => ground(x, y)) });
      return;
    }
    case 'target': {
      const z = ground(req.target.x, req.target.y);
      const solution = solveTarget(req.base, { ...req.target, z }, { ground });
      // Trees and hedges along each arc (the solver's own check only knows bare ground).
      const along = (arc: typeof solution.low) => {
        if (!arc || !surface) return null;
        const r = simulate({ ...req.base, elevation: arc.elevation, azimuth: arc.azimuth }, { ground, recordPath: true });
        return findObstacle(r.path!, surface, ground);
      };
      reply('target', req.id, { solution, targetZ: z, obstacles: { low: along(solution.low), high: along(solution.high) } });
      return;
    }
    case 'montecarlo': {
      const ref = req.reference ? { ...req.reference, probability: 0.9 } : undefined;
      const mc = monteCarlo(req.shot, req.spreads, req.n, req.seed, ground, ref);
      reply('montecarlo', req.id, mc, [mc.points.buffer]);
      return;
    }
    case 'fit': {
      reply('fit', req.id, fitCalibration(req.shots, req.start));
      return;
    }
    case 'footprint': {
      reply('footprint', req.id, { points: keepClearFootprint(req.conditions, req.spreads, ground) });
      return;
    }
    case 'rangecard': {
      reply('rangecard', req.id, { rows: rangeCard(req.conditions, req.azimuth, req.massKg, ground) });
      return;
    }
  }
}

export {};
