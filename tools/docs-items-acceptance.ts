import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { ALL_ITEMS } from "../game/src/content/items.js";

const base = process.argv[2] ?? "http://127.0.0.1:4321/";
const out = path.resolve("test-results/docs-items");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
try {
  const gallery = new URL("game/items/", base).href;
  await page.goto(gallery, { waitUntil: "networkidle" });
  const tiles = page.locator("a[data-item-id]");
  if (await tiles.count() !== ALL_ITEMS.length) throw new Error("Gallery count differs from live catalog");
  const records = await tiles.evaluateAll(nodes => nodes.map(node => {
    const tile = node as HTMLAnchorElement;
    const image = tile.querySelector<HTMLImageElement>("img")!;
    return { id: tile.dataset["itemId"]!, href: tile.href, image: image.src, tooltip: tile.querySelector(".tooltip")?.textContent ?? "" };
  }));
  for (const item of ALL_ITEMS) {
    const record = records.find(row => row.id === item.id);
    if (!record || !record.tooltip.includes(item.name) || !record.tooltip.includes(item.description)) throw new Error(`Missing canonical tooltip content: ${item.id}`);
    if (!record.href.endsWith(`/game/items/${item.id}/`)) throw new Error(`Wrong item link: ${record.href}`);
  }
  const failures: string[] = [];
  for (let offset = 0; offset < records.length; offset += 20) {
    await Promise.all(records.slice(offset, offset + 20).map(async record => {
      const [detail, icon] = await Promise.all([page.request.get(record.href), page.request.get(record.image)]);
      if (!detail.ok() || !icon.ok()) failures.push(record.id);
      const html = await detail.text();
      if (!html.includes("<h1") || !html.includes(`/${record.id}.png`)) failures.push(`${record.id}: missing item page content`);
    }));
  }
  if (failures.length) throw new Error(`Broken item pages or images: ${failures.join(", ")}`);
  const observations: unknown[] = [];
  for (const id of ["basic_wooden_staff", "crafted_ring_t10", "nightglass_sword", "mind_rune"]) {
    const tile = page.locator(`[data-item-id="${id}"]`);
    await tile.hover();
    const tip = tile.locator(".tooltip");
    if (!await tip.isVisible()) throw new Error(`Missing hover: ${id}`);
    const bounds = await tip.boundingBox();
    const viewport = page.viewportSize()!;
    if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > viewport.width || bounds.y + bounds.height > viewport.height) {
      await page.screenshot({ path: path.join(out, "clipped-hover.png"), timeout: 5000 });
      throw new Error(`Clipped hover: ${id}: ${JSON.stringify(bounds)}`);
    }
    observations.push({ id, bounds, text: await tip.innerText() });
    if (id === "crafted_ring_t10") await page.screenshot({ path: path.join(out, "gallery-hover.png"), timeout: 5000 });
  }
  const ring = page.locator('[data-item-id="crafted_ring_t10"]');
  await ring.focus();
  if (!await ring.locator(".tooltip").isVisible()) throw new Error("Keyboard focus has no tooltip");
  if (await page.getByRole("link", { name: "Copper Ring", exact: true }).count() !== 1) throw new Error("Tooltip inflated the accessible link name");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/game/items/crafted_ring_t10/");
  if (await page.locator("h1").innerText() !== "Copper Ring") throw new Error("Wrong detail page");
  await page.screenshot({ path: path.join(out, "item-detail.png"), timeout: 5000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(gallery, { waitUntil: "networkidle" });
  await page.locator('[data-item-id="basic_wooden_staff"]').focus();
  const mobileBounds = await page.locator('[data-item-id="basic_wooden_staff"] .tooltip').boundingBox();
  if (!mobileBounds || mobileBounds.x < 0 || mobileBounds.x + mobileBounds.width > 390) throw new Error("Mobile tooltip overflows");
  await page.screenshot({ path: path.join(out, "mobile-gallery.png"), timeout: 5000 });
  if (errors.length) throw new Error(errors.join("\n"));
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, itemCount: records.length, pageAndIconRequests: records.length * 2, observations, mobileBounds, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, items: records.length, pagesAndIcons: records.length * 2 }));
} finally { await browser.close(); }
