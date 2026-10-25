// Render public/icon.svg to the PNG sizes the manifest needs, using the bundled Chromium.
// Playwright is not a project dependency; it is resolved from the machine (require works globally there).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), await page.screenshot({ omitBackground: true }));
}
await browser.close();
console.log('icons written');
