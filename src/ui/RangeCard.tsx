/** Range card: tilt against range, flight time, apex, impact speed and energy, for one direction. */

import { useState } from 'preact/hooks';
import type { RangeRow } from '../core/footprint';
import { download } from '../state/actions';
import { requestRangeCard } from '../state/solver';
import { airRho, atmosphere, cannon, launchSpeed, potatoMassKg, powerSetting, projectile, wind10 } from '../state/store';
import { compassPoint, fmt } from './format';

export function RangeCard({ azimuthDeg, label }: { azimuthDeg: number | null; label: string }) {
  const [rows, setRows] = useState<RangeRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [forAz, setForAz] = useState<number | null>(null);
  if (azimuthDeg === null) return null;

  const make = async () => {
    setBusy(true);
    setRows(await requestRangeCard(azimuthDeg));
    setForAz(azimuthDeg);
    setBusy(false);
  };
  const conditions = `${cannon.value?.name ?? ''} · ${powerSetting.value?.label ?? ''} · ${fmt(launchSpeed.value?.v0)} m/s · ${projectile.value?.name ?? ''} ${fmt(
    potatoMassKg.value * 1000,
    0,
  )} g · air ${fmt(airRho.value, 3)} kg/m³ · wind ${fmt(wind10.value.speed)} m/s from ${fmt(atmosphere.value.windFromDeg, 0)}°`;
  const csv = () => {
    const head = 'tilt_deg,range_m,flight_s,apex_m,impact_speed_ms,energy_j';
    const body = rows!.map((r) => [r.elevationDeg, r.range.toFixed(1), r.tof.toFixed(2), r.apex.toFixed(1), r.impactSpeed.toFixed(1), r.energy.toFixed(0)].join(','));
    download(`spud-range-card-${Math.round(forAz!)}deg.csv`, [`# ${conditions}, toward ${Math.round(forAz!)}°`, head, ...body].join('\n') + '\n', 'text/csv');
  };

  return (
    <details class="card range-card" onToggle={(e) => (e.target as HTMLDetailsElement).open && !rows && void make()}>
      <summary>Range card {label}</summary>
      {busy && <p class="muted">Working it out…</p>}
      {rows && (
        <div class="range-card-print">
          <h2 class="print-only">Range card</h2>
          <p class="small">
            Toward {fmt(forAz, 0)}° {compassPoint(forAz!)}. {conditions}. Includes this direction's wind and ground.
            {forAz !== null && Math.abs(forAz - azimuthDeg) > 2 && (
              <>
                {' '}
                <button class="link" onClick={() => void make()}>
                  Update for {fmt(azimuthDeg, 0)}°
                </button>
              </>
            )}
          </p>
          <table class="table">
            <thead>
              <tr>
                <th>Tilt °</th>
                <th>Range m</th>
                <th>Flight s</th>
                <th>Apex m</th>
                <th>Impact m/s</th>
                <th>Energy J</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.elevationDeg} class={r.best ? 'best' : ''}>
                  <td>
                    {fmt(r.elevationDeg, Number.isInteger(r.elevationDeg) ? 0 : 1)}
                    {r.best ? ' ★' : ''}
                  </td>
                  <td>{fmt(r.range, 0)}</td>
                  <td>{fmt(r.tof, 1)}</td>
                  <td>{fmt(r.apex, 0)}</td>
                  <td>{fmt(r.impactSpeed, 0)}</td>
                  <td>{fmt(r.energy, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="muted tiny">★ furthest reach. Estimates only.</p>
          <div class="row no-print">
            <button class="btn btn-small" onClick={() => window.print()}>
              Print
            </button>
            <button class="btn btn-small" onClick={csv}>
              Download CSV
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
