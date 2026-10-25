/// <reference types="vitest/config" />
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

const isTest = process.env.VITEST !== undefined;

// One cache-first runtime cache per tile source: ~2,000 entries, 30-day expiry.
// Tiles are cached only as they are viewed; never pre-fetch map tiles in bulk (OSM tile policy).
const tileCache = (name: string, urlPattern: RegExp) => ({
  urlPattern,
  handler: 'CacheFirst' as const,
  options: {
    cacheName: name,
    expiration: { maxEntries: 2000, maxAgeSeconds: 30 * 24 * 3600 },
    // Tiles load in CORS mode, so only real 200s are cached; opaque responses would each count
    // as several MB against the browser's storage quota.
    cacheableResponse: { statuses: [200] },
  },
});

export default defineConfig({
  // Set BASE_PATH=/repo-name/ when hosting under a sub-path (e.g. GitHub Pages).
  base: process.env.BASE_PATH ?? '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: isTest
    ? []
    : [
        preact(),
        VitePWA({
          registerType: 'prompt',
          injectRegister: false,
          manifest: false, // public/manifest.webmanifest is the source of truth
          includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'],
          workbox: {
            globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
            navigateFallback: 'index.html',
            runtimeCaching: [
              tileCache('osm-tiles', /^https:\/\/tile\.openstreetmap\.org\/.*/),
              tileCache('terrain-tiles', /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/.*/),
              // Environment Agency LIDAR (OGL): requests are snapped to a 0.002° grid, so a field
              // opened once is served from here offline.
              {
                urlPattern: /^https:\/\/environment\.data\.gov\.uk\/geoservices\/datasets\/.*\/wcs\?.*GetCoverage.*/,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'ea-lidar',
                  expiration: { maxEntries: 60, maxAgeSeconds: 90 * 24 * 3600 },
                  cacheableResponse: { statuses: [200] },
                },
              },
              // MapTiler allows a temporary per-user cache (Cloud terms §5.7): keep viewed tiles a week.
              // Esri imagery is deliberately absent: its terms forbid keeping tiles for offline use.
              {
                urlPattern: /^https:\/\/api\.maptiler\.com\/(maps\/satellite\/|resources\/).*/,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'maptiler-satellite',
                  expiration: { maxEntries: 1000, maxAgeSeconds: 7 * 24 * 3600 },
                  cacheableResponse: { statuses: [200] },
                },
              },
              {
                urlPattern: /^https:\/\/api\.open-meteo\.com\/.*/,
                handler: 'NetworkFirst',
                options: { cacheName: 'weather', networkTimeoutSeconds: 5, expiration: { maxEntries: 20, maxAgeSeconds: 24 * 3600 } },
              },
            ],
          },
        }),
      ],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
