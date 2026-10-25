/** Small form controls sized for gloved thumbs (≥ 48 px targets). */

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  /** Display scale, e.g. 1000 to edit metres as millimetres. */
  scale?: number;
  digits?: number;
  /** Allow an empty value (reported as NaN). */
  optional?: boolean;
}

export function NumberField({ label, value, onChange, unit, step = 0.1, min, max, scale = 1, digits, optional }: NumberFieldProps) {
  const shown = (v: number) => (!Number.isFinite(v) ? '' : digits === undefined ? String(+(v * scale).toPrecision(6)) : (v * scale).toFixed(digits));
  const [text, setText] = useState(shown(value));
  useEffect(() => setText(shown(value)), [value]);
  const commit = () => {
    const v = parseFloat(text.replace(',', '.'));
    if (optional && text.trim() === '') {
      if (Number.isFinite(value)) onChange(NaN);
      return;
    }
    if (!Number.isFinite(v)) return setText(shown(value));
    let x = v / scale;
    if (min !== undefined) x = Math.max(min, x);
    if (max !== undefined) x = Math.min(max, x);
    setText(shown(x));
    if (x !== value) onChange(x);
  };
  return (
    <label class="field">
      <span class="field-label">{label}</span>
      <span class="field-input">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          step={step}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {unit && <span class="unit">{unit}</span>}
      </span>
    </label>
  );
}

export function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label class="field">
      <span class="field-label">{label}</span>
      <span class="field-input">
        <input type="text" value={value} onChange={(e) => onChange((e.target as HTMLInputElement).value)} />
      </span>
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label class="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>
        {label}
        {hint && <small class="muted"> {hint}</small>}
      </span>
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label class="field">
      <span class="field-label">{label}</span>
      <span class="field-input">
        <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <section class="card">
      {(title || actions) && (
        <header class="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div class="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
