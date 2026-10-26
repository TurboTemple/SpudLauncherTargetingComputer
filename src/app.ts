/** Entry point: render the UI, load stored data, start the solver worker, register the service worker. */

import { render } from 'preact';
import { h } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { parseSpotterLink } from './data/spotter';
import { becomeSpotter, bootstrap, importSpotterMarks } from './state/actions';
import { initSolver } from './state/solver';
import { installPrompt, toast, updateAvailable } from './state/store';
import { App } from './ui/App';
import { aimingTone } from './ui/audio';
import './ui/fonts';
import './ui/styles.css';
import './ui/skins.css';
import './ui/fx.css';

// Apply the last skin at once, so the loading screen does not flash the plain one.
try {
  const look = JSON.parse(localStorage.getItem('spud-look') ?? 'null') as Record<string, string> | null;
  if (look) Object.assign(document.documentElement.dataset, look);
} catch {
  /* no stored look */
}

render(h(App, {}), document.getElementById('app')!);

/** Links carry spotter invites (#spot=) and a spotter's marks (#marks=) in the fragment. */
async function handleLink(): Promise<void> {
  const r = location.hash.length > 1 ? await parseSpotterLink(location.hash) : null;
  if (!r) return;
  history.replaceState(null, '', location.pathname + location.search);
  if ('invite' in r) becomeSpotter(r.invite);
  else await importSpotterMarks(r.marks);
}

bootstrap()
  .then(initSolver)
  .then(handleLink)
  .then(() => window.addEventListener('hashchange', () => void handleLink()))
  .catch((e: unknown) => {
    console.error(e);
    toast(`Startup failed: ${(e as Error).message}`, 'error', 10000);
  });

// iOS unlocks Web Audio only from a user gesture: the first tap anywhere does it.
window.addEventListener(
  'pointerdown',
  () => {
    aimingTone.unlock();
    if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  },
  { once: true },
);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt.value = e as Event & { prompt: () => Promise<void> };
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const update = registerSW({
    onNeedRefresh: () => (updateAvailable.value = () => void update(true)),
    onOfflineReady: () => toast('Ready to work offline'),
  });
}
