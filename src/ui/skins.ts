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
}

export const SKINS: readonly Skin[] = [
  { id: 'plain', name: 'Plain', blurb: 'High contrast and simple.', tag: null, voice: 'plain', mils: false },
  {
    id: 'military',
    name: 'Modern military',
    blurb: 'Light: sand and olive drab. Dark: night olive. Angles in mils too; the countdown calls "Shot" and "Splash".',
    tag: 'Unclassified',
    voice: 'military',
    mils: true,
  },
  {
    id: 'spy',
    name: 'Spy',
    blurb: 'Light: a classified dossier. Dark: an agency display.',
    tag: 'Top secret // eyes only',
    voice: 'spy',
    mils: false,
  },
  {
    id: 'retro',
    name: '1980s military',
    blurb: 'Light: an LCD handset. Dark: a green-screen terminal. Angles in mils too.',
    tag: 'NATO restricted',
    voice: 'military',
    mils: true,
  },
];

export function skinById(id: SkinId): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0]!;
}

/** Degrees → NATO mils (6400 to a full circle). */
export const toMils = (deg: number): number => (deg * 6400) / 360;
