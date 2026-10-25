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
    cacheableResponse: { statuses: [0, 200] },
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
