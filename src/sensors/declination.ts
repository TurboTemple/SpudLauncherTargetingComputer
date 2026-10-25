/**
 * Magnetic declination from the World Magnetic Model (geomagnetism ships WMM2025, valid
 * 2024-11-13 to 2029-11-13). Loaded lazily to keep it out of the first paint.
 */

type GeoMod = { model: (date?: Date, opts?: { allowOutOfBoundsModel: boolean }) => { point: (p: number[]) => { decl: number } } };

let mod: Promise<GeoMod> | null = null;

/** Declination in degrees (east positive): true bearing = magnetic bearing + declination. */
export async function declinationDeg(latDeg: number, lonDeg: number, date = new Date()): Promise<number | null> {
  try {
    mod ??= import('geomagnetism').then((m) => ((m as unknown as { default?: GeoMod }).default ?? (m as unknown as GeoMod)));
    const g = await mod;
    return g.model(date, { allowOutOfBoundsModel: true }).point([latDeg, lonDeg]).decl;
  } catch {
    return null;
  }
}
