/** Seeded random numbers so Monte Carlo runs and tests are repeatable. */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal. */
  normal(): number;
}

/** mulberry32: small, fast, good enough for sampling. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  let spare: number | null = null;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (): number => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    // Box–Muller; avoid log(0).
    const u = 1 - next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { next, normal };
}
