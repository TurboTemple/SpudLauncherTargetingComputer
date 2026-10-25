/** Hidden developer panel: sensor simulator, and recording / replay of real sensor logs. */

import { useState } from 'preact/hooks';
import { download } from '../state/actions';
import { handleMotion, recorder, replayRecording, setSimulator, stopReplaying } from '../state/sensors';
import { prediction, simState, simulatorOn } from '../state/store';
import type { Recording } from '../sensors/recorder';
import { Card, Toggle } from './fields';
import { fmt } from './format';

function Slider({ label, value, min, max, step, onInput }: { label: string; value: number; min: number; max: number; step: number; onInput: (v: number) => void }) {
  return (
    <label class="slider">
      <span>
        {label}: {fmt(value, step < 0.1 ? 2 : 1)}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onInput={(e) => onInput(parseFloat((e.target as HTMLInputElement).value))} />
    </label>
  );
}

export function DevPanel() {
  const s = simState.value;
  const set = (patch: Partial<typeof s>) => (simState.value = { ...s, ...patch });
  const [rec, setRec] = useState(recorder.recording);
  const [replaying, setReplaying] = useState(false);
  return (
    <Card title="Developer">
      <Toggle label="Sensor simulator" checked={simulatorOn.value} onChange={setSimulator} />
      {simulatorOn.value && (
        <>
          <Slider label="α (deg)" value={s.alphaDeg} min={0} max={360} step={0.5} onInput={(v) => set({ alphaDeg: v })} />
          <Slider label="β (deg)" value={s.betaDeg} min={-90} max={90} step={0.1} onInput={(v) => set({ betaDeg: v })} />
          <Slider label="γ (deg)" value={s.gammaDeg} min={-90} max={90} step={0.5} onInput={(v) => set({ gammaDeg: v })} />
          <Slider label="Noise (deg)" value={s.noiseDeg} min={0} max={2} step={0.01} onInput={(v) => set({ noiseDeg: v })} />
          <p class="muted small">Long-press the map (Aim screen) or drag the launch marker to move the launch point.</p>
        </>
      )}
      <div class="row">
        {!rec ? (
          <button
            class="btn"
            onClick={() => {
              recorder.start();
              setRec(true);
            }}
          >
            Record sensors
          </button>
        ) : (
          <button
            class="btn btn-warn"
            onClick={() => {
              const r = recorder.stop();
              setRec(false);
              download(`spud-sensors-${r.startedAt.replace(/[:.]/g, '-')}.json`, JSON.stringify(r), 'application/json');
            }}
          >
            Stop and save ({recorder.count} events)
          </button>
        )}
        <label class="btn">
          {replaying ? 'Replaying…' : 'Replay log'}
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              const r = JSON.parse(await f.text()) as Recording;
              setReplaying(true);
              replayRecording(r, () => setReplaying(false));
            }}
          />
        </label>
        {replaying && (
          <button
            class="btn btn-small"
            onClick={() => {
              stopReplaying();
              setReplaying(false);
            }}
          >
            Stop
          </button>
        )}
      </div>
      <button class="btn" onClick={() => handleMotion({ t: performance.now() / 1000, withGravity: null, linear: [0, 80, 0] })}>
        Simulate shot jolt
      </button>
      <p class="muted small">Last forward simulation: {fmt(prediction.value?.computeMs, 3)} ms (budget 1 ms).</p>
    </Card>
  );
}
