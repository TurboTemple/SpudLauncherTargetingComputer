import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/data/defaults';
import { satelliteLayer, SECRET_SETTINGS } from '../src/data/satellite';

describe('satellite providers', () => {
  it('is off by default and until a key is entered', () => {
    expect(satelliteLayer(DEFAULT_SETTINGS)).toBeNull();
    expect(satelliteLayer({ ...DEFAULT_SETTINGS, satelliteProvider: 'maptiler' })).toBeNull();
    expect(satelliteLayer({ ...DEFAULT_SETTINGS, satelliteProvider: 'esri', esriKey: '  ' })).toBeNull();
  });

  it('builds the MapTiler tile URL with the key, attribution and required logo', () => {
    const l = satelliteLayer({ ...DEFAULT_SETTINGS, satelliteProvider: 'maptiler', maptilerKey: ' abc+1 ' })!;
    expect(l.url).toBe('https://api.maptiler.com/maps/satellite/256/{z}/{x}/{y}{r}.jpg?key=abc%2B1');
    expect(l.attribution).toContain('MapTiler');
    expect(l.attribution).toContain('OpenStreetMap');
    expect(l.logo?.src).toBe('https://api.maptiler.com/resources/logo.svg');
  });

  it('builds the Esri URL (row before column) with Powered by Esri', () => {
    const l = satelliteLayer({ ...DEFAULT_SETTINGS, satelliteProvider: 'esri', esriKey: 'KEY' })!;
    expect(l.url).toBe('https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=KEY');
    expect(l.attribution).toMatch(/^Powered by .*Esri/);
    expect(l.logo).toBeUndefined();
  });

  it('uses a custom URL and attribution as given', () => {
    const l = satelliteLayer({ ...DEFAULT_SETTINGS, satelliteProvider: 'custom', satelliteUrl: 'https://x/{z}/{x}/{y}.png', satelliteAttribution: 'X' })!;
    expect(l).toMatchObject({ url: 'https://x/{z}/{x}/{y}.png', attribution: 'X' });
  });

  it('marks both keys as secret', () => {
    expect([...SECRET_SETTINGS].sort()).toEqual(['esriKey', 'maptilerKey']);
  });
});
