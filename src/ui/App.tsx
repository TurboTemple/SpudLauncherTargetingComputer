import { useEffect, useRef } from 'preact/hooks';
import { mapAction, ready, settings, tab, toasts } from '../state/store';
import { AimPanel } from './AimPanel';
import { Banners, SafetyCard } from './Banners';
import { MapView } from './MapView';
import { SetupPanel } from './SetupPanel';
import { ShotsPanel } from './ShotsPanel';
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
  useEffect(() => {
    document.documentElement.dataset.theme = settings.value.theme;
  }, [settings.value.theme]);
  // One scroll container serves every screen, so start each screen at the top.
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [t]);
  if (!ready.value) return <div class="loading">Loading…</div>;
  const action = mapAction.value;
  return (
    <div class={`app tab-${t}`}>
      <div class="map-wrap" hidden={t === 'setup'}>
        <MapView />
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
      <TabBar />
    </div>
  );
}
