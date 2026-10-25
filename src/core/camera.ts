/**
 * Camera-view projection: ENU points onto the phone's screen while the rear camera looks
 * downrange. Device frame (W3C): x to the right, y to the top edge, z out of the screen; the
 * rear camera looks along −z. Orientation gives R (device → earth); a heading correction
 * (compass offset + declination + landmark bias, clockwise) turns it to true north.
 */

import { rotationMatrix } from './orientation';
import type { Vec3 } from './vec';

/** Device → true-north ENU rotation (row-major 3 × 3). */
export function cameraRotation(alpha: number, beta: number, gamma: number, headingCorrection: number): number[] {
  const R = rotationMatrix(alpha, beta, gamma);
  const c = Math.cos(headingCorrection);
  const s = Math.sin(headingCorrection);
  // Clockwise turn about z: x' = x cos c + y sin c, y' = −x sin c + y cos c.
  const out = new Array<number>(9);
  for (let j = 0; j < 3; j++) {
    out[j] = c * R[j]! + s * R[3 + j]!;
    out[3 + j] = -s * R[j]! + c * R[3 + j]!;
    out[6 + j] = R[6 + j]!;
  }
  return out;
}

export interface ScreenPoint {
  u: number;
  v: number;
  /** Distance along the camera axis, m (> 0 in front). */
  depth: number;
}

export interface Projector {
  /** Focal length in screen pixels. */
  f: number;
  cx: number;
  cy: number;
  /** screen.orientation.angle in degrees (0 portrait, 90/270 landscape). */
  screenAngle: number;
}

/** Screen pixel of an ENU point seen from `eye`, or null if it is behind (or too near) the camera. */
export function project(R: readonly number[], eye: Vec3, p: Vec3, cam: Projector): ScreenPoint | null {
  const dx = p[0] - eye[0];
  const dy = p[1] - eye[1];
  const dz = p[2] - eye[2];
  // Earth → device: Rᵀ d.
  const x = R[0]! * dx + R[3]! * dy + R[6]! * dz;
  const y = R[1]! * dx + R[4]! * dy + R[7]! * dz;
  const z = R[2]! * dx + R[5]! * dy + R[8]! * dz;
  const depth = -z;
  if (depth < 0.3) return null;
  const a = (cam.screenAngle * Math.PI) / 180;
  const xs = x * Math.cos(a) - y * Math.sin(a);
  const ys = x * Math.sin(a) + y * Math.cos(a);
  return { u: cam.cx + (cam.f * xs) / depth, v: cam.cy - (cam.f * ys) / depth, depth };
}

/** Focal length in pixels from the field of view across `sizePx` pixels. */
export function focalFromFov(sizePx: number, fovRad: number): number {
  return sizePx / 2 / Math.tan(fovRad / 2);
}
