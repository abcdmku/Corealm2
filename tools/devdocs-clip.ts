import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

/*
  Screenshot one element of a devdocs route at 2x, for checking alignment up close.
    npx tsx tools/devdocs-clip.ts creatures/bestiary/goat_t1 "section:has(h2:text('Loot'))" --base http://127.0.0.1:4192
  Options: --width 1440 --light --click "text=Ladder" --out name
*/

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] ?? fallback : fallback; };
const positional = args.filter((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1]!.startsWith("--") && args[index - 1] !== "--light"));
const [route = "", selector = "body"] = positional;
const base = option("base", "http://127.0.0.1:4190");
const light = args.includes("--light");

async function main() {
  const outDir = path.resolve("test-results/devdocs-shots");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: Number(option("width", "1440")), height: 1000 }, deviceScaleFactor: 2, colorScheme: light ? "light" : "dark" });
  await page.addInitScript("globalThis.__name = (t) => t;");
  await page.goto(`${base}/#/${route}`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const click = option("click", "");
  if (click) { await page.locator(click).first().click(); await page.waitForTimeout(600); }
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const file = path.join(outDir, `clip-${option("out", route.replace(/[^a-z0-9]+/gi, "-"))}.png`);
  await target.screenshot({ path: file });
  console.log(file);
  await browser.close();
}

void main();
