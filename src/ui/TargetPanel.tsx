/** Target screen: long-press a target, two solution cards, and aiming cues (on screen and audio). */

import { useEffect, useRef } from 'preact/hooks';
import type { ArcSolution } from '../core/inverse';
import type { Obstacle } from '../core/terrain';
import { angleDiff, DEG, toDeg } from '../core/angles';
import { liveAim, selectedArc, settings, target, targetSolution } from '../state/store';
import { updateSettings } from '../state/actions';
import { aimingTone } from './audio';
import { compassPoint, fmt, fmtDeg } from './format';
import { StartSensorsButton } from './AimPanel';
import { GameCard } from './GameCard';
import { RangeCard } from './RangeCard';

function ArcCard({ name, arc, selected, onPick, obstacle }: { name: string; arc: ArcSolution | null; selected: boolean; onPick: () => void; obstacle: Obstacle | null }) {
  if (!arc) {
    return (
      <div class="arc-card disabled">
        <h3>{name}</h3>
        <p class="muted">Not available</p>
      </div>
    );
  }
  return (
    <button class={`arc-card ${selected ? 'selected' : ''}`} onClick={onPick}>
      <h3>{name}</h3>
      <div class="arc-main">
        {fmtDeg(toDeg(arc.elevation), 2)} <small>tilt</small>
      </div>
      <div class="arc-main">
        {fmtDeg(toDeg(arc.azimuth), 1)} <small>{compassPoint(toDeg(arc.azimuth))}</small>
      </div>
      <div class="small">
        {fmt(arc.tof, 2)} s · apex {fmt(arc.apex[2], 0)} m · {fmt(arc.impactSpeed, 0)} m/s
      </div>
      {arc.groundInWay && <div class="flag bad">Ground in the way</div>}
      {obstacle && (
        <div class="flag bad">
          {obstacle.featureHeight > 6 ? 'Trees' : 'Hedge'} in the way at {fmt(obstacle.distance, 0)} m
        </div>
      )}
      {arc.ascending && <div class="flag">Hits while still rising</div>}
      {arc.elevation < 0 && <div class="flag">Below horizontal</div>}
    </button>
  );
}

export function TargetPanel() {
  const t = target.value;
  const ts = targetSolution.value;
  const a = liveAim.value;
  const s = settings.value;
  const pick = selectedArc.value;
  const arc = ts && pick ? ts.solution[pick] : null;

  let cue: { elev: number; az: number; on: boolean } | null = null;
  if (arc && a) {
    const elev = toDeg(arc.elevation) - a.elevationDeg;
    const az = toDeg(angleDiff(arc.azimuth, a.azimuthDeg * DEG));
    cue = { elev, az, on: Math.abs(elev) <= s.onTargetElevDeg && Math.abs(az) <= s.onTargetAzDeg };
  }

  const wasOn = useRef(false);
  useEffect(() => {
    if (cue && s.audio) aimingTone.update(cue.elev, cue.az, cue.on);
    else aimingTone.stop();
    // Vibration is Android-only; a short buzz when the aim comes on target.
    if (cue?.on && !wasOn.current) navigator.vibrate?.(80);
    wasOn.current = !!cue?.on;
  });
  useEffect(() => () => aimingTone.stop(), []);

  if (!t) {
    return (
      <div class="panel-inner">
        <StartSensorsButton />
        <p class="hint-big">Long-press the map to set a target.</p>
        <GameCard />
        <RangeCard azimuthDeg={a ? a.azimuthDeg : null} label="(current aim)" />
      </div>
    );
  }
  const sol = ts?.solution;
  return (
    <div class="panel-inner">
      <StartSensorsButton />
      {sol ? (
        <p>
          Target {fmt(sol.distance, 0)} m at {fmtDeg(toDeg(sol.bearing), 0)} {compassPoint(toDeg(sol.bearing))}, {sol.dz >= 0 ? '+' : ''}
          {fmt(sol.dz)} m height.{' '}
          <button class="link" onClick={() => (target.value = null)}>
            clear
          </button>
        </p>
      ) : (
        <p class="muted">Solving…</p>
      )}

      {sol && !sol.reachable && (
        <div class="banner banner-bad">
          Out of range: maximum reach {fmt(sol.maxReach, 0)} m at {fmtDeg(toDeg(sol.thetaMax))}.
        </div>
      )}

      {sol?.reachable && (
        <>
          <div class="arcs">
            <ArcCard name="Low arc" arc={sol.low} obstacle={ts!.obstacles.low} selected={pick === 'low'} onPick={() => (selectedArc.value = 'low')} />
            <ArcCard name="High arc" arc={sol.high} obstacle={ts!.obstacles.high} selected={pick === 'high'} onPick={() => (selectedArc.value = 'high')} />
          </div>
          {sol.notes.length > 0 && <p class="muted small">{sol.notes.join(' ')}</p>}
          <p class="muted small">
            The high arc spends far longer in the air, so it drifts more in wind. Near {fmtDeg(toDeg(sol.thetaMax))} (max reach) range hardly
            changes with tilt, so a shot there is least sensitive to tilt error.
          </p>
        </>
      )}

      {cue && (
        <div class={`cue ${cue.on ? 'on' : ''}`} aria-live="polite">
          {cue.on ? (
            'ON TARGET'
          ) : (
            <>
              <span>{Math.abs(cue.elev) <= s.onTargetElevDeg ? 'Tilt OK' : `${cue.elev > 0 ? 'Raise' : 'Lower'} ${fmt(Math.abs(cue.elev))}°`}</span>
              <span>{Math.abs(cue.az) <= s.onTargetAzDeg ? 'Direction OK' : `${cue.az > 0 ? 'Right' : 'Left'} ${fmt(Math.abs(cue.az), Math.abs(cue.az) < 10 ? 1 : 0)}°`}</span>
            </>
          )}
        </div>
      )}
      <GameCard />
      <RangeCard azimuthDeg={sol ? toDeg(sol.bearing) : null} label="(toward the target)" />
      {pick && (
        <label class="toggle">
          <input
            type="checkbox"
            checked={s.audio}
            onChange={(e) => {
              aimingTone.unlock();
              updateSettings({ audio: (e.target as HTMLInputElement).checked });
            }}
          />
          <span>Audio cues (pitch = tilt, left/right = direction, steady tone = on target)</span>
        </label>
      )}
    </div>
  );
}
