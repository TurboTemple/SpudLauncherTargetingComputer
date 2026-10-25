/** DeviceMotion adapter for shot detection (accelerometer, m/s², device frame). */

import type { Vec3 } from '../core/vec';

export interface MotionSample {
  t: number; // seconds
  withGravity: Vec3 | null;
  linear: Vec3 | null;
}

type PermissionCtor = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/** iOS asks separately for motion; call from the same tap as the orientation request. */
export async function requestMotionPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return false;
  const ctor = DeviceMotionEvent as PermissionCtor;
  if (typeof ctor.requestPermission !== 'function') return true;
  try {
    return (await ctor.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

const vec = (a: DeviceMotionEventAcceleration | null): Vec3 | null =>
  a && a.x !== null && a.y !== null && a.z !== null ? [a.x, a.y, a.z] : null;

export function startMotion(onSample: (s: MotionSample) => void): () => void {
  const handler = (e: DeviceMotionEvent) => {
    onSample({ t: performance.now() / 1000, withGravity: vec(e.accelerationIncludingGravity), linear: vec(e.acceleration) });
  };
  window.addEventListener('devicemotion', handler);
  return () => window.removeEventListener('devicemotion', handler);
}
