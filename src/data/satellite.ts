/**
 * Satellite imagery for marking where shots landed. No provider offers imagery sharp enough
 * for that without an account, so each preset uses the user's own key. Terms as checked on
 * 2026-10-25 (see README):
 *
 * - MapTiler: free plan for non-commercial use, 100k requests/month, no card; service pauses
 *   when the quota runs out. Logo required on free plans. Results may be kept in a temporary
 *   personal cache for a single end user (Cloud terms §5.7), so tiles are cached on the phone.
 * - Esri World Imagery: needs an ArcGIS Location Platform API key; 2M basemap tiles/month free,
 *   then billed. "Powered by Esri" plus data credits required. Esri's terms forbid harvesting
 *   tiles for offline use, so these are never put in the offline cache.
 */

export type SatelliteProviderId = 'none' | 'maptiler' | 'esri' | 'custom';

export interface SatelliteProvider {
  name: string;
  url: (key: string) => string;
  attribution: string;
  maxNativeZoom: number;
  /** Logo the provider requires on the map. */
  logo?: { href: string; src: string; alt: string };
  keyLabel: string;
  signupUrl: string;
  termsUrl: string;
  /** The terms that matter for this app, in plain words. */
  terms: string;
}

export const SATELLITE_PROVIDERS: Record<'maptiler' | 'esri', SatelliteProvider> = {
  maptiler: {
    name: 'MapTiler Satellite',
    url: (key) => `https://api.maptiler.com/maps/satellite/256/{z}/{x}/{y}{r}.jpg?key=${encodeURIComponent(key)}`,
    attribution:
      '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>',
    maxNativeZoom: 19,
    logo: { href: 'https://www.maptiler.com', src: 'https://api.maptiler.com/resources/logo.svg', alt: 'MapTiler logo' },
    keyLabel: 'MapTiler API key',
    signupUrl: 'https://cloud.maptiler.com/account/keys/',
    termsUrl: 'https://www.maptiler.com/terms/cloud/',
    terms:
      'Free plan: non-commercial use only, 100,000 requests a month, no card needed; if you run out, the service pauses until next month rather than billing you. The MapTiler logo must show on the map. Tiles may only be kept in this phone’s own cache, so viewed tiles are kept here for 7 days for use at the field without signal.',
  },
  esri: {
    name: 'Esri World Imagery',
    url: (key) => `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(key)}`,
    attribution:
      'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    maxNativeZoom: 19,
    keyLabel: 'ArcGIS API key',
    signupUrl: 'https://location.arcgis.com/',
    termsUrl: 'https://www.esri.com/content/dam/arcgisonline/docs/tou_summary.pdf',
    terms:
      'Needs an ArcGIS Location Platform account and an API key with basemap access. 2 million tiles a month are free, then $0.15 per 1,000 (check location.arcgis.com/pricing). Esri’s terms forbid saving tiles for offline use, so this layer needs signal at the field.',
  },
};

export interface SatelliteLayerConfig {
  url: string;
  attribution: string;
  maxNativeZoom: number;
  logo?: SatelliteProvider['logo'];
}

export interface SatelliteSettings {
  satelliteProvider: SatelliteProviderId;
  maptilerKey: string;
  esriKey: string;
  satelliteUrl: string;
  satelliteAttribution: string;
}

/** The layer to show, or null when satellite is off or not yet configured. */
export function satelliteLayer(s: SatelliteSettings): SatelliteLayerConfig | null {
  switch (s.satelliteProvider) {
    case 'maptiler':
    case 'esri': {
      const key = (s.satelliteProvider === 'maptiler' ? s.maptilerKey : s.esriKey).trim();
      if (!key) return null;
      const p = SATELLITE_PROVIDERS[s.satelliteProvider];
      return { url: p.url(key), attribution: p.attribution, maxNativeZoom: p.maxNativeZoom, ...(p.logo ? { logo: p.logo } : {}) };
    }
    case 'custom':
      return s.satelliteUrl.trim()
        ? { url: s.satelliteUrl.trim(), attribution: s.satelliteAttribution.trim() || 'Satellite imagery', maxNativeZoom: 19 }
        : null;
    default:
      return null;
  }
}

/** Settings that must never leave the phone in an export. */
export const SECRET_SETTINGS = ['maptilerKey', 'esriKey'] as const;
