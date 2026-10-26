import { useEffect, useRef } from 'preact/hooks';
import { cameraOpen, mapAction, ready, settings, tab, toasts } from '../state/store';
import { AimPanel } from './AimPanel';
import { Banners, SafetyCard } from './Banners';
import { CameraView } from './CameraView';
import { FlightBar } from './FlightBar';
import { FxFlash, MapFx } from './Fx';
import { MapView } from './MapView';
import { SetupPanel } from './SetupPanel';
import { skinById } from './skins';
import { ShotsPanel } from './ShotsPanel';
import { SpotterScreen } from './SpotterScreen';
import { TabBar } from './TabBar';
import { TargetPanel } from './TargetPanel';
import { WizardCard } from './WizardCard';

const HINT: Record<string, string> = {
  launch: 'Long-press: place launch point',
  target: 'Long-press: set target',
  impact: 'Long-press: mark impact',
  landmark: 'Long-press: pick landmark',
};

export function App() {
  const t = tab.value;
  const panel = useRef<HTMLElement>(null);
  const { theme, skin, tintMap, effects } = settings.value;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.skin = skin;
    root.dataset.tint = tintMap ? 'on' : 'off';
    root.dataset.fx = effects && skin !== 'plain' ? 'on' : 'off';
    // Remembered here too so the next start shows the right skin before settings load.
    try {
      localStorage.setItem('spud-look', JSON.stringify({ theme, skin, tint: root.dataset.tint, fx: root.dataset.fx }));
    } catch {
      /* private mode: a plain first frame is fine */
    }
    // Status bar and task switcher colour follow the skin.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#000000');
  }, [theme, skin, tintMap, effects]);
  // One scroll container serves every screen, so start each screen at the top.
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [t]);
  if (!ready.value) return <div class="loading">Loading…</div>;
  if (settings.value.spotter) {
    return (
      <>
        <SpotterScreen />
        <div class="toasts" aria-live="polite">
          {toasts.value.map((m) => (
            <div key={m.id} class={`toast toast-${m.kind}`}>
              {m.text}
            </div>
          ))}
        </div>
      </>
    );
  }
  const action = mapAction.value;
  const tag = skinById(skin).tag;
  return (
    <div class={`app tab-${t}`}>
      <div class={`map-wrap${tag ? ' has-tag' : ''}`} hidden={t === 'setup'}>
        <MapView />
        <MapFx />
        <FxFlash />
        {tag && (
          <div class="skin-tag" aria-hidden="true">
            {tag}
          </div>
        )}
        {action && <div class="map-hint">{HINT[action]}</div>}
      </div>
      <main class="panel" ref={panel}>
        <SafetyCard />
        <Banners />
        <WizardCard />
        {t === 'aim' && <AimPanel />}
        {t === 'target' && <TargetPanel />}
        {t === 'shots' && <ShotsPanel />}
        {t === 'setup' && <SetupPanel />}
      </main>
      <div class="toasts" aria-live="polite">
        {toasts.value.map((m) => (
          <div key={m.id} class={`toast toast-${m.kind}`}>
            {m.text}
          </div>
        ))}
      </div>
      {cameraOpen.value && <CameraView />}
      <FlightBar />
      <TabBar />
    </div>
  );
}
