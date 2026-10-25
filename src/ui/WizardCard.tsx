/** Inline wizards: mount offset by reversal, and landmark sighting. */

import { captureMountStep, closeWizard, finishMountWizard, setLandmark } from '../state/actions';
import { declinationDeg, liveAim, session, wizard } from '../state/store';
import { fmt, fmtDeg } from './format';

export function WizardCard() {
  const w = wizard.value;
  if (!w) return null;
  const a = liveAim.value;
  if (w.kind === 'mount') {
    return (
      <section class="card wizard">
        <h2>Mount offset (reversal)</h2>
        <p class="muted">Live raw tilt: {fmtDeg(a?.elevationRawDeg, 2)}</p>
        {w.step === 1 && (
          <>
            <p>1. Rest the barrel on a firm surface. Hold it still, then record.</p>
            <button class="btn btn-primary" disabled={w.capturing || !a} onClick={captureMountStep}>
              {w.capturing ? 'Hold still: waiting for STEADY, then 2 s…' : 'Record first reading'}
            </button>
          </>
        )}
        {w.step === 2 && (
          <>
            <p>First reading e1 = {fmtDeg(w.e1?.mean, 2)}.</p>
            <p>2. Turn the barrel end for end on the same spot, phone still strapped on, then record.</p>
            <button class="btn btn-primary" disabled={w.capturing || !a} onClick={captureMountStep}>
              {w.capturing ? 'Hold still: waiting for STEADY, then 2 s…' : 'Record second reading'}
            </button>
          </>
        )}
        {w.step === 3 && w.e1 && w.e2 && (
          <>
            <p>
              e1 = {fmtDeg(w.e1.mean, 2)}, e2 = {fmtDeg(w.e2.mean, 2)}.
            </p>
            <p>
              Mount offset <strong>{fmtDeg((w.e1.mean + w.e2.mean) / 2, 2)}</strong>; surface slope {fmtDeg((w.e1.mean - w.e2.mean) / 2, 2)}{' '}
              (cancelled).
            </p>
            <button class="btn btn-primary" onClick={finishMountWizard}>
              Save offset
            </button>
          </>
        )}
        <button class="btn" onClick={closeWizard}>
          Cancel
        </button>
      </section>
    );
  }
  const n = w.offsets.length;
  return (
    <section class="card wizard">
      <h2>Landmark sighting {n > 0 ? `(${n}/2)` : ''}</h2>
      {!w.picked ? (
        <p>Long-press a landmark on the map: a pole, tree, gate or building corner you can see clearly.</p>
      ) : (
        <>
          <p>Point the barrel exactly at that landmark and hold steady, then press Set.</p>
          <p class="muted">
            Measured azimuth (after declination {fmtDeg(declinationDeg.value)}): {fmtDeg(a ? a.azimuthRawDeg + (declinationDeg.value ?? 0) : null)}
          </p>
          <button class="btn btn-primary" disabled={!a} onClick={setLandmark}>
            Set
          </button>
        </>
      )}
      {n > 0 && <p>Current heading offset: {fmt(session.value?.headingBiasDeg)}°</p>}
      <button class="btn" onClick={closeWizard}>
        {n > 0 ? 'Done' : 'Cancel'}
      </button>
    </section>
  );
}
