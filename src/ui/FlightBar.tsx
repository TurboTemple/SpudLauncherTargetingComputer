/**
 * Shown on every screen while a shot is in the air: a running clock, a big Landed button, and
 * a countdown to the predicted landing ("three, two, one, landing", worded per skin) so
 * spotters look in time.
 */

import { useEffect, useState } from 'preact/hooks';
import { markLanded } from '../state/actions';
import { recording, settings, tab } from '../state/store';
import { aimingTone } from './audio';
import { countdownCues, type Cue } from './cues';
import { fmt } from './format';
import { skinById } from './skins';

function play(c: Cue, voice: boolean): void {
  if (voice && c.say && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(c.say);
    u.rate = 1.3;
    window.speechSynthesis.speak(u);
  } else if (!c.flavour) {
    aimingTone.beep(c.freq, c.final ? 0.45 : 0.12);
  }
  if (c.final) navigator.vibrate?.(200);
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
    // The firing call is due at once; allow for the moment it took to get here.
    const timers = countdownCues(skinById(settings.peek().skin).voice, predicted)
      .filter((c) => c.t > elapsed - 0.25)
      .map((c) => setTimeout(() => play(c, voice), Math.max(0, c.t - elapsed) * 1000));
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
