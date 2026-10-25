/** Inline banners (no pop-up dialogs while aiming). */

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { acknowledgeSafety } from '../state/actions';
import {
  aim,
  calibrated,
  effectiveV0,
  gpsError,
  headingMode,
  metalWarningAt,
  northReferenced,
  prediction,
  sensorPermission,
  session,
  settings,
  terrain,
  updateAvailable,
} from '../state/store';

function Banner({ kind, children }: { kind: 'warn' | 'bad' | 'info'; children: ComponentChildren }) {
  return <div class={`banner banner-${kind}`}>{children}</div>;
}

/** Shown on first run and at each new session until acknowledged. */
export function SafetyCard() {
  const s = session.value;
  if (!s || settings.value.safetyAckSession === s.id) return null;
  return (
    <div class="banner banner-safety" role="alert">
      <strong>Safety first.</strong> Predictions are estimates: about 1 shot in 10 lands outside the 90% zone, more before
      calibration. Fire only on open land you have permission to use, with the whole 90% zone and a wide margin beyond it clear of
      people, animals, roads and buildings. Check the rules that apply to your type of cannon where you use it.
      <button class="btn btn-primary" onClick={acknowledgeSafety}>
        I understand
      </button>
    </div>
  );
}

function useNow(ms: number): number {
  const [now, setNow] = useState(performance.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now() / 1000), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function Banners() {
  const now = useNow(1000);
  const a = aim.value;
  const pr = prediction.value;
  const landmark = session.value?.headingBiasSource === 'landmark';
  return (
    <div class="banners">
      {updateAvailable.value && (
        <Banner kind="info">
          A new version is ready.{' '}
          <button class="btn btn-small" onClick={() => updateAvailable.value?.()}>
            Reload
          </button>
        </Banner>
      )}
      {effectiveV0.value?.source === 'curve' && effectiveV0.value.extrapolated && (
        <Banner kind="warn">This setting is outside the calibrated range: its launch speed is extrapolated from the pressure curve.</Banner>
      )}
      {!calibrated.value && (
        <Banner kind="bad">
          <strong>UNCALIBRATED</strong>: launch speed is a guess until shots for this power setting are fitted.
        </Banner>
      )}
      {sensorPermission.value === 'denied' && (
        <Banner kind="bad">
          Motion sensors were refused. On iPhone: Settings › Safari › Advanced › Website Data, remove this site, then reload and tap
          Start sensors again.
        </Banner>
      )}
      {headingMode.value && !northReferenced.value && !landmark && (
        <Banner kind="bad">Heading is not referenced to north. Sight a landmark (Setup) before trusting azimuth.</Banner>
      )}
      {now - metalWarningAt.value < 5 && (
        <Banner kind="warn">Compass jumped while the tilt held steady: metal nearby or a steel barrel is bending it. Use landmark sighting.</Banner>
      )}
      {terrain.value.state === 'flat' && <Banner kind="warn">Flat ground assumed (no terrain data).</Banner>}
      {pr?.obstacle && (
        <Banner kind="bad">
          {pr.obstacle.featureHeight > 6 ? 'Trees or a building' : 'A hedge or bush'} in the way at {pr.obstacle.distance.toFixed(0)} m (
          {pr.obstacle.featureHeight.toFixed(1)} m tall): the potato would hit it {pr.obstacle.z.toFixed(1)} m up. From survey data, which can't see
          gaps under branches: check the line yourself.
        </Banner>
      )}
      {a && a.elevationDeg > 85 && <Banner kind="warn">Keep the tilt under 85°: near vertical the angles become unstable.</Banner>}
      {pr && pr.stop === 'time' && <Banner kind="warn">Flight longer than 60 s: outside the design envelope.</Banner>}
      {pr && pr.stop === 'distance' && <Banner kind="warn">Shot passes 2 km: outside the design envelope.</Banner>}
      {gpsError.value && <Banner kind="warn">GPS: {gpsError.value}</Banner>}
    </div>
  );
}
