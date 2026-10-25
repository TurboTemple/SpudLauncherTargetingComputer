/** Promise wrapper around the solver worker. Dropped (superseded) requests resolve to null. */

import type { RequestKind, ResponseMap, SolverRequestBody, SolverResponse } from '../types';

type Body<K extends RequestKind> = Extract<SolverRequestBody, { kind: K }>;

export class SolverClient {
  private worker: Worker;
  private nextId = 1;
  private waiting = new Map<number, (v: unknown) => void>();

  constructor() {
    this.worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<SolverResponse>) => {
      const msg = ev.data;
      const resolve = this.waiting.get(msg.id);
      if (!resolve) return;
      this.waiting.delete(msg.id);
      resolve(msg.dropped ? null : msg.body);
    };
  }

  request<K extends RequestKind>(body: Body<K>): Promise<ResponseMap[K] | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve as (v: unknown) => void);
      this.worker.postMessage({ ...body, id });
    });
  }
}
