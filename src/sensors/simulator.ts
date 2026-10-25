/** Developer sensor simulator: sliders drive α, β, γ with adjustable noise, so the app runs on a laptop. */

import { DEG } from '../core/angles';
import { createRng } from '../core/random';
import type { OrientationSample } from './orientation';

export interface SimState {
  alphaDeg: number;
  betaDeg: number;
  gammaDeg: number;
  noiseDeg: number;
}

export function startSimulator(get: () => SimState, onSample: (s: OrientationSample) => void, hz = 60): () => void {
  const rng = createRng(Date.now() & 0xffffffff);
  const id = setInterval(() => {
    const s = get();
    const n = () => s.noiseDeg * rng.normal() * DEG;
    onSample({
      t: performance.now() / 1000,
      alpha: s.alphaDeg * DEG + n(),
      beta: s.betaDeg * DEG + n(),
      gamma: s.gammaDeg * DEG + n(),
      mode: 'simulator',
    });
  }, 1000 / hz);
  return () => clearInterval(id);
}
