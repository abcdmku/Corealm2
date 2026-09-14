import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

/*
  Screenshot devdocs routes against the running dev server (npm run devdocs on 4190).
    npx tsx tools/devdocs-shot.ts items/ladder world/map/placements:redsill_frogs
  Routes are given without the leading "#/" so Git Bash does not rewrite them as paths.
  Writes test-results/devdocs-shots/<slug>.png and prints console errors per route.
  Options: --width 1600 --height 1000 --base http://127.0.0.1:4190 --wait 1500 --click "text=Ladder"
*/

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] ?? fallback : fallback; };
const routes = args.filter((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1]!.startsWith("--")));
const base = option("base", "http://127.0.0.1:4190");
const width = Number(option("width", "1600"));
const height = Number(option("height", "1000"));
const wait = Number(option("wait", "1500"));
const click = option("click", "");
const outDir = path.resolve("test-results/devdocs-shots");

async function main() {
  if (!routes.length) { console.error("Give at least one route, e.g. items/ladder"); process.exit(2); }
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  for (const route of routes) {
    errors.length = 0;
    const hash = route.replace(/^#?\/?/, "").replace(/^home$/, "");
    await page.goto(`${base}/#/${hash}`, { waitUntil: "load" });
    await page.waitForTimeout(wait);
    if (click) { await page.locator(click).first().click(); await page.waitForTimeout(600); }
    const slug = hash.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
    const file = path.join(outDir, `${slug}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`${route} -> ${path.relative(process.cwd(), file)}${errors.length ? `\n  console errors:\n  - ${errors.join("\n  - ")}` : ""}`);
  }
  await browser.close();
}

main().catch(error => { console.error(error); process.exit(1); });
