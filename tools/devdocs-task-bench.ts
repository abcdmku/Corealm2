import { chromium, type Page } from "playwright";

/*
  Repetitive-task benchmark for the devdocs editor: does the thing an author does a thousand times
  a day and counts what it cost. Nothing is saved; the checks read the draft store.

    npx tsx tools/devdocs-task-bench.ts [--base http://127.0.0.1:4190]

  Task A  "Set max hit on the next five creatures of a filtered list": filter the bestiary, open the
          first result, then per record type a value and press Alt+Down. Checks that each record
          got its value and that the caret stayed on Max hit.
  Task B  Keyboard reach: Tab presses from a freshly opened record to its first field.
  Task C  Leave and come back: the list's filter is still applied after opening a record.
*/

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1]! : "http://127.0.0.1:4190";

interface Cost { keys: number; clicks: number; ms: number }
const cost: Cost = { keys: 0, clicks: 0, ms: 0 };
const press = async (page: Page, key: string) => { cost.keys++; await page.keyboard.press(key); };
const type = async (page: Page, text: string) => { cost.keys += text.length; await page.keyboard.type(text); };

async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return "";
    const labelled = el.getAttribute("aria-labelledby");
    return (labelled && document.getElementById(labelled)?.textContent?.trim()) || el.getAttribute("aria-label") || el.tagName;
  });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript("globalThis.__name = (target) => target;");
  const failures: string[] = [];

  // ---- Task A
  await page.goto(`${base}/#/creatures/bestiary`);
  await page.waitForSelector("input[aria-label='Search creatures']");
  const started = Date.now();
  await page.locator("input[aria-label='Search creatures']").click(); cost.clicks++;
  await page.keyboard.press("Control+A");
  await type(page, "frog");
  await page.waitForTimeout(300);
  const first = page.locator(".bestiary .tile").first();
  await first.click(); cost.clicks++;
  await page.waitForSelector(".record-layout-main .field");
  const maxHit = page.locator(".record-layout-main .field").filter({ has: page.locator(".field-label", { hasText: /^Max hit$/ }) }).locator("input").first();
  await maxHit.waitFor();
  await maxHit.click(); cost.clicks++;
  const visited: string[] = [];
  const stepTimes: number[] = [];
  for (let step = 0; step < 5; step++) {
    const id = await page.locator(".record-layout-main").getAttribute("data-record-id");
    visited.push(id ?? "?");
    const name = await focusedName(page);
    if (name !== "Max hit") failures.push(`record ${step + 1} (${id}): focus was on "${name}", not Max hit`);
    await type(page, String(40 + step));
    const moved = Date.now();
    await press(page, "Alt+ArrowDown");
    await page.waitForFunction(previous => document.querySelector(".record-layout-main")?.getAttribute("data-record-id") !== previous, id);
    await page.waitForFunction(() => { const el = document.activeElement; const labelled = el?.getAttribute("aria-labelledby"); return Boolean(labelled && document.getElementById(labelled)?.textContent?.trim() === "Max hit"); }, undefined, { timeout: 4000, polling: 16 }).catch(() => undefined);
    stepTimes.push(Date.now() - moved);
  }
  cost.ms = Date.now() - started;
  const drafts = await page.evaluate(() => {
    const bar = document.querySelector(".shell-savebar-count")?.textContent ?? "";
    return bar;
  });
  console.log(`Task A: ${visited.length} records (${visited.join(", ")}) in ${cost.keys} keys, ${cost.clicks} clicks, ${cost.ms} ms. Save bar: "${drafts}". Next record ready in ${stepTimes.join(", ")} ms`);
  if (!/5 records changed/.test(drafts)) failures.push(`expected 5 records changed, save bar says "${drafts}"`);

  // Values landed on the records they were typed into: walk back and read them.
  for (let step = 4; step >= 0; step--) {
    await page.keyboard.press("Alt+ArrowUp");
    await page.waitForFunction(expected => document.querySelector(".record-layout-main")?.getAttribute("data-record-id") === expected, visited[step]);
    await page.waitForTimeout(250);
    const value = await page.locator(".record-layout-main .field").filter({ has: page.locator(".field-label", { hasText: /^Max hit$/ }) }).locator("input").first().inputValue();
    if (value !== String(40 + step)) failures.push(`${visited[step]} has max hit ${value}, expected ${40 + step}`);
  }

  // ---- Task B
  await page.goto(`${base}/#/npcs/npcs/npc_fey_lantern_keeper`);
  await page.waitForSelector(".record-layout-main .field input");
  await page.locator(".record-nav-item[aria-current='true']").focus();
  let tabs = 0;
  for (; tabs < 40; tabs++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => Boolean(document.activeElement?.closest(".record-layout-main .field")))) break;
  }
  console.log(`Task B: ${tabs + 1} Tab presses from the record list to the first field`);
  if (tabs + 1 > 6) failures.push(`Tab took ${tabs + 1} presses to reach the record`);

  // ---- Task C
  await page.goto(`${base}/#/creatures/bestiary`);
  const kept = await page.locator("input[aria-label='Search creatures']").inputValue();
  console.log(`Task C: bestiary search after coming back is "${kept}"`);
  if (kept !== "frog") failures.push(`list filter was lost (search is "${kept}")`);

  await browser.close();
  if (failures.length) { console.log(`FAIL\n- ${failures.join("\n- ")}`); process.exit(1); }
  console.log("PASS");
}

void main();
