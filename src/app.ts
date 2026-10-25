/** Entry point: render the UI, load stored data, start the solver worker, register the service worker. */

import { render } from 'preact';
import { h } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { bootstrap } from './state/actions';
import { initSolver } from './state/solver';
import { installPrompt, toast, updateAvailable } from './state/store';
import { App } from './ui/App';
import { aimingTone } from './ui/audio';
import './ui/styles.css';

render(h(App, {}), document.getElementById('app')!);

bootstrap()
  .then(initSolver)
  .catch((e: unknown) => {
    console.error(e);
    toast(`Startup failed: ${(e as Error).message}`, 'error', 10000);
  });

// iOS unlocks Web Audio only from a user gesture: the first tap anywhere does it.
window.addEventListener('pointerdown', () => aimingTone.unlock(), { once: true });

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
