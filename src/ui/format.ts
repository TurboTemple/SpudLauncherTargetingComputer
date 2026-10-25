/** Display formatting (degrees and metres at the UI edge). */

export const fmt = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits));

export const fmtDeg = (v: number | null | undefined, digits = 1): string => `${fmt(v, digits)}°`;

export const fmtM = (v: number | null | undefined, digits = 1): string => `${fmt(v, digits)} m`;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassPoint = (deg: number): string => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;

export function ago(iso: string | undefined): string {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
