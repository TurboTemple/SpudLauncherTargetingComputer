/** Shots screen: record-shot flow, log, calibration fit with standard errors, export and import. */

import { useEffect, useState } from 'preact/hooks';
import type { FittedValue } from '../core/calibration';
import { distanceM } from '../geoDeg';
import {
  applyFit,
  beginRecord,
  cancelRecord,
  exportCsv,
  exportJson,
  importJson,
  markFired,
  markImpactByGps,
  markLanded,
  removeShot,
  runFit,
  saveRecord,
  toggleExclude,
} from '../state/actions';
import { cannons, fitBusy, fitResult, projectiles, recording, sessions, shots, toast } from '../state/store';
import { fmt, fmtDeg, timeOf } from './format';
import { shareRecordedShot } from './shareCards';
import { ShotStats } from './ShotStats';
import { SpotterCard } from './SpotterCard';

function RecordFlow() {
  const r = recording.value;
  const [now, setNow] = useState(performance.now() / 1000);
  useEffect(() => {
    if (!r?.firedAt) return;
    const id = setInterval(() => setNow(performance.now() / 1000), 50);
    return () => clearInterval(id);
  }, [r?.firedAt]);

  if (!r) {
    return (
      <button
        class="btn btn-primary btn-big"
        onClick={() => {
          const err = beginRecord();
          if (err) toast(err, 'warn');
        }}
      >
        Record a shot
      </button>
    );
  }
  const d = r.draft;
  return (
    <section class="card record">
      <h2>Recording shot</h2>
      <p class="small">
        Aim locked: {fmtDeg(d.aim.elevationRawDeg - d.aim.mountOffsetDeg)} tilt,{' '}
        {fmtDeg((d.aim.azimuthRawDeg + d.aim.declinationDeg + d.aim.headingBiasDeg + 360) % 360, 0)} azimuth. Predicted flight{' '}
        {fmt(d.predicted.flightTimeS, 2)} s.{d.massKg !== undefined && ` Potato ${fmt(d.massKg * 1000, 0)} g.`}
      </p>
      <div class="row">
        {r.firedAt === null ? (
          <button class="btn btn-big" onClick={() => markFired()}>
            Fire
          </button>
        ) : (
          <button class="btn btn-big btn-warn" onClick={markLanded}>
            Landed ({fmt(now - r.firedAt, 1)} s)
          </button>
        )}
        {d.flightTimeS !== undefined && <span class="pill">Flight {fmt(d.flightTimeS, 2)} s</span>}
      </div>
      <p>
        Mark the impact: long-press it on the map (satellite view is best), or walk to it and{' '}
        <button class="btn btn-small" onClick={markImpactByGps} disabled={!!r.standing}>
          {r.standing ? `Averaging GPS ${fmt(r.standing.span, 0)}/5 s` : "I'm standing on it"}
        </button>
      </p>
      {d.impact && (
        <p class="small">
          Marked {d.impact.method === 'gps' ? `by GPS (±${fmt(d.impact.sigmaM)} m)` : 'on the map'}: {fmt(distanceM(d.predicted, d.impact))} m from
          the prediction.
        </p>
      )}
      <div class="row">
        <button class="btn btn-primary" onClick={() => void saveRecord()}>
          Save shot
        </button>
        <button class="btn" onClick={cancelRecord}>
          Discard
        </button>
      </div>
    </section>
  );
}

function Value({ label, v, unit, digits = 2, scale = 1 }: { label: string; v: FittedValue; unit: string; digits?: number; scale?: number }) {
  return (
    <tr>
      <td>{label}</td>
      <td>
        <strong>{fmt(v.value * scale, digits)}</strong>
        {v.fitted && Number.isFinite(v.se) ? ` ± ${fmt(v.se * scale, digits)}` : ''} {unit}
      </td>
      <td class={v.fitted && !v.atBound ? 'ok' : 'muted'}>
        {v.atBound ? 'at its limit: check the marks and flight times' : v.fitted ? 'fitted' : `held: ${v.reason ?? ''}`}
      </td>
    </tr>
  );
}

function FitCard() {
  const f = fitResult.value;
  const settingName = Object.fromEntries(cannons.value.flatMap((c) => c.settings.map((s) => [s.id, `${c.name} · ${s.label}`])));
  const projName = Object.fromEntries(projectiles.value.map((p) => [p.id, p.name]));
  const marked = shots.value.filter((s) => s.impact && !s.excluded).length;
  return (
    <section class="card">
      <header class="card-head">
        <h2>Calibration</h2>
        <button class="btn btn-primary" disabled={fitBusy.value || marked === 0} onClick={() => void runFit()}>
          {fitBusy.value ? 'Fitting…' : 'Fit'}
        </button>
      </header>
      <p class="muted small">
        {marked} marked shot{marked === 1 ? '' : 's'} used. Needs 2 shots per power setting, 3 in total before drag is freed; timed shots
        help most.
      </p>
      {f && (
        <>
          <table class="fit">
            <tbody>
              {Object.entries(f.result.v0).map(([id, v]) => (
                <Value key={id} label={`Launch speed: ${settingName[id] ?? id}`} v={v} unit="m/s" />
              ))}
              {Object.entries(f.result.speedScatter).map(([id, s]) =>
                Number.isFinite(s.sigma) ? (
                  <tr key={`s${id}`}>
                    <td>Shot-to-shot scatter: {settingName[id] ?? id}</td>
                    <td>
                      <strong>{fmt(s.sigma, 2)}</strong> m/s
                    </td>
                    <td class="muted">from {s.perShot.length} shots</td>
                  </tr>
                ) : null,
              )}
              {Object.entries(f.result.dragScale).map(([id, v]) => (
                <Value key={id} label={`Drag scale: ${projName[id] ?? id}`} v={v} unit="" />
              ))}
              {Object.entries(f.result.headingBias).map(([id, v]) => (
                <Value key={id} label={`Heading bias: session ${sessionLabel(id)}`} v={v} unit="°" scale={180 / Math.PI} />
              ))}
            </tbody>
          </table>
          <p class="muted small">
            S = {fmt(f.result.S, 2)} after {f.result.iterations} iterations{f.result.converged ? '' : ' (not converged)'}. {f.result.notes.join(' ')}
          </p>
          <p class="muted small">Residual map: each line joins a fitted prediction to its marked impact.</p>
          <button class="btn btn-primary" onClick={() => void applyFit()}>
            Apply to profiles
          </button>
        </>
      )}
    </section>
  );
}

