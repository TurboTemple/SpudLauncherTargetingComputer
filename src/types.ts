/**
 * Messages between the UI and the solver worker. Latest request wins: the worker drops any
 * queued request of the same kind older than the newest and answers it with `dropped: true`.
 */

import type { StopReason } from './core/ballistics';
import type { CalResult, CalShot, CalStart } from './core/calibration';
import type { Geo } from './core/geo';
import type { BaseLaunch, TargetSolution } from './core/inverse';
import type { LinearZone, MonteCarloResult, Spreads, ZoneInputs } from './core/uncertainty';
import type { Vec3 } from './core/vec';

export interface TerrainRequest {
  kind: 'terrain';
  /** Launch point, radians. Null clears the grid (flat ground). */
  origin: Geo | null;
  tileUrl: string;
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

export type SolverRequestBody = TerrainRequest | PredictRequest | TargetRequest | MonteCarloRequest | GroundRequest | FitRequest;
export type SolverRequest = SolverRequestBody & { id: number };
export type RequestKind = SolverRequestBody['kind'];

export interface TerrainStatus {
  loaded: boolean;
  /** Absolute launch ground height, m (NaN when flat ground is assumed). */
  launchGroundM: number;
  coverage: number;
  halfSizeM: number;
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
    profile: { d: number[]; h: number[] } | null;
  };
  target: { solution: TargetSolution; targetZ: number };
  montecarlo: MonteCarloResult;
  ground: { heights: number[] };
  fit: CalResult;
}

export type SolverResponse = {
  [K in RequestKind]: { kind: K; id: number; dropped?: false; body: ResponseMap[K] } | { kind: K; id: number; dropped: true };
}[RequestKind];

