/**
 * Countdown cues from firing to the predicted landing, worded per skin.
 *
 * - plain: "three, two, one, landing".
 * - military: "Shot, over" on firing and "Splash, over" before landing, as an artillery fire
 *   direction centre calls them. "Splash" comes 5 s before impact, or halfway (at most 1.5 s in)
 *   when the flight is shorter than that; the landing itself is a tone.
 * - spy: "Package away", "three, two, one", "Delivered".
 */

import type { VoiceStyle } from './skins';

export interface Cue {
  /** Seconds after firing. */
  t: number;
  /** Words to speak; when absent (or speech is off) a tone plays instead. */
  say?: string;
  /** Tone frequency, Hz. */
  freq: number;
  /** Landing cue: long tone and a vibration. */
  final?: boolean;
  /** Spoken-only flavour (no tone when speech is off). */
  flavour?: boolean;
}

/** Minimum gap between spoken cues, s (anything closer would queue and drift late). */
const GAP = 0.9;

export function countdownCues(style: VoiceStyle, tof: number): Cue[] {
  if (!(tof > 0)) return [];
  const numbers: Cue[] = [
    { t: tof - 3, say: 'three', freq: 660 },
    { t: tof - 2, say: 'two', freq: 660 },
    { t: tof - 1, say: 'one', freq: 660 },
  ];
  let cues: Cue[];
  if (style === 'military') {
    const splash = Math.max(tof - 5, Math.min(1.5, tof / 2));
    cues = [{ t: 0, say: 'Shot, over', freq: 880, flavour: true }, { t: splash, say: 'Splash, over', freq: 880 }, { t: tof, freq: 1320, final: true }];
  } else if (style === 'spy') {
    cues = [{ t: 0, say: 'Package away', freq: 880, flavour: true }, ...numbers, { t: tof, say: 'Delivered', freq: 1320, final: true }];
  } else {
    cues = [...numbers, { t: tof, say: 'landing', freq: 1320, final: true }];
  }
  // Drop cues before firing or crowding the one before; the landing cue always stays.
  const kept: Cue[] = [];
  for (const c of cues) {
    if (c.t < 0) continue;
    const prev = kept[kept.length - 1];
    if (!c.final && prev && c.t - prev.t < GAP) continue;
    kept.push(c);
  }
  return kept;
}
