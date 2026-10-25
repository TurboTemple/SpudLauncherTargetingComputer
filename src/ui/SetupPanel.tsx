/** Setup screen: cannon profiles, projectiles, wizards, weather, settings and the developer panel. */

import { terminalSpeed } from '../core/atmosphere';
import { G } from '../core/ballistics';
import { LIMITS, newId } from '../data/defaults';
import type { CannonProfile, PowerSetting, Projectile } from '../data/model';
import { SATELLITE_PROVIDERS, satelliteLayer, type SatelliteProviderId } from '../data/satellite';
import {
  addCannon,
  addProjectile,
  fetchWeatherNow,
  removeCannon,
  removeProjectile,
  saveCannon,
  saveProjectile,
  setAtmosphere,
  startLandmarkWizard,
  startMountWizard,
  startNewSession,
  updateSession,
  updateSettings,
} from '../state/actions';
import {
  airRho,
  atmosphere,
  cannon,
  cannons,
  declinationDeg,
  installPrompt,
  kUnit,
  powerSetting,
  projectile,
  projectiles,
  session,
  settings,
  tab,
} from '../state/store';
import { DevPanel } from './DevPanel';
import { Card, NumberField, Select, TextField, Toggle } from './fields';
import { ago, fmt } from './format';

function CannonCard({ c }: { c: CannonProfile }) {
  const active = powerSetting.value;
  const save = (patch: Partial<CannonProfile>) => void saveCannon({ ...c, ...patch });
  const saveSetting = (id: string, patch: Partial<PowerSetting>) => save({ settings: c.settings.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  return (
    <Card
      title="Cannon"
      actions={
        <>
          <button class="btn btn-small" onClick={() => void addCannon()}>
            Add
          </button>
          {cannons.value.length > 1 && (
            <button class="btn btn-small btn-warn" onClick={() => void removeCannon(c.id)}>
              Delete
            </button>
          )}
        </>
      }
    >
      {cannons.value.length > 1 && (
        <Select
          label="Active cannon"
          value={c.id}
          options={cannons.value.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(id) => updateSettings({ activeCannonId: id, activeSettingId: cannons.value.find((x) => x.id === id)?.settings[0]?.id ?? '' })}
        />
      )}
      <TextField label="Name" value={c.name} onChange={(name) => save({ name })} />
      <NumberField label="Barrel diameter" unit="mm" scale={1000} digits={0} value={c.barrelDiameterM} min={0.02} max={0.12} onChange={(v) => save({ barrelDiameterM: v })} />
      <NumberField label="Muzzle height" unit="m" value={c.muzzleHeightM} min={LIMITS.muzzleHeightM[0]} max={LIMITS.muzzleHeightM[1]} onChange={(v) => save({ muzzleHeightM: v })} />
      <Select
        label="Phone top edge points to"
        value={c.mountReversed ? 'breech' : 'muzzle'}
        options={[
          { value: 'muzzle', label: 'Muzzle' },
          { value: 'breech', label: 'Breech' },
        ]}
        onChange={(v) => save({ mountReversed: v === 'breech' })}
      />
      <p>
        Mount tilt offset: <strong>{fmt(c.mountTiltOffsetDeg, 2)}°</strong>
        {c.mountTiltSigmaDeg !== undefined ? ` (±${fmt(c.mountTiltSigmaDeg, 2)}°)` : ' (not calibrated)'}{' '}
        <button class="btn btn-small" onClick={startMountWizard}>
          Calibrate
        </button>
      </p>
      <h3>Power settings</h3>
      {c.settings.map((s) => (
        <div class={`setting-row ${active?.id === s.id ? 'active' : ''}`} key={s.id}>
          <label class="toggle">
            <input type="radio" name="power" checked={active?.id === s.id} onChange={() => updateSettings({ activeSettingId: s.id })} />
            <span>
              {s.label} {s.fittedAt ? <span class="pill ok">calibrated</span> : <span class="pill bad">uncalibrated</span>}
            </span>
          </label>
          <TextField label="Label" value={s.label} onChange={(label) => saveSetting(s.id, { label })} />
          <NumberField label="Numeric (for interpolation)" optional value={s.numeric ?? NaN} onChange={(v) => saveSetting(s.id, { numeric: Number.isFinite(v) ? v : undefined })} />
          <NumberField label="Launch speed" unit="m/s" value={s.v0} min={LIMITS.v0[0]} max={LIMITS.v0[1]} onChange={(v) => saveSetting(s.id, { v0: v })} />
          <NumberField label="Shot-to-shot scatter" unit="m/s" value={s.v0Sigma} min={0} max={50} onChange={(v) => saveSetting(s.id, { v0Sigma: v })} />
          {c.settings.length > 1 && (
            <button class="btn btn-small btn-warn" onClick={() => save({ settings: c.settings.filter((x) => x.id !== s.id) })}>
              Remove setting
            </button>
          )}
        </div>
      ))}
      <button class="btn btn-small" onClick={() => save({ settings: [...c.settings, { id: newId(), label: `Setting ${c.settings.length + 1}`, v0: 40, v0Sigma: 3.2 }] })}>
        Add power setting
      </button>
    </Card>
  );
}

function ProjectileCard({ p }: { p: Projectile }) {
  const save = (patch: Partial<Projectile>) => void saveProjectile({ ...p, ...patch });
  const vt = terminalSpeed(kUnit.value * p.dragScale, G);
  return (
    <Card
      title="Projectile"
      actions={
        <>
          <button class="btn btn-small" onClick={() => void addProjectile()}>
            Add
          </button>
          {projectiles.value.length > 1 && (
            <button class="btn btn-small btn-warn" onClick={() => void removeProjectile(p.id)}>
              Delete
            </button>
          )}
        </>
      }
    >
      {projectiles.value.length > 1 && (
        <Select label="Active projectile" value={p.id} options={projectiles.value.map((x) => ({ value: x.id, label: x.name }))} onChange={(id) => updateSettings({ activeProjectileId: id })} />
      )}
      <TextField label="Name" value={p.name} onChange={(name) => save({ name })} />
      <NumberField label="Mass" unit="g" scale={1000} digits={0} value={p.massKg} min={LIMITS.massKg[0]} max={LIMITS.massKg[1]} onChange={(v) => save({ massKg: v })} />
      <NumberField label="Diameter" unit="mm" scale={1000} digits={0} value={p.diameterM} min={LIMITS.diameterM[0]} max={LIMITS.diameterM[1]} onChange={(v) => save({ diameterM: v })} />
      {cannon.value && Math.abs(cannon.value.barrelDiameterM - p.diameterM) > 1e-6 && (
        <button class="btn btn-small" onClick={() => save({ diameterM: cannon.value!.barrelDiameterM })}>
          Use barrel diameter
        </button>
      )}
      <NumberField label="Drag coefficient Cd" value={p.cd} min={LIMITS.cd[0]} max={LIMITS.cd[1]} onChange={(v) => save({ cd: v })} />
      <NumberField label="Drag scale" value={p.dragScale} min={LIMITS.dragScale[0]} max={LIMITS.dragScale[1]} onChange={(v) => save({ dragScale: v })} />
      <p>
        Terminal speed <strong>{fmt(vt, 1)} m/s</strong>
        {p.fittedAt ? <span class="pill ok">drag fitted</span> : null}
      </p>
      <p class="muted small">When terminal speed is close to the launch speed, drag dominates and the no-air parabola is far off.</p>
    </Card>
  );
}

function HeadingCard() {
  const s = session.value;
  return (
    <Card title="Heading">
      <p>
        Declination at launch: {declinationDeg.value === null ? 'unknown (set the launch point)' : `${fmt(declinationDeg.value)}° (WMM2025)`}
      </p>
      <p>
        Heading offset this session: <strong>{fmt(s?.headingBiasDeg ?? 0)}°</strong> {s?.headingBiasSource ? `(from ${s.headingBiasSource})` : ''}
      </p>
      <div class="row">
        <button
          class="btn btn-primary"
          onClick={() => {
            tab.value = 'aim';
            startLandmarkWizard();
          }}
        >
          Sight landmarks
        </button>
        {s?.headingBiasDeg !== undefined && (
          <button class="btn" onClick={() => void updateSession({ headingBiasDeg: undefined, headingBiasSource: undefined, landmarks: [] })}>
            Reset offset
          </button>
        )}
      </div>
      <p class="muted small">
        The compass is the weakest sensor. Sighting a landmark each session cancels compass error, mount twist and declination. A steel
        barrel or nearby metal bends the compass; PVC is fine.
      </p>
    </Card>
  );
}

function WeatherCard() {
  const a = atmosphere.value;
  const set = (patch: Partial<typeof a>) => setAtmosphere({ ...a, ...patch, source: 'manual', fetchedAt: new Date().toISOString() });
  return (
    <Card
      title="Weather"
      actions={
        <button class="btn btn-small" onClick={() => void fetchWeatherNow()}>
          Fetch
        </button>
      }
    >
      <p class="small">
        Source: {a.source === 'open-meteo' ? `Open-Meteo, ${ago(a.fetchedAt)}` : a.source}. Air density <strong>{fmt(airRho.value, 3)} kg/m³</strong>.
        {a.windGustsMs !== undefined && ` Gusts ${fmt(a.windGustsMs)} m/s.`}
      </p>
      <NumberField label="Temperature" unit="°C" value={a.tempC} min={-40} max={50} onChange={(v) => set({ tempC: v })} />
      <NumberField label="Surface pressure" unit="hPa" value={a.pressureHpa} min={700} max={1100} onChange={(v) => set({ pressureHpa: v })} />
      <NumberField label="Wind speed (10 m)" unit="m/s" value={a.windSpeedMs} min={0} max={40} onChange={(v) => set({ windSpeedMs: v })} />
      <NumberField label="Wind from" unit="° true" value={a.windFromDeg} min={0} max={360} onChange={(v) => set({ windFromDeg: v % 360 })} />
      <NumberField label="Gusts" unit="m/s" optional value={a.windGustsMs ?? NaN} min={0} max={60} onChange={(v) => set({ windGustsMs: Number.isFinite(v) ? v : undefined })} />
      <p class="muted small">Forecast wind is a 10 m average; enter a handheld reading for a better estimate.</p>
    </Card>
  );
}

function SettingsCard() {
  const s = settings.value;
  return (
    <Card title="Aiming and display">
      <NumberField label="Smoothing time constant" unit="ms" scale={1000} digits={0} value={s.emaTauS} min={0} max={2} onChange={(v) => updateSettings({ emaTauS: v })} />
      <NumberField label="STEADY: tilt spread under" unit="°" value={s.steadyElevStdDeg} min={0.01} max={5} onChange={(v) => updateSettings({ steadyElevStdDeg: v })} />
      <NumberField label="STEADY: direction spread under" unit="°" value={s.steadyAzStdDeg} min={0.05} max={10} onChange={(v) => updateSettings({ steadyAzStdDeg: v })} />
      <Toggle label="Auto-lock when steady" checked={s.autoLock} onChange={(v) => updateSettings({ autoLock: v })} />
      <NumberField label="Auto-lock after" unit="s" value={s.autoLockAfterS} min={0.2} max={10} onChange={(v) => updateSettings({ autoLockAfterS: v })} />
      <NumberField label="On target: tilt within" unit="°" value={s.onTargetElevDeg} min={0.05} max={5} onChange={(v) => updateSettings({ onTargetElevDeg: v })} />
      <NumberField label="On target: direction within" unit="°" value={s.onTargetAzDeg} min={0.1} max={10} onChange={(v) => updateSettings({ onTargetAzDeg: v })} />
      <NumberField label="Wind uncertainty in steady air (each axis)" unit="m/s" value={s.windSigmaMs} min={0} max={10} onChange={(v) => updateSettings({ windSigmaMs: v })} />
      <Toggle label="Widen the landing zone for gusts" checked={s.gustWidening} onChange={(v) => updateSettings({ gustWidening: v })} hint="(gust − mean) ÷ 3, added to the steady-air figure" />
      <Toggle label="Scale wind with height (1/7 power law)" checked={s.windShear} onChange={(v) => updateSettings({ windShear: v })} />
      <Toggle label="Audio aiming cues" checked={s.audio} onChange={(v) => updateSettings({ audio: v })} />
      <Select
        label="Theme"
        value={s.theme}
        options={[
          { value: 'light', label: 'High contrast, light' },
          { value: 'dark', label: 'High contrast, dark' },
        ]}
        onChange={(v) => updateSettings({ theme: v })}
      />
    </Card>
  );
}

function SatelliteCard() {
  const s = settings.value;
  const id = s.satelliteProvider;
  const preset = id === 'maptiler' || id === 'esri' ? SATELLITE_PROVIDERS[id] : null;
  const ready = satelliteLayer(s) !== null;
  return (
    <Card title="Satellite imagery">
      <p class="muted small">Satellite view is the easiest way to mark where a shot landed. Switch between map and satellite with the SAT button on the map.</p>
      <Select<SatelliteProviderId>
        label="Provider"
        value={id}
        options={[
          { value: 'none', label: 'Off' },
          { value: 'maptiler', label: 'MapTiler (free key, non-commercial)' },
          { value: 'esri', label: 'Esri World Imagery (ArcGIS key)' },
          { value: 'custom', label: 'Custom tile URL' },
        ]}
        onChange={(v) => updateSettings({ satelliteProvider: v, ...(v === 'none' ? { mapBase: 'map' as const } : {}) })}
      />
      {preset && (
        <>
          <TextField
            label={preset.keyLabel}
            value={id === 'maptiler' ? s.maptilerKey : s.esriKey}
            onChange={(v) => updateSettings(id === 'maptiler' ? { maptilerKey: v.trim() } : { esriKey: v.trim() })}
          />
          <p class="small">
            <a href={preset.signupUrl} target="_blank" rel="noopener">
              Get a key
            </a>{' '}
            ·{' '}
            <a href={preset.termsUrl} target="_blank" rel="noopener">
              Terms
            </a>
          </p>
          <p class="muted small">{preset.terms}</p>
          <p class="muted small">
            The key stays on this phone and is left out of exports. In your provider account, restrict it to this site’s address ({location.origin}) so
            nobody else can use it.
          </p>
        </>
      )}
      {id === 'custom' && (
        <>
          <TextField label="Tile URL ({z}/{x}/{y})" value={s.satelliteUrl} onChange={(v) => updateSettings({ satelliteUrl: v.trim() })} />
          <TextField label="Attribution" value={s.satelliteAttribution} onChange={(v) => updateSettings({ satelliteAttribution: v })} />
          <p class="muted small">Only use a source whose terms allow this use, and give its attribution exactly as it asks.</p>
        </>
      )}
      {id !== 'none' && (
        <Toggle
          label="Show satellite now"
          checked={ready && s.mapBase === 'satellite'}
          onChange={(v) => updateSettings({ mapBase: v ? 'satellite' : 'map' })}
          hint={ready ? undefined : '(needs a key or URL first)'}
        />
      )}
    </Card>
  );
}

function SessionCard() {
  const s = session.value;
  const ip = installPrompt.value;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    <Card title="Session and app">
      <p>Session started {s ? new Date(s.startedAt).toLocaleString() : '—'}.</p>
      <button class="btn" onClick={() => void startNewSession()}>
        Start new session
      </button>
      {ip && (
        <button
          class="btn btn-primary"
          onClick={async () => {
            await ip.prompt();
            installPrompt.value = null;
          }}
        >
          Install app
        </button>
      )}
      {ios && <p class="muted small">To install: tap Share, then Add to Home Screen. Open it once at the field with signal so maps and terrain are cached.</p>}
      <Toggle label="Developer mode" checked={settings.value.devMode} onChange={(v) => updateSettings({ devMode: v })} hint="(sensor simulator, recorder, draggable launch point)" />
    </Card>
  );
}

function AboutCard() {
  return (
    <Card title="About and limitations">
      <p class="small">
        Estimates only. A potato tumbles and varies in shape, so drag changes from shot to shot; spin and lift are ignored; wind aloft differs
        from the 10 m forecast; the ground model is smooth (no trees, hedges or buildings). With a combustion cannon expect the landing zone to
        stay wide: its launch speed varies a lot.
      </p>
      <p class="muted small">
        Map © OpenStreetMap contributors. Terrain: AWS Terrain Tiles. Weather: Open-Meteo. Declination: World Magnetic Model 2025 (NOAA/BGS).
      </p>
      <p class="muted tiny">Spud Trajectory v{__APP_VERSION__}</p>
    </Card>
  );
}

export function SetupPanel() {
  const c = cannon.value;
  const p = projectile.value;
  return (
    <div class="panel-inner">
      {c && <CannonCard c={c} />}
      {p && <ProjectileCard p={p} />}
      <HeadingCard />
      <WeatherCard />
      <SettingsCard />
      <SatelliteCard />
      <SessionCard />
      {settings.value.devMode && <DevPanel />}
      <AboutCard />
    </div>
  );
}
