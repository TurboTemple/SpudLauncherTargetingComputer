/** Angle helpers. Everything inside core/ is radians; degrees only at the UI edge. */

export const DEG = Math.PI / 180;
export const TAU = 2 * Math.PI;

export const toRad = (deg: number): number => deg * DEG;
export const toDeg = (rad: number): number => rad / DEG;

/** Wrap to [0, 2π). */
export function wrapTau(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** Wrap to (−π, π]. */
export function wrapPi(a: number): number {
  const r = wrapTau(a);
  return r > Math.PI ? r - TAU : r;
}

/** Signed smallest difference a − b, in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  return wrapPi(a - b);
}

/** Circular mean of angles (optionally weighted). Returns NaN for an empty or balanced set. */
export function circularMean(angles: readonly number[], weights?: readonly number[]): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < angles.length; i++) {
    const w = weights ? weights[i]! : 1;
    s += w * Math.sin(angles[i]!);
    c += w * Math.cos(angles[i]!);
  }
  if (s === 0 && c === 0) return NaN;
  return wrapTau(Math.atan2(s, c));
}
