/**
 * Skin effects, for fun: an animated overlay on the map (scan lines, HUD frames, a status
 * line), and a big flash with a sound when the aim locks, a shot goes and it lands.
 * Decorative only: pointer-events none and hidden from screen readers. The look of each part
 * is in fx.css; animations stop under "reduce motion".
 */

import { effect } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { SkinId } from '../data/model';
import { lockedAim, recording, settings } from '../state/store';
import { aimingTone } from './audio';
import { skinById } from './skins';

/** Effects are on for this skin (never for plain). */
export function fxOn(): boolean {
  const s = settings.value;
  return s.effects && s.skin !== 'plain';
}

function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span class="fx-clock">{now.toISOString().slice(11, 19)}Z</span>;
}

/** Overlay over the map: three layers the skin styles, plus a status line. */
export function MapFx() {
  if (!fxOn()) return null;
  const s = settings.value;
  const skin = skinById(s.skin);
  return (
    <div class="map-fx" aria-hidden="true">
      <i class="fx-1" />
      <i class="fx-2" />
      <i class="fx-3" />
      <span class={`fx-status${s.mapBase === 'satellite' ? ' raised' : ''}`}>
        <b class="fx-dot" />
        {skin.fx?.status}
        {s.skin === 'military' && <UtcClock />}
        {s.skin === 'retro' && <b class="fx-cursor" />}
      </span>
    </div>
  );
}

/** Lock-on sounds: two quick pips and a high one; a rising sweep; an 8-bit arpeggio. */
function lockSound(skin: SkinId): void {
  const b = aimingTone.beep.bind(aimingTone);
  if (skin === 'military') {
    b(1400, 0.06, { type: 'square', volume: 0.12 });
    b(1400, 0.06, { type: 'square', volume: 0.12, delay: 0.11 });
    b(1900, 0.16, { type: 'square', volume: 0.12, delay: 0.22 });
  } else if (skin === 'spy') {
    b(500, 0.22, { to: 2400, volume: 0.2 });
    b(2400, 0.1, { volume: 0.2, delay: 0.26 });
    b(3000, 0.1, { volume: 0.15, delay: 0.38 });
  } else if (skin === 'retro') {
    [523, 659, 784, 1047].forEach((f, i) => b(f, 0.06, { type: 'square', volume: 0.12, delay: i * 0.07 }));
  }
}

type FxEvent = 'lock' | 'fire' | 'land';

/** A word flashed over the map when the aim locks, a shot is fired and it lands. */
export function FxFlash() {
  const [flash, setFlash] = useState<{ n: number; kind: FxEvent; text: string } | null>(null);
  useEffect(() => {
    let n = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasLocked = lockedAim.peek() !== null;
    let wasFired = recording.peek()?.firedAt != null;
    let wasLanded = recording.peek()?.draft.flightTimeS !== undefined;
    const show = (kind: FxEvent) => {
      const s = settings.peek();
      const fx = skinById(s.skin).fx;
      if (!s.effects || !fx) return;
      setFlash({ n: ++n, kind, text: fx[kind] });
      clearTimeout(timer);
      timer = setTimeout(() => setFlash(null), 1800);
      if (kind === 'lock' && s.audio) lockSound(s.skin);
    };
    const stop = effect(() => {
      const locked = lockedAim.value !== null;
      const r = recording.value;
      const fired = r?.firedAt != null;
      const landed = r?.draft.flightTimeS !== undefined;
      // A detected shot locks and fires at once: show the firing only.
      if (fired && !wasFired) show('fire');
      else if (locked && !wasLocked) show('lock');
      if (landed && !wasLanded) show('land');
      wasLocked = locked;
      wasFired = fired;
      wasLanded = landed;
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);
  if (!flash) return null;
  return (
    <div key={flash.n} class={`fx-flash fx-flash-${flash.kind}`} aria-hidden="true">
      {flash.text}
    </div>
  );
}
