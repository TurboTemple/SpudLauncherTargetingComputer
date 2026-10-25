/** Record raw orientation and GPS events in the field; replay them at a desk at real speed. */

import type { Fix } from './gps';
import type { OrientationSample } from './orientation';

export type RecordedEvent = { type: 'orientation'; sample: OrientationSample } | { type: 'gps'; fix: Fix };

export interface Recording {
  app: 'spud-app-sensor-log';
  startedAt: string;
  events: RecordedEvent[];
}

export class SensorRecorder {
  private events: RecordedEvent[] = [];
  private startedAt = '';
  recording = false;

  start(): void {
    this.events = [];
    this.startedAt = new Date().toISOString();
    this.recording = true;
  }

  add(e: RecordedEvent): void {
    if (this.recording) this.events.push(e);
  }

  get count(): number {
    return this.events.length;
  }

  stop(): Recording {
    this.recording = false;
    return { app: 'spud-app-sensor-log', startedAt: this.startedAt, events: this.events };
  }
}

const eventTime = (e: RecordedEvent) => (e.type === 'orientation' ? e.sample.t : e.fix.t);

/** Replays events with their original spacing, re-stamped to the current clock. Returns a stop function. */
export function replay(
  rec: Recording,
  handlers: { orientation: (s: OrientationSample) => void; gps: (f: Fix) => void; done?: () => void },
): () => void {
  const events = rec.events;
  if (!events.length) {
    handlers.done?.();
    return () => {};
  }
  const t0 = eventTime(events[0]!);
  const start = performance.now() / 1000;
  let i = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const step = () => {
    const now = performance.now() / 1000 - start;
    while (i < events.length && eventTime(events[i]!) - t0 <= now) {
      const e = events[i++]!;
      const t = start + (eventTime(e) - t0);
      if (e.type === 'orientation') handlers.orientation({ ...e.sample, t });
      else handlers.gps({ ...e.fix, t });
    }
    if (i >= events.length) {
      handlers.done?.();
      return;
    }
    timer = setTimeout(step, Math.max(0, (eventTime(events[i]!) - t0 - now) * 1000));
  };
  step();
  return () => {
    if (timer) clearTimeout(timer);
  };
}
