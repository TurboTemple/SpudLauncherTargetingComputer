/** Setup › Skin: pick the look from live previews, plus light or dark and the map tint. */

import { updateSettings } from '../state/actions';
import { settings } from '../state/store';
import { Card, Select, Toggle } from './fields';
import { SKINS } from './skins';

export function SkinCard() {
  const s = settings.value;
  const current = SKINS.find((k) => k.id === s.skin) ?? SKINS[0]!;
  return (
    <Card title="Skin">
      <div class="skin-grid" role="radiogroup" aria-label="Skin">
        {SKINS.map((k) => (
          <button key={k.id} class="skin-pick" role="radio" aria-checked={k.id === s.skin} onClick={() => updateSettings({ skin: k.id })}>
            {/* Rendered in the skin itself: the tokens follow data-skin. */}
            <span class="skin-tile" data-skin={k.id} aria-hidden="true">
              {k.tag && <span class="skin-tile-tag">{k.tag}</span>}
              <span class="skin-tile-readout">
                <span class="skin-tile-label">Range</span>
                <span class="skin-tile-value">
                  112<small>m</small>
                </span>
              </span>
              <span class="skin-tile-btn">Lock</span>
            </span>
            <span class="skin-name">
              {k.name}
              {k.id === s.skin && ' ✓'}
            </span>
          </button>
        ))}
      </div>
      <p class="small">{current.blurb}</p>
      <Select
        label="Light or dark"
        value={s.theme}
        options={[
          { value: 'light', label: 'Light (day)' },
          { value: 'dark', label: 'Dark (night)' },
        ]}
        onChange={(v) => updateSettings({ theme: v })}
      />
      <Toggle
        label="Tint the map to match"
        checked={s.tintMap}
        onChange={(v) => updateSettings({ tintMap: v })}
        hint="(turn off for natural colours, for example when marking impacts on satellite imagery)"
      />
    </Card>
  );
}
