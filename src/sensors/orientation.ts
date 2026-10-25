/**
 * DeviceOrientation adapter: permission flow and a HeadingProvider with one strategy per
 * platform, chosen by feature detection.
 *
 * - absolute (Android Chrome): `deviceorientationabsolute`, α referenced to magnetic north.
 * - ios-compass (Safari): plain `deviceorientation` α starts from an arbitrary direction; a
 *   north offset = webkitCompassHeading − top-edge azimuth is smoothed (≈ 2 s circular mean)
 *   and updated only while webkitCompassAccuracy is in [0, 10]. TODO(field): verify on a real
 *   iPhone how webkitCompassHeading behaves when the phone is steeply tilted.
 * - relative: no compass at all; azimuth is meaningful only after landmark sighting.
 */

import { DEG } from '../core/angles';
import { CircularEma } from '../core/filters';
import { barrelDirection, directionToAim, northOffset } from '../core/orientation';
import type { Vec3 } from '../core/vec';

export type HeadingMode = 'absolute' | 'ios-compass' | 'relative' | 'simulator';

export interface OrientationSample {
  /** Seconds (performance clock). */
  t: number;
  /** Radians, W3C Z-X'-Y'' convention. */
  alpha: number;
  beta: number;
  gamma: number;
  mode: HeadingMode;
  /** iOS only: compass heading of the top edge, radians clockwise from magnetic north. */
  compassHeading?: number;
  /** iOS only: degrees; negative means invalid. */
  compassAccuracy?: number;
}

export type SensorPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';

interface IOSOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

type PermissionCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

export function orientationSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

/** Must be called from a tap (iOS). Safari remembers a refusal until the site data is reset. */
export async function requestOrientationPermission(): Promise<SensorPermission> {
  if (!orientationSupported()) return 'unsupported';
  const ctor = DeviceOrientationEvent as PermissionCtor;
  if (typeof ctor.requestPermission === 'function') {
    try {
      return (await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
  return 'granted';
}

/** Start listening; returns a stop function. Picks the best available event source. */
export function startOrientation(onSample: (s: OrientationSample) => void): () => void {
  const useAbsolute = 'ondeviceorientationabsolute' in window;
  const type = useAbsolute ? 'deviceorientationabsolute' : 'deviceorientation';
  const handler = (ev: Event) => {
    const e = ev as IOSOrientationEvent;
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    const t = performance.now() / 1000;
    const base = { t, alpha: e.alpha * DEG, beta: e.beta * DEG, gamma: e.gamma * DEG };
    if (useAbsolute || e.absolute) {
      onSample({ ...base, mode: 'absolute' });
    } else if (typeof e.webkitCompassHeading === 'number') {
      onSample({ ...base, mode: 'ios-compass', compassHeading: e.webkitCompassHeading * DEG, compassAccuracy: e.webkitCompassAccuracy ?? -1 });
    } else {
      onSample({ ...base, mode: 'relative' });
    }
  };
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}

export interface RawAim {
  t: number;
  /** Barrel direction in ENU, azimuth referenced to magnetic north when `northReferenced`. */
  d: Vec3;
  northReferenced: boolean;
  mode: HeadingMode;
  compassAccuracy?: number;
}

export const IOS_ACCURACY_MAX_DEG = 10;

/** Turns orientation samples into a magnetic-north-referenced barrel vector. */
export class HeadingProvider {
  private offset = new CircularEma(2);

  process(s: OrientationSample, reversed: boolean): RawAim {
    const d = barrelDirection(s.alpha, s.beta, s.gamma, reversed);
    if (s.mode !== 'ios-compass') {
      return { t: s.t, d, northReferenced: s.mode !== 'relative', mode: s.mode };
    }
    // webkitCompassHeading reports the top edge, so reference the offset to the top edge.
    const top = directionToAim(barrelDirection(s.alpha, s.beta, s.gamma, false));
    const acc = s.compassAccuracy ?? -1;
    if (s.compassHeading !== undefined && acc >= 0 && acc <= IOS_ACCURACY_MAX_DEG) {
      this.offset.update(northOffset(s.compassHeading, top.azimuth), s.t);
    }
    const off = this.offset.value;
    if (off === null) return { t: s.t, d, northReferenced: false, mode: s.mode, compassAccuracy: acc };
    // Rotate the barrel vector clockwise about z by the north offset.
    const c = Math.cos(off);
    const sn = Math.sin(off);
    const rotated: Vec3 = [d[0] * c + d[1] * sn, -d[0] * sn + d[1] * c, d[2]];
    return { t: s.t, d: rotated, northReferenced: true, mode: s.mode, compassAccuracy: acc };
  }

  reset(): void {
    this.offset.reset();
  }
}
