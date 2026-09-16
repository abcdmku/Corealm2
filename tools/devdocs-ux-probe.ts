import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";

/*
  A usability probe for the devdocs editor, measured the way a full-time author feels it.

    npx tsx tools/devdocs-ux-probe.ts [--base http://127.0.0.1:4190] [--only creatures]

  For one record of every collection it opens the record page and reports, per page:
    - label gap: the space between a field's label text and its control (big gaps break the
      label-value pairing when scanning);
    - dead empties: an empty reference or choice that offers nothing to pick (no chip, no picker,
      or a picker with no options);
    - invisible empties: an empty control that draws no affordance at rest (no border, no
      placeholder, no chevron), so the author cannot see that it is editable;
    - tab stops before the first editable field, fields, sections and page height.
  Writes test-results/devdocs-ux/report.json and prints a summary.
*/

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] ?? fallback : fallback; };
const base = option("base", "http://127.0.0.1:4190");
const only = option("only", "");
const outDir = path.resolve("test-results/devdocs-ux");

interface Target { collection: string; route: string; id: string }

async function collectionIds(name: string, count = 1): Promise<string[]> {
  const response = await fetch(`${base}/__devdocs/collections/${name}`);
  if (!response.ok) return [];
  const body = await response.json() as { data: unknown; idKey?: string };
  const key = body.idKey ?? "id";
  const rows = Array.isArray(body.data) ? body.data : body.data && typeof body.data === "object" ? Object.values(body.data as object).flat() : [];
  return (rows as Record<string, unknown>[]).map(row => String(row[key] ?? "")).filter(Boolean).slice(0, count);
}

const ROUTES: readonly [collection: string, route: string][] = [
  ["items", "items/catalog"], ["equipmentSets", "items/sets"], ["resources", "items/resources"], ["campfireFuels", "items/fuels"],
  ["creatureDefinitions", "creatures/bestiary"], ["lootTables", "creatures/loot"],
  ["npcs", "story/npcs"], ["quests", "story/quests"], ["dialogue", "story/dialogue"], ["shops", "story/shops"],
  ["spells", "spells/spells"], ["spellRunes", "spells/runes"], ["elementalSpells", "spells/elemental"],
  ["assets", "assets/models"], ["equipmentFamilies", "tuning/families"], ["recipeTemplates", "tuning/templates"],
  ["creatureProfiles", "tuning/roles"], ["progression", "tuning/tiers"], ["materials", "tuning/materials"],
];

