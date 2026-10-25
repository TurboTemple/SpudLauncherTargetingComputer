/**
 * Messages between the UI and the solver worker. Latest request wins: the worker drops any
 * queued request of the same kind older than the newest and answers it with `dropped: true`.
 */

import type { StopReason } from './core/ballistics';
import type { CalResult, CalShot, CalStart } from './core/calibration';
import type { Conditions, FootprintPoint, FootprintSpreads, RangeRow } from './core/footprint';
import type { Geo } from './core/geo';
import type { Obstacle } from './core/terrain';
import type { BaseLaunch, TargetSolution } from './core/inverse';
import type { LinearZone, MonteCarloResult, Spreads, ZoneInputs } from './core/uncertainty';
import type { Vec3 } from './core/vec';

export interface TerrainRequest {
  kind: 'terrain';
  /** Launch point, radians. Null clears the grid (flat ground). */
  origin: Geo | null;
  tileUrl: string;
  /** Also use Environment Agency 1 m LIDAR (England). */
  ea: boolean;
}

export interface PredictRequest {
  kind: 'predict';
  shot: ZoneInputs;
  /** Also compute the linear landing zone (2–4 Hz; the pin itself runs at sensor rate). */
  zone: Spreads | null;
  /** Ground profile along the azimuth for the side view. */
  profile: boolean;
}

export interface TargetRequest {
  kind: 'target';
  base: BaseLaunch;
  /** ENU target; height comes from the worker's grid. */
  target: { x: number; y: number };
}

export interface MonteCarloRequest {
  kind: 'montecarlo';
  shot: ZoneInputs;
  spreads: Spreads;
  n: number;
  seed: number;
  reference: { mean: [number, number]; cov: LinearZone['cov'] } | null;
}

export interface GroundRequest {
  kind: 'ground';
  points: [number, number][];
}

export interface FitRequest {
  kind: 'fit';
  shots: CalShot[];
  start: CalStart;
}

export interface FootprintRequest {
  kind: 'footprint';
  conditions: Conditions;
  spreads: FootprintSpreads;
}

export interface RangeCardRequest {
  kind: 'rangecard';
  conditions: Conditions;
  azimuth: number;
  massKg: number;
}

export type SolverRequestBody = TerrainRequest | PredictRequest | TargetRequest | MonteCarloRequest | GroundRequest | FitRequest | FootprintRequest | RangeCardRequest;
export type SolverRequest = SolverRequestBody & { id: number };
export type RequestKind = SolverRequestBody['kind'];

export interface TerrainStatus {
  loaded: boolean;
  /** Absolute launch ground height, m (NaN when flat ground is assumed). */
  launchGroundM: number;
  coverage: number;
  halfSizeM: number;
  /** 'lidar': EA 1 m data near the launch point (tiles beyond); 'tiles': AWS terrain only. */
  source?: 'lidar' | 'tiles';
  /** Share of the grid from LIDAR. */
  fineCoverage?: number;
  /** A surface model (trees, hedges, buildings) is loaded for obstacle checks. */
  surface?: boolean;
  error?: string;
}

export interface Prediction {
  stop: StopReason;
  impact: Vec3;
  impactSpeed: number;
  impactAngle: number;
  tof: number;
  apex: Vec3;
  path: Float64Array;
  /** Horizontal range, m. */
  range: number;
  computeMs: number;
  /** First tree, hedge or building the path passes through (needs the LIDAR surface). */
  obstacle: Obstacle | null;
}

export interface ZoneResult extends LinearZone {
  rangePerV0: number;
  sidePerDegHeading: number;
}

export interface ResponseMap {
  terrain: TerrainStatus;
  predict: {
    prediction: Prediction;
    zone: ZoneResult | null;
    /** Impact with wind − impact in still air (ENU, m); sent with the zone. */
    windEffect: [number, number] | null;
    profile: { d: number[]; h: number[]; surface?: number[] } | null;
  };
  target: { solution: TargetSolution; targetZ: number; obstacles: { low: Obstacle | null; high: Obstacle | null } };
  montecarlo: MonteCarloResult;
  ground: { heights: number[] };
  fit: CalResult;
  footprint: { points: FootprintPoint[] };
  rangecard: { rows: RangeRow[] };
}

export type SolverResponse = {
  [K in RequestKind]: { kind: K; id: number; dropped?: false; body: ResponseMap[K] } | { kind: K; id: number; dropped: true };
}[RequestKind];

