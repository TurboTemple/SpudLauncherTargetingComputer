/**
 * Skins: the look of the app. Colours, fonts and decorations live in skins.css, keyed on
 * data-skin and data-theme on <html>; this file holds what the code needs to know.
 */

import type { SkinId } from '../data/model';

export type VoiceStyle = 'plain' | 'military' | 'spy';

export interface Skin {
  id: SkinId;
  name: string;
  /** One line for the picker: what the day and night versions look like. */
  blurb: string;
  /** Classification strip across the top of the map (null: none). */
  tag: string | null;
  /** Countdown wording. */
  voice: VoiceStyle;
  /** Show angles in NATO mils (6400 to a circle) as well as degrees. */
  mils: boolean;
  /** Words flashed over the map on lock, firing and landing, and the map's status line. */
  fx: { lock: string; fire: string; land: string; status: string } | null;
}

export const SKINS: readonly Skin[] = [
  { id: 'plain', name: 'Plain', blurb: 'High contrast and simple.', tag: null, voice: 'plain', mils: false, fx: null },
  {
    id: 'military',
    name: 'Modern military',
    blurb: 'Light: sand and olive drab. Dark: night olive. Angles in mils too; the countdown calls "Shot" and "Splash".',
    tag: 'Unclassified',
    voice: 'military',
    mils: true,
    fx: { lock: 'Target locked', fire: 'Shot out', land: 'Splash', status: 'Live' },
  },
  {
    id: 'spy',
    name: 'Spy',
    blurb: 'Movie spy-gadget tech. Light: frosted glass and blue light. Dark: a glowing holographic display.',
    tag: 'Top secret // eyes only',
    voice: 'spy',
    mils: false,
    fx: { lock: 'Lock acquired', fire: 'Package away', land: 'Delivered', status: 'Uplink' },
  },
  {
    id: 'retro',
    name: '1980s military',
    blurb: 'Light: an LCD handset. Dark: a green-screen terminal. Angles in mils too.',
    tag: 'NATO restricted',
    voice: 'military',
    mils: true,
    fx: { lock: 'Target locked', fire: 'Round away', land: 'Impact', status: 'Radar active' },
  },
];

export function skinById(id: SkinId): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0]!;
}

/** Degrees → NATO mils (6400 to a full circle). */
export const toMils = (deg: number): number => (deg * 6400) / 360;
