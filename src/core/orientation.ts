/**
 * Phone orientation (W3C DeviceOrientation α, β, γ) → barrel elevation and azimuth.
 *
 * R = Rz(α) Rx(β) Ry(γ) maps the phone frame to the earth frame (x east, y north, z up).
 * The barrel lies along the phone's long axis, b = (0, ±1, 0), so d = R b is the second
 * column of R (negated when the top edge points at the breech). γ — roll about the barrel —
 * drops out entirely, which is why the strap angle barely matters.
 */

import { angleDiff, wrapTau } from './angles';
import type { Vec3 } from './vec';

/** Row-major 3 × 3 rotation matrix, phone → earth. Angles in radians. */
export function rotationMatrix(alpha: number, beta: number, gamma: number): number[] {
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const cg = Math.cos(gamma), sg = Math.sin(gamma);
  return [
    ca * cg - sa * sb * sg, -cb * sa, cg * sa * sb + ca * sg,
    cg * sa + ca * sb * sg, ca * cb, sa * sg - ca * cg * sb,
    -cb * sg, sb, cb * cg,
  ];
}

/** Barrel unit vector in ENU. `reversed`: top edge towards the breech, b = (0, −1, 0). */
export function barrelDirection(alpha: number, beta: number, gamma: number, reversed = false): Vec3 {
  const R = rotationMatrix(alpha, beta, gamma);
  const s = reversed ? -1 : 1;
  return [s * R[1]!, s * R[4]!, s * R[7]!];
}

export interface Aim {
  /** Above horizontal, radians. */
  elevation: number;
  /** Clockwise from the α reference (north when α is north-referenced), radians in [0, 2π). */
  azimuth: number;
}

/** θ = asin(d_z), ψ = atan2(d_x, d_y) mod 2π. */
export function directionToAim(d: Vec3): Aim {
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  const uz = Math.max(-1, Math.min(1, d[2] / n));
  return { elevation: Math.asin(uz), azimuth: wrapTau(Math.atan2(d[0], d[1])) };
}

export function aimToDirection(a: Aim): Vec3 {
  const ce = Math.cos(a.elevation);
  return [ce * Math.sin(a.azimuth), ce * Math.cos(a.azimuth), Math.sin(a.elevation)];
}

export function orientationToAim(alpha: number, beta: number, gamma: number, reversed = false): Aim {
  return directionToAim(barrelDirection(alpha, beta, gamma, reversed));
}

/**
 * Reversal calibration: elevation e1, then the barrel turned end for end on the same spot
 * gives e2. Mount offset = (e1 + e2) / 2; the surface slope (e1 − e2) / 2 drops out.
 */
export function mountOffsetFromReversal(e1: number, e2: number): { offset: number; slope: number } {
  return { offset: (e1 + e2) / 2, slope: (e1 - e2) / 2 };
}

/**
 * iOS: α starts from an arbitrary direction. North offset = compass heading − azimuth
 * computed from that α. Returned in (−π, π].
 */
export function northOffset(compassHeading: number, relativeAzimuth: number): number {
  return angleDiff(compassHeading, relativeAzimuth);
}

/** Landmark sighting: offset = map bearing to the landmark − measured azimuth. */
export function landmarkOffset(mapBearing: number, measuredAzimuth: number): number {
  return angleDiff(mapBearing, measuredAzimuth);
}
