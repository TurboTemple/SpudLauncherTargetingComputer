/** Builds shot cards for the live prediction and for a recorded shot. */

import { DEFAULT_SHEAR_EXPONENT, airDensity, dragFactor, KELVIN, referenceWind, windVector } from '../core/atmosphere';
import { simulate } from '../core/ballistics';
import { toRad } from '../core/angles';
import { ellipsePolygon } from '../core/uncertainty';
import type { Shot } from '../data/model';
import { distanceM, enuOf } from '../geoDeg';
import { aim, cannon, launch, potatoMassKg, powerSetting, prediction, projectiles, target, toast, zone } from '../state/store';
import { compassPoint, fmt } from './format';
import { shareShotCard, type ShotCardSpec } from './shotCard';

const when = (d: Date) => d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export async function shareCurrentPrediction(): Promise<void> {
  const pr = prediction.value;
  const l = launch.value;
  const a = aim.value;
  if (!pr || !l || !a) return;
  const z = zone.value;
  const t = target.value;
  const spec: ShotCardSpec = {
    title: `${fmt(pr.range, 0)} m shot`,
    subtitle: `${when(new Date())} · ${cannon.value?.name ?? ''} · ${powerSetting.value?.label ?? ''}`,
    launch: l,
    path: pr.path,
    impact: [pr.impact[0], pr.impact[1]],
    ...(z ? { zone: ellipsePolygon(z.mean, z.ellipses[1]!) } : {}),
    ...(t ? { target: t } : {}),
    stats: [
      ['Tilt', `${fmt(a.elevationDeg)}°`],
      ['Direction', `${fmt(a.azimuthDeg, 0)}° ${compassPoint(a.azimuthDeg)}`],
      ['Range', `${fmt(pr.range, 0)} m`],
      ['Flight', `${fmt(pr.tof)} s`],
      ['Apex', `${fmt(pr.apex[2], 0)} m`],
      ['Impact', `${fmt(0.5 * potatoMassKg.value * pr.impactSpeed ** 2, 0)} J`],
    ],
    note: 'Predicted, with the 90% landing zone · Spud Trajectory · estimates only',
  };
  try {
    await shareShotCard(spec, `spud-shot-${Math.round(pr.range)}m`);
  } catch (e) {
    toast(`Could not make the card: ${(e as Error).message}`, 'error');
  }
}

export async function shareRecordedShot(s: Shot): Promise<void> {
  const p = projectiles.value.find((x) => x.id === s.projectileId);
  if (!p) return;
  const atm = s.atmosphere;
  const alpha = s.conditions.shearExponent ?? (s.conditions.windShear ? DEFAULT_SHEAR_EXPONENT : 0);
  const rho = airDensity(atm.pressureHpa * 100, atm.tempC + KELVIN);
  const mass = s.massKg ?? p.massKg;
  const plane = s.impact?.groundHeightM !== undefined ? s.impact.groundHeightM - s.launch.groundHeightM : 0;
  const r = simulate(
    {
      v0: s.conditions.v0,
      elevation: toRad(s.aim.elevationRawDeg - s.aim.mountOffsetDeg),
      azimuth: toRad(s.aim.azimuthRawDeg + s.aim.declinationDeg + s.aim.headingBiasDeg),
      k: dragFactor(rho, p.cd, p.diameterM, mass, s.conditions.dragScale),
      wind: windVector(referenceWind(atm.windSpeedMs, atm.source === 'manual' ? atm.measuredAtM : undefined, alpha), toRad(atm.windFromDeg)),
      shearExponent: alpha,
      h0: s.conditions.muzzleHeightM,
    },
    { plane, recordPath: true },
  );
  const azDeg = (s.aim.azimuthRawDeg + s.aim.declinationDeg + s.aim.headingBiasDeg + 360) % 360;
  const landed = s.impact ? distanceM(s.launch, s.impact) : null;
  const miss = s.impact ? distanceM(s.predicted, s.impact) : null;
  const pe = enuOf(s.launch, s.predicted);
  const spec: ShotCardSpec = {
    title: landed !== null ? `${fmt(landed, 0)} m shot` : 'Shot (not marked)',
    subtitle: `${when(new Date(s.time))}${s.game ? ` · ${s.game.player}` : ''}`,
    launch: { lat: s.launch.lat, lon: s.launch.lon },
    path: r.path!,
    impact: [pe.x, pe.y],
    ...(s.impact ? { marked: s.impact } : {}),
    ...(s.game ? { target: s.game.target } : {}),
    stats: [
      ['Tilt', `${fmt(s.aim.elevationRawDeg - s.aim.mountOffsetDeg)}°`],
      ['Direction', `${fmt(azDeg, 0)}° ${compassPoint(azDeg)}`],
      ['Landed', landed !== null ? `${fmt(landed, 0)} m` : '—'],
      ['Flight', `${fmt(s.flightTimeS ?? s.predicted.flightTimeS)} s`],
      ['Off prediction', miss !== null ? `${fmt(miss)} m` : '—'],
      s.game?.points !== undefined ? ['Score', `${s.game.points} pts`] : ['Potato', `${fmt(mass * 1000, 0)} g`],
    ],
    note: `Red ring: predicted · green: where it landed${s.impact?.method === 'spotter' ? ' (spotter)' : ''} · Spud Trajectory`,
  };
  try {
    await shareShotCard(spec, `spud-shot-${s.time.slice(0, 16).replace(/[:T]/g, '-')}`);
  } catch (e) {
    toast(`Could not make the card: ${(e as Error).message}`, 'error');
  }
}