function sessionLabel(id: string): string {
  const s = sessions.value.find((x) => x.id === id);
  return s ? new Date(s.startedAt).toLocaleDateString() : id.slice(0, 6);
}

export function ShotsPanel() {
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const list = [...shots.value].reverse();
  const settingName = Object.fromEntries(cannons.value.flatMap((c) => c.settings.map((s) => [s.id, s.label])));
  const residual = new Map((fitResult.value?.result.residuals ?? []).map((r) => [r.id, r]));
  return (
    <div class="panel-inner">
      <RecordFlow />
      <FitCard />
      <ShotStats />
      <SpotterCard />
      <section class="card">
        <header class="card-head">
          <h2>Shot log ({shots.value.length})</h2>
        </header>
        {list.length === 0 && <p class="muted">No shots yet.</p>}
        <ul class="shots">
          {list.map((s) => {
            const miss = s.impact ? distanceM(s.predicted, s.impact) : null;
            const r = residual.get(s.id);
            return (
              <li key={s.id} class={s.excluded ? 'excluded' : ''}>
                <button class="shot-row" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  <span>{timeOf(s.time)}</span>
                  <span>{settingName[s.settingId] ?? '?'}</span>
                  <span>
                    {fmtDeg(s.aim.elevationRawDeg - s.aim.mountOffsetDeg, 1)} / {fmtDeg((s.aim.azimuthRawDeg + s.aim.declinationDeg + s.aim.headingBiasDeg + 360) % 360, 0)}
                  </span>
                  <span>{miss === null ? 'unmarked' : `${fmt(miss)} m miss`}</span>
                </button>
                {open === s.id && (
                  <div class="shot-detail small">
                    <p>
                      Raw tilt {fmtDeg(s.aim.elevationRawDeg, 2)} − mount {fmtDeg(s.aim.mountOffsetDeg, 2)}; raw azimuth {fmtDeg(s.aim.azimuthRawDeg)} +
                      declination {fmtDeg(s.aim.declinationDeg)} + bias {fmtDeg(s.aim.headingBiasDeg)}.
                    </p>
                    <p>
                      {fmt(s.atmosphere.tempC)} °C, {fmt(s.atmosphere.pressureHpa, 0)} hPa, wind {fmt(s.atmosphere.windSpeedMs)} m/s from{' '}
                      {fmt(s.atmosphere.windFromDeg, 0)}°. v0 {fmt(s.conditions.v0)} m/s, drag ×{fmt(s.conditions.dragScale, 2)}
                      {s.massKg !== undefined ? `, potato ${fmt(s.massKg * 1000, 0)} g` : ''}.
                    </p>
                    <p>
                      Predicted flight {fmt(s.predicted.flightTimeS, 2)} s{s.flightTimeS !== undefined ? `, timed ${fmt(s.flightTimeS, 2)} s` : ''}.
                      {r && ` Fit residual: ${fmt(r.down)} m downrange, ${fmt(r.cross)} m sideways${r.dt !== undefined ? `, ${fmt(r.dt, 2)} s` : ''}.`}
                    </p>
                    <div class="row">
                      <button class="btn btn-small" onClick={() => void shareRecordedShot(s)}>
                        Share card
                      </button>
                      <button class="btn btn-small" onClick={() => void toggleExclude(s.id)}>
                        {s.excluded ? 'Include in fits' : 'Exclude from fits'}
                      </button>
                      <button
                        class="btn btn-small btn-warn"
                        onClick={() => {
                          if (confirmDelete === s.id) void removeShot(s.id);
                          else setConfirmDelete(s.id);
                        }}
                      >
                        {confirmDelete === s.id ? 'Tap again to delete' : 'Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section class="card">
        <h2>Data</h2>
        <div class="row">
          <button class="btn" onClick={() => void exportJson()}>
            Export JSON
          </button>
          <button class="btn" onClick={exportCsv}>
            Export shots CSV
          </button>
          <label class="btn">
            Import JSON
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) void importJson(f);
              }}
            />
          </label>
        </div>
        <p class="muted small">Everything stays on this phone. Export regularly to keep a backup.</p>
      </section>
    </div>
  );
}
