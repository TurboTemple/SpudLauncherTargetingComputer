import { atmosphere, compassAccuracy, gpsError, headingMode, lastFix, northReferenced, sensorPermission, sensorsRunning, session, simulatorOn, terrain } from '../state/store';
import { ago, fmt } from './format';

function Chip({ label, state }: { label: string; state: 'ok' | 'warn' | 'bad' | 'idle' }) {
  return <span class={`chip chip-${state}`}>{label}</span>;
}

export function StatusChips() {
  const perm = sensorPermission.value;
  const sens = simulatorOn.value
    ? <Chip label="Sensors: simulator" state="warn" />
    : perm === 'denied'
      ? <Chip label="Sensors: denied" state="bad" />
      : perm === 'unsupported'
        ? <Chip label="Sensors: none" state="bad" />
        : sensorsRunning.value
          ? <Chip label="Sensors on" state="ok" />
          : <Chip label="Sensors off" state="idle" />;

  const mode = headingMode.value;
  const landmark = session.value?.headingBiasSource === 'landmark';
  let compass = <Chip label="Compass: —" state="idle" />;
  if (mode === 'ios-compass') {
    const acc = compassAccuracy.value;
    compass = <Chip label={`Compass ±${fmt(acc, 0)}°`} state={acc !== null && acc >= 0 && acc <= 10 ? 'ok' : 'warn'} />;
  } else if (mode === 'absolute' || mode === 'simulator') {
    compass = <Chip label={landmark ? 'Heading: landmark' : 'Compass: magnetic'} state={landmark ? 'ok' : 'warn'} />;
  } else if (mode === 'relative') {
    compass = <Chip label={landmark ? 'Heading: landmark' : 'No compass'} state={landmark ? 'ok' : 'bad'} />;
  }
  if (mode && !northReferenced.value && !landmark) compass = <Chip label="Heading not referenced" state="bad" />;

  const f = lastFix.value;
  const gps = gpsError.value ? <Chip label="GPS error" state="bad" /> : f ? <Chip label={`GPS ±${fmt(f.accuracy, 0)} m`} state={f.accuracy <= 10 ? 'ok' : 'warn'} /> : <Chip label="GPS: —" state="idle" />;

  const t = terrain.value;
  const ter =
    t.state === 'loaded' ? <Chip label="Terrain loaded" state="ok" /> : t.state === 'loading' ? <Chip label="Terrain loading" state="idle" /> : t.state === 'flat' ? <Chip label="Flat ground" state="warn" /> : <Chip label="Terrain: —" state="idle" />;

  const atm = atmosphere.value;
  const wx = atm.source === 'manual' ? <Chip label="Weather: manual" state="ok" /> : atm.source === 'open-meteo' ? <Chip label={`Weather ${ago(atm.fetchedAt)}`} state={Date.now() - Date.parse(atm.fetchedAt ?? '') < 3 * 3600e3 ? 'ok' : 'warn'} /> : <Chip label="Weather: default" state="warn" />;

  return (
    <div class="chips">
      {sens}
      {compass}
      {gps}
      {ter}
      {wx}
    </div>
  );
}
