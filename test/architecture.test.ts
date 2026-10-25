import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CORE = fileURLToPath(new URL('../src/core', import.meta.url));
const BROWSER_GLOBALS = /\b(window|document|navigator|localStorage|indexedDB|self|fetch|DeviceOrientationEvent)\b\s*[.(]/;

describe('core/ stays pure', () => {
  for (const f of readdirSync(CORE).filter((n) => n.endsWith('.ts'))) {
    it(`${f} imports only from core/ and uses no browser globals`, () => {
      const src = readFileSync(join(CORE, f), 'utf8');
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) expect(m[1]).toMatch(/^\.\/[\w-]+$/);
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(BROWSER_GLOBALS);
    });
  }
});
