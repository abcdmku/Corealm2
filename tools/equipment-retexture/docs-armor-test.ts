import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:4321';
const out = path.resolve('test-results/docs-worn-armor-ornate');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', e => errors.push(String(e)));
try {
  await page.goto(`${base}/game/armor/`, { waitUntil: 'networkidle' });
  const figures = page.locator('.corealm-armour-views figure');
  const readyImages = async () => figures.locator('img').evaluateAll(async nodes => {
    await Promise.all(nodes.map(async node => {
      const image = node as HTMLImageElement;
      image.loading = 'eager';
      await image.decode();
      if (!image.naturalWidth) throw new Error(`Image did not decode: ${image.src}`);
    }));
  });
  assert.equal(await figures.count(), 21);
  const images = await figures.locator('img').evaluateAll(nodes => nodes.map(node => {
    const image = node as HTMLImageElement;
    return { src: image.src, href: image.closest('a')!.href, alt: image.alt };
  }));
  for (const row of images) {
    assert(row.src.includes('/armor-ornate/'));
    assert.equal(row.src, row.href);
    const response = await page.request.get(row.src);
    assert(response.ok(), `Missing capture ${row.src}`);
  }
  await figures.first().scrollIntoViewIfNeeded();
  await readyImages();
  await page.screenshot({ path: path.join(out, 'desktop.png') });
  await figures.first().locator('a').click();
  assert(page.url().endsWith('/armor-ornate/grithe-front.png'));
  await page.goBack();
  await readyImages();
  const last = page.locator('.corealm-armour-views').last();
  await last.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'nightmarshal.png') });
  const links = await page.locator('main a[href*="/items/"]').evaluateAll(nodes => nodes.map(n => (n as HTMLAnchorElement).href));
  assert(links.length >= 35);
  for (const href of new Set(links)) assert((await page.request.get(href)).ok(), `Missing item ${href}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await figures.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'mobile.png') });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile overflow');
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ passed: true, images, itemLinks: links.length, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, captures: images.length, itemLinks: links.length }));
} finally { await browser.close(); }
