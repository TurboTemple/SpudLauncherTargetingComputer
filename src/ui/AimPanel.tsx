/** Aim screen: readouts in large digits, STEADY, Lock, landing-zone hints and the side view. */

import { runMonteCarlo } from '../state/solver';
import { averageLaunchFromGps, cancelLaunchAveraging, lockAim, startSensors, unlockAim } from '../state/sensors';
import {
  aim,
  launch,
  launchAveraging,
  lockedAim,
  monteCarlo,
  monteCarloBusy,
  prediction,
  sensorsRunning,
  sideViewOpen,
  steady,
  zone,
} from '../state/store';
import { aimingTone } from './audio';
import { compassPoint, fmt } from './format';
import { SideView } from './SideView';
import { StatusChips } from './StatusChips';
import { WindPanel } from './WindPanel';

function Readout({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div class="readout">
      <span class="readout-label">{label}</span>
      <span class="readout-value">
        {value}
        <small>{unit}</small>
      </span>
    </div>
  );
}

export function StartSensorsButton() {
  if (sensorsRunning.value) return null;
  return (
    <button
      class="btn btn-primary btn-big"
      onClick={() => {
        aimingTone.unlock();
        void startSensors();
      }}
    >
      Start sensors
    </button>
  );
}

export function AimPanel() {
  const a = aim.value;
  const pr = prediction.value;
  const st = steady.value;
  const z = zone.value;
  const locked = !!lockedAim.value;
  const l = launch.value;
  const avg = launchAveraging.value;
  const mc = monteCarlo.value;
  const top = z?.contributions[0];

  return (
    <div class="panel-inner">
      <StartSensorsButton />
      <div class="readouts">
        <Readout label="Elevation" value={fmt(a?.elevationDeg)} unit="°" />
        <Readout label="Azimuth" value={fmt(a?.azimuthDeg, 0)} unit={a ? `° ${compassPoint(a.azimuthDeg)}` : '°'} />
        <Readout label="Range" value={fmt(pr?.range, 0)} unit="m" />
        <Readout label="Flight" value={fmt(pr?.tof)} unit="s" />
        <Readout label="Apex" value={fmt(pr?.apex[2], 0)} unit="m" />
        <Readout label="Impact" value={fmt(pr?.impactSpeed, 0)} unit="m/s" />
      </div>

      <div class="aim-actions">
        <span class={`steady ${st?.steady ? 'on' : ''}`}>{st?.steady ? 'STEADY' : 'MOVING'}</span>
        <button class={`btn btn-big ${locked ? 'btn-warn' : 'btn-primary'}`} disabled={!a} onClick={() => (locked ? unlockAim() : lockAim())}>
          {locked ? 'Unlock' : 'Lock'}
        </button>
      </div>

      <WindPanel />

      {!l && (
        <div class="card">
          {avg ? (
            <p>
              Averaging GPS for the launch point: {avg.count} fixes better than 10 m, {fmt(avg.span, 0)}/10 s…{' '}
              <button class="btn btn-small" onClick={cancelLaunchAveraging}>
                Cancel
              </button>
            </p>
          ) : (
            <p>
              No launch point.{' '}
              <button class="btn btn-small" onClick={averageLaunchFromGps}>
                Average GPS (10 s)
              </button>{' '}
              or long-press the map.
            </p>
          )}
        </div>
      )}
      {l && (
        <p class="muted small">
          Launch: {l.source === 'map' ? 'placed on map' : `GPS ±${fmt(l.accuracyM)} m`} · long-press the map to move it ·{' '}
          <button class="link" onClick={averageLaunchFromGps}>
            re-average GPS
          </button>
          {avg && ` (${avg.count} fixes, ${fmt(avg.span, 0)}/10 s)`}
        </p>
      )}

      {z && (
        <div class="card">
          <p>
            90% zone {fmt(z.ellipses[1]!.a * 2, 0)} × {fmt(z.ellipses[1]!.b * 2, 0)} m; 50% zone {fmt(z.ellipses[0]!.a * 2, 0)} ×{' '}
            {fmt(z.ellipses[0]!.b * 2, 0)} m.
          </p>
          {top && (
            <p>
              Most of your spread is <strong>{top.label}</strong> ({fmt(top.share * 100, 0)}%).
            </p>
          )}
          <p class="muted small">
            +1 m/s launch speed adds {fmt(z.rangePerV0, 2)} m of range; 3° of heading error moves the impact {fmt(3 * z.sidePerDegHeading)} m
            sideways.
          </p>
          <button class="btn" disabled={monteCarloBusy.value} onClick={() => void runMonteCarlo(500)}>
            {monteCarloBusy.value ? 'Simulating 500 shots…' : 'Detailed zone'}
          </button>
          {mc && (
            <p class="small">
              Monte Carlo: {fmt((mc.insideShare ?? NaN) * 100, 0)}% of 500 dots inside the 90% ellipse; spread {fmt(Math.sqrt(mc.cov.xx), 1)} ×{' '}
              {fmt(Math.sqrt(mc.cov.yy), 1)} m (σ east × north).{' '}
              <button class="link" onClick={() => (monteCarlo.value = null)}>
                clear
              </button>
            </p>
          )}
        </div>
      )}

      <details class="card" open={sideViewOpen.value} onToggle={(e) => (sideViewOpen.value = (e.target as HTMLDetailsElement).open)}>
        <summary>Side view</summary>
        {sideViewOpen.value && <SideView />}
      </details>

      <StatusChips />
      {pr && (
        <p class="muted tiny">
          Solver {fmt(pr.computeMs, 2)} ms per simulation · estimate only
        </p>
      )}
    </div>
  );
}
