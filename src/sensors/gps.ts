/** Geolocation adapter and fix averaging. GPS altitude is ignored (terrain gives heights). */

export interface Fix {
  t: number; // seconds
  lat: number; // degrees
  lon: number;
  accuracy: number; // metres (1σ-ish radius as reported)
}

export function gpsSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

export function watchGps(onFix: (f: Fix) => void, onError: (msg: string, code?: number) => void): () => void {
  if (!gpsSupported()) {
    onError('Location is not available on this device');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onFix({ t: performance.now() / 1000, lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
    (e) => onError(e.message || 'Location error', e.code),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

export interface AverageResult {
  done: boolean;
  lat: number;
  lon: number;
  accuracy: number;
  count: number;
  /** Seconds of qualifying fixes collected so far. */
  span: number;
}

/**
 * Averages fixes over a duration once they are accurate enough. The mean is weighted by
 * 1/accuracy²; the reported accuracy is the median of the fixes used, since GPS errors are
 * strongly correlated over a few seconds and averaging does not shrink them much.
 */
export class FixAverager {
  private fixes: Fix[] = [];
  constructor(
    readonly durationS: number,
    readonly maxAccuracyM: number,
  ) {}

  push(f: Fix): AverageResult {
    if (f.accuracy <= this.maxAccuracyM) this.fixes.push(f);
    return this.result();
  }

  result(): AverageResult {
    const n = this.fixes.length;
    if (n === 0) return { done: false, lat: NaN, lon: NaN, accuracy: NaN, count: 0, span: 0 };
    let w = 0;
    let lat = 0;
    let lon = 0;
    for (const f of this.fixes) {
      const wi = 1 / Math.max(f.accuracy, 0.5) ** 2;
      w += wi;
      lat += wi * f.lat;
      lon += wi * f.lon;
    }
    const acc = this.fixes.map((f) => f.accuracy).sort((a, b) => a - b)[Math.floor(n / 2)]!;
    const span = this.fixes[n - 1]!.t - this.fixes[0]!.t;
    return { done: span >= this.durationS, lat: lat / w, lon: lon / w, accuracy: acc, count: n, span };
  }
}
