/**
 * Shown on every screen while a shot is in the air: a running clock, a big Landed button, and
 * a countdown to the predicted landing ("three, two, one, landing") so spotters look in time.
 */

import { useEffect, useState } from 'preact/hooks';
import { markLanded } from '../state/actions';
import { recording, settings, tab } from '../state/store';
import { aimingTone } from './audio';
import { fmt } from './format';

function say(word: string, freq: number, voice: boolean): void {
  if (voice && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(word);
    u.rate = 1.3;
    window.speechSynthesis.speak(u);
  } else {
    aimingTone.beep(freq, word === 'landing' ? 0.45 : 0.12);
  }
}

export function FlightBar() {
  const r = recording.value;
  const firedAt = r?.firedAt ?? null;
  const predicted = r?.draft.predicted.flightTimeS ?? NaN;
  const [now, setNow] = useState(performance.now() / 1000);

  useEffect(() => {
    if (firedAt === null) return;
    const id = setInterval(() => setNow(performance.now() / 1000), 100);
    return () => clearInterval(id);
  }, [firedAt]);

  // Countdown to the predicted landing.
  useEffect(() => {
    if (firedAt === null || !settings.peek().countdown || !Number.isFinite(predicted)) return;
    const voice = settings.peek().countdownVoice;
    const elapsed = performance.now() / 1000 - firedAt;
    const cues: [number, string, number][] = [
      [predicted - 3, 'three', 660],
      [predicted - 2, 'two', 660],
      [predicted - 1, 'one', 660],
      [predicted, 'landing', 1320],
    ];
    const timers = cues
      .filter(([t]) => t > elapsed)
      .map(([t, word, freq]) =>
        setTimeout(() => {
          say(word, freq, voice);
          if (word === 'landing') navigator.vibrate?.(200);
        }, (t - elapsed) * 1000),
      );
    return () => {
      timers.forEach(clearTimeout);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [firedAt, predicted]);

  if (!r) return null;
  if (firedAt !== null) {
    return (
      <div class="flight-bar" role="status">
        <span class="flight-time">
          In flight {fmt(now - firedAt, 1)} s<small> / ~{fmt(predicted, 1)} s</small>
        </span>
        <button class="btn btn-big btn-warn" onClick={markLanded}>
          Landed
        </button>
      </div>
    );
  }
  if (r.draft.flightTimeS !== undefined && !r.draft.impact && tab.value !== 'shots') {
    return (
      <div class="flight-bar" role="status">
        <span>Landed after {fmt(r.draft.flightTimeS, 2)} s. Now mark where.</span>
        <button class="btn btn-primary" onClick={() => (tab.value = 'shots')}>
          Mark impact
        </button>
      </div>
    );
  }
  return null;
}