async function probePage(page: Page, target: Target) {
  await page.goto(`${base}/#/${target.route}/${encodeURIComponent(target.id)}`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const report = await page.evaluate(() => {
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const main = document.querySelector("main") ?? document.body;
    const fields = Array.from(main.querySelectorAll<HTMLElement>(".field, .kv-row")).filter(visible);
    const gaps: { label: string; gap: number }[] = [];
    const invisible: string[] = [];
    const dead: string[] = [];
    for (const field of fields) {
      const label = field.querySelector<HTMLElement>(":scope > .field-label, :scope > .kv-label");
      const control = field.querySelector<HTMLElement>("input, textarea, select, .ref-chip, .field-static, .kv-static, button");
      if (!label || !control || !visible(label)) continue;
      const text = label.textContent?.trim() ?? "";
      if (!text) continue;
      // Measure from the end of the label's text, not its box: a 132px column with a 4-letter label is the gap the eye crosses.
      const range = document.createRange(); range.selectNodeContents(label);
      const textRight = Math.max(...Array.from(range.getClientRects()).map(r => r.right), label.getBoundingClientRect().left);
      const controlLeft = control.getBoundingClientRect().left;
      const labelTop = label.getBoundingClientRect().top, controlTop = control.getBoundingClientRect().top;
      if (Math.abs(labelTop - controlTop) < 14) gaps.push({ label: text, gap: Math.round(controlLeft - textRight) });
      const input = field.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=checkbox]), textarea, select");
      if (input && !input.disabled && !(input as HTMLInputElement).readOnly) {
        const empty = input instanceof HTMLSelectElement ? input.value === "" : input.value === "";
        if (empty) {
          const box = input.closest<HTMLElement>(".field-input") ?? input;
          const style = getComputedStyle(box);
          const bordered = style.borderTopColor !== "rgba(0, 0, 0, 0)" && parseFloat(style.borderTopWidth) > 0;
          const filled = style.backgroundColor !== "rgba(0, 0, 0, 0)";
          const placeholder = input instanceof HTMLSelectElement ? (input.selectedOptions[0]?.textContent ?? "") : (input as HTMLInputElement).placeholder;
          const chevron = input instanceof HTMLSelectElement && style.backgroundImage !== "none";
          if (!bordered && !filled && !chevron) invisible.push(`${text} (${placeholder || "no placeholder"})`);
        }
        if (input instanceof HTMLSelectElement && input.options.length <= 1) dead.push(`${text}: select with ${input.options.length} option`);
      }
      const chip = field.querySelector<HTMLElement>(".ref-chip.is-empty");
      if (chip) {
        const disabled = (chip as HTMLButtonElement).disabled;
        const picker = field.querySelector(".ref-edit");
        if (disabled || !picker) dead.push(`${text}: empty reference with no picker`);
      }
    }
    const sections = main.querySelectorAll(".kv-section").length;
    return {
      fields: fields.length, sections, height: Math.round(main.scrollHeight),
      wideGaps: gaps.filter(entry => entry.gap > 40).sort((a, b) => b.gap - a.gap),
      medianGap: gaps.length ? gaps.map(entry => entry.gap).sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0,
      invisible, dead,
    };
  });
  // Empty references: open each picker and count its options.
  const emptyRefs = page.locator("main .ref-chip.is-empty:not([disabled])");
  const emptyCount = await emptyRefs.count();
  const noOptions: string[] = [];
  for (let index = 0; index < Math.min(emptyCount, 6); index++) {
    const chip = emptyRefs.nth(index);
    const label = await chip.evaluate(el => { const id = el.getAttribute("aria-labelledby"); return (id && document.getElementById(id)?.textContent?.trim()) || el.textContent?.trim() || "?"; });
    await chip.click().catch(() => undefined);
    await page.waitForTimeout(400);
    const options = await page.locator(".popover [role=option], .popover .picker-row, .popover li").count();
    if (options === 0) noOptions.push(label);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
  // Tab stops from the top of the page to the first editable control inside the record.
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  let tabs = 0;
  for (; tabs < 60; tabs++) {
    await page.keyboard.press("Tab");
    const inRecord = await page.evaluate(() => { const el = document.activeElement; return Boolean(el && el.closest("main .field, main .kv-row") && el.matches("input, textarea, select, .ref-chip")); });
    if (inRecord) break;
  }
  return { ...target, ...report, emptyRefsWithNoOptions: noOptions, tabsToFirstField: tabs + 1 };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" });
  // tsx names arrow functions through an `__name` helper that does not exist inside the page.
  await page.addInitScript("globalThis.__name = (target) => target;");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const results = [];
  for (const [collection, route] of ROUTES) {
    if (only && !route.includes(only) && collection !== only) continue;
    const ids = await collectionIds(collection, 1);
    for (const id of ids) {
      try { results.push(await probePage(page, { collection, route, id })); }
      catch (error) { results.push({ collection, route, id, error: String(error) }); }
    }
  }
  await writeFile(path.join(outDir, "report.json"), JSON.stringify({ results, errors }, null, 2));
  for (const result of results) {
    if ("error" in result) { console.log(`${result.route}/${result.id}: ERROR ${result.error}`); continue; }
    console.log(`${result.route}/${result.id}: ${result.fields} fields, ${result.sections} sections, ${result.height}px tall, median label gap ${result.medianGap}px, ${result.tabsToFirstField} tabs to first field`);
    if (result.wideGaps.length) console.log(`  wide gaps: ${result.wideGaps.slice(0, 5).map(g => `${g.label} ${g.gap}px`).join(", ")}`);
    if (result.invisible.length) console.log(`  invisible empties: ${result.invisible.join("; ")}`);
    if (result.dead.length) console.log(`  dead: ${result.dead.join("; ")}`);
    if (result.emptyRefsWithNoOptions.length) console.log(`  empty refs with no options: ${result.emptyRefsWithNoOptions.join(", ")}`);
  }
  if (errors.length) console.log(`page errors:\n- ${errors.join("\n- ")}`);
  await browser.close();
}

void main();
