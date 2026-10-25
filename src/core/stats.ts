/** Group statistics for misses measured in each shot's own aim frame (metres). */

export interface Miss {
  /** + long, − short. */
  down: number;
  /** + right, − left. */
  cross: number;
}

export interface MissStats {
  n: number;
  /** Average miss (bias), m. */
  meanDown: number;
  meanCross: number;
  /** Sample standard deviations, m (NaN with < 2 shots). */
  sdDown: number;
  sdCross: number;
  /** Radius holding half the shots (circular error probable), m. */
  cep: number;
  /** Radius holding 90% of the shots, m. */
  r90: number;
}

/** Linear-interpolated quantile of a sorted array. */
function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < sorted.length ? sorted[i]! * (1 - f) + sorted[i + 1]! * f : sorted[i]!;
}

export function missStats(misses: readonly Miss[]): MissStats {
  const n = misses.length;
  const mean = (k: keyof Miss) => misses.reduce((a, m) => a + m[k], 0) / n;
  const sd = (k: keyof Miss, mu: number) => (n < 2 ? NaN : Math.sqrt(misses.reduce((a, m) => a + (m[k] - mu) ** 2, 0) / (n - 1)));
  const meanDown = n ? mean('down') : NaN;
  const meanCross = n ? mean('cross') : NaN;
  const radial = misses.map((m) => Math.hypot(m.down, m.cross)).sort((a, b) => a - b);
  return { n, meanDown, meanCross, sdDown: sd('down', meanDown), sdCross: sd('cross', meanCross), cep: quantile(radial, 0.5), r90: quantile(radial, 0.9) };
}
