import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { WORKSPACES } from "../devdocs/src/ui/workspaces.js";

/*
  Walk every devdocs surface and measure layout faults a screenshot pass misses:
    npx tsx tools/devdocs-surface-audit.ts --base http://127.0.0.1:4192 [--width 1440] [--samples 2] [--only quests] [--shots]

  For each workspace view it opens the list, then sample records (the first one and the richest
  one), expands every collapsed row in the page, and reports:
    overflow  an element wider than its box that is not a scroller
    squeezed  a control narrower than it can be used at
    wrapped   something meant to be one line (label, chip, button, badge, heading) breaking onto two
    column    text squeezed into a column so narrow it runs three or more lines
    overlap   two controls in one row drawn on top of each other
    rowwrap   a row of controls breaking onto a second line
    clipped   a text box hiding part of its text
    precision a number printed with all its float digits
  Writes test-results/devdocs-audit/report.json and a screenshot for every surface with faults.
  --controls also writes controls.json: every select (its field, options and value) and every
  reference kind on each surface, for finding choices that should be segments or icon pickers.
*/

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] ?? fallback : fallback; };
const base = option("base", "http://127.0.0.1:4190");
const width = Number(option("width", "1440"));
const samples = Number(option("samples", "2"));
const only = option("only", "");
const outDir = path.resolve("test-results/devdocs-audit", String(width));

interface Surface { route: string; click?: string }
interface Fault { kind: string; where: string; detail: string }

async function surfaces(): Promise<Surface[]> {
  const out: Surface[] = [];
  for (const workspace of WORKSPACES) {
    if (only && workspace.key !== only) continue;
    for (const view of workspace.views) {
      const route = `${workspace.key}/${view.key}`;
      out.push({ route });
      if (!view.collection) continue;
      try {
        const response = await fetch(`${base}/__devdocs/collections/${encodeURIComponent(view.collection)}`);
        if (!response.ok) continue;
        const body = await response.json() as { data?: unknown; collection?: { idKey?: string } };
        const idKey = body.collection?.idKey ?? "id";
        const rows: Record<string, unknown>[] = Array.isArray(body.data)
          ? body.data as Record<string, unknown>[]
          : body.data && typeof body.data === "object" ? Object.entries(body.data as Record<string, unknown>).map(([key, value]) => ({ ...(value as Record<string, unknown>), [idKey]: (value as Record<string, unknown>)?.[idKey] ?? key })) : [];
        const ids = rows.map(row => String(row[idKey] ?? row.id ?? "")).filter(Boolean);
        const richest = [...rows].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length).map(row => String(row[idKey] ?? row.id ?? ""));
        for (const id of [...new Set([ids[0], ...richest.slice(0, Math.max(0, samples - 1))])].filter(Boolean)) out.push({ route: `${route}/${encodeURIComponent(id!)}` });
      } catch { /* a view whose collection does not load is audited as a list only */ }
    }
  }
  // Drawers and the peek: a record opened in the side sheet is the narrowest layout there is.
  const extra: (Surface & { workspace: string })[] = [
    { workspace: "creatures", route: "creatures/bestiary/frog_t1", click: "text=/parameters/" },
    { workspace: "creatures", route: "creatures/bestiary/frog_t1", click: "peek" },
    { workspace: "items", route: "items/ladder", click: "thead button >> nth=1" },
    { workspace: "items", route: "items/recipes/smith_grithe_helm", click: "text=/ curve$/" },
    { workspace: "items", route: "items/recipes/smith_grithe_helm", click: "peek" },
    { workspace: "quests", route: "quests/quests/cold_iron", click: "peek" },
    { workspace: "npcs", route: "npcs/npcs/npc_warden_ilse", click: "peek" },
    { workspace: "world", route: "world/map/placements:redsill_frogs" },
  ];
  for (const surface of extra) if (!only || only === surface.workspace) out.push({ route: surface.route, click: surface.click });
  return out;
}

async function expandAll(page: Page): Promise<number> {
  let clicked = 0;
  for (let pass = 0; pass < 4; pass++) {
    const buttons = page.locator("main [aria-expanded='false']:not([aria-haspopup]):not([role=combobox]):visible, [role=dialog] [aria-expanded='false']:not([aria-haspopup]):not([role=combobox]):visible");
    const count = Math.min(await buttons.count(), 80);
    if (!count) break;
    for (let index = count - 1; index >= 0; index--) {
      const button = buttons.nth(index);
      try { await button.click({ timeout: 800 }); clicked++; } catch { /* moved or detached */ }
    }
    await page.waitForTimeout(250);
  }
  return clicked;
}

interface ControlEntry { route: string; field: string; options: string[]; value: string; kind: string }

function inventory(): Omit<ControlEntry, "route">[] {
  const root = document.querySelector("#main-content") ?? document.body;
  const scopes = [root, ...Array.from(document.querySelectorAll("[role=dialog]"))];
  const fieldOf = (element: Element): string => element.getAttribute("aria-label")
    ?? element.closest(".field")?.querySelector(".field-label")?.textContent
    ?? element.closest("[data-slot=row]")?.querySelector(".kv-label")?.textContent ?? "";
  const out: Omit<ControlEntry, "route">[] = [];
  for (const scope of scopes) {
    for (const select of Array.from(scope.querySelectorAll("select"))) {
      const options = Array.from(select.options).filter(option => option.value !== "").map(option => option.textContent ?? "");
      out.push({ kind: "select", field: fieldOf(select), options, value: select.value });
    }
    for (const control of Array.from(scope.querySelectorAll(".ref-control"))) {
      out.push({ kind: `ref:${control.getAttribute("data-kind") ?? "?"}`, field: fieldOf(control), options: [], value: control.textContent ?? "" });
    }
  }
  return out;
}

function measure(): Fault[] {
  const faults: Fault[] = [];
  const describe = (element: Element): string => {
    const parts: string[] = [];
    let node: Element | null = element;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const label = node.getAttribute("aria-label") ?? node.getAttribute("data-slot") ?? (node.classList.contains("field") ? `field(${node.querySelector(".field-label")?.textContent ?? ""})` : "");
      parts.unshift(`${node.tagName.toLowerCase()}${label ? `[${label}]` : ""}`);
    }
    const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${parts.join(" > ")}${text ? ` "${text}"` : ""}`;
  };
  const visible = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.opacity !== "0" && !element.closest("[aria-hidden=true], .sr-only");
  };
  const root = document.querySelector("#main-content") ?? document.body;
  const scopes = [root, ...Array.from(document.querySelectorAll("[role=dialog]"))];
  const all = scopes.flatMap(scope => Array.from(scope.querySelectorAll("*")));

  for (const element of all) {
    if (!visible(element) || element.closest("svg, canvas")) continue;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    // overflow
    const scroller = /(auto|scroll|hidden|clip)/.test(style.overflowX);
    if (!scroller && element.scrollWidth > element.clientWidth + 2 && element.clientWidth > 0 && !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) && style.display !== "inline")
      faults.push({ kind: "overflow", where: describe(element), detail: `${element.scrollWidth} > ${element.clientWidth}` });
    // squeezed controls
    // A count inside a stack ("× 2") is sized to its digits; anything else under 44px cannot show a value.
    const floor = element.closest("[data-slot=stack-field], [data-slot=count-grid]") ? 20 : 44;
    if (element.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select, .ref-chip") && (element.closest("[data-slot=input-group]") ?? element).getBoundingClientRect().width < floor)
      faults.push({ kind: "squeezed", where: describe(element), detail: `${Math.round((element.closest("[data-slot=input-group]") ?? element).getBoundingClientRect().width)}px wide` });
    if (element.matches("input[type=text], input:not([type])") && (element as HTMLInputElement).value && element.scrollWidth > element.clientWidth + 1)
      faults.push({ kind: "clipped", where: describe(element), detail: `"${(element as HTMLInputElement).value.slice(0, 24)}" needs ${element.scrollWidth}px of ${element.clientWidth}px` });
    if (element.matches("textarea") && box.width < 200)
      faults.push({ kind: "squeezed", where: describe(element), detail: `textarea ${Math.round(box.width)}px wide` });
  }
  // Text that breaks where it should not. A short run (a label, a name, a chip, a badge, a count) on
  // two lines is always a fault; longer text is a fault when it is squeezed into a narrow column.
  const range = document.createRange();
  for (const scope of scopes) for (let walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT), node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").trim();
    const parent = node.parentElement;
    if (text.length < 2 || !parent || !visible(parent) || parent.closest("svg, textarea, pre, [role=tooltip]")) continue;
    range.selectNodeContents(node);
    const tops = new Set(Array.from(range.getClientRects()).filter(rect => rect.width > 0).map(rect => Math.round(rect.top)));
    const container = parent.getBoundingClientRect();
    // 21.19872040953759 is float noise; 0.000001 is a deliberate small value.
    const fraction = text.match(/\d\.(\d{5,})/)?.[1];
    if (fraction && fraction.replace(/0/g, "").length >= 4 && !parent.closest("code, [data-slot=json]")) faults.push({ kind: "precision", where: describe(parent), detail: `"${text.slice(0, 40)}" prints raw float digits` });
    if (text.length <= 40 && tops.size > 1) faults.push({ kind: "wrapped", where: describe(parent), detail: `"${text.slice(0, 30)}" on ${tops.size} lines in ${Math.round(container.width)}px` });
    else if (text.length > 40 && tops.size >= 3 && container.width < 220) faults.push({ kind: "column", where: describe(parent), detail: `${tops.size} lines in ${Math.round(container.width)}px` });
  }
  // A row of controls that breaks onto a second line, or a text box that hides part of its text.
  for (const row of scopes.flatMap(scope => Array.from(scope.querySelectorAll(".field-list-content, .field-control, [data-slot=stack-field]")))) {
    if (!visible(row) || getComputedStyle(row).display !== "flex") continue;
    const kids = Array.from(row.children).filter(visible).filter(kid => {
      const style = getComputedStyle(kid);
      // The provenance line may drop under a control too wide to share its line.
      return style.position !== "absolute" && style.flexBasis !== "100%" && !kid.matches("[role=alert], .field-error, .field-origin");
    });
    // Items sit on one line while each starts above the bottom of the line so far; one that starts below it has wrapped.
    let lines = 0, bottom = -Infinity;
    for (const box of kids.map(kid => kid.getBoundingClientRect()).sort((x, y) => x.top - y.top)) {
      if (box.top >= bottom - 2) { lines++; bottom = box.bottom; } else bottom = Math.max(bottom, box.bottom);
    }
    if (lines > 1) faults.push({ kind: "rowwrap", where: describe(row), detail: `${kids.length} controls on ${lines} lines in ${Math.round(row.getBoundingClientRect().width)}px` });
  }
  for (const box of scopes.flatMap(scope => Array.from(scope.querySelectorAll("textarea")))) {
    if (visible(box) && box.scrollHeight > box.clientHeight + 4) faults.push({ kind: "clipped", where: describe(box), detail: `${box.scrollHeight}px of text in ${box.clientHeight}px` });
  }
  // overlapping controls in one row
  for (const row of Array.from(document.querySelectorAll(".field-control, .field-list-content, .field-list-row, [data-slot=row] > div"))) {
    const kids = Array.from(row.children).filter(visible).filter(kid => getComputedStyle(kid).position !== "absolute");
    for (let a = 0; a < kids.length; a++) for (let b = a + 1; b < kids.length; b++) {
      const one = kids[a]!.getBoundingClientRect(), two = kids[b]!.getBoundingClientRect();
      const x = Math.min(one.right, two.right) - Math.max(one.left, two.left);
      const y = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
      if (x > 3 && y > 3) faults.push({ kind: "overlap", where: describe(kids[a]!), detail: `overlaps ${describe(kids[b]!)}` });
    }
  }
  return faults;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const list = await surfaces();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.addInitScript("globalThis.__name = (t) => t;");
  const report: { route: string; expanded: number; errors: string[]; faults: Fault[] }[] = [];
  let errors: string[] = [];
  const controls: ControlEntry[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !/404|Failed to load resource/.test(message.text())) errors.push(message.text()); });
  for (const surface of list) {
    errors = [];
    await page.goto(`${base}/#/${surface.route}`, { waitUntil: "load" });
    await page.waitForTimeout(1800);
    if (surface.click === "peek") {
      try { await page.locator("main .ref-chip:not(.is-empty)").first().focus(); await page.keyboard.press(" "); await page.waitForTimeout(1500); } catch { errors.push("could not open a peek"); }
    } else if (surface.click) { try { await page.locator(surface.click).first().click({ timeout: 3000 }); await page.waitForTimeout(700); } catch { errors.push(`could not click ${surface.click}`); } }
    const expanded = /^[^/]+\/[^/]+\/.+/.test(surface.route) || surface.click ? await expandAll(page) : 0;
    // A dev-server reload mid-measure destroys the context; wait for the page to settle and measure again.
    if (args.includes("--controls")) controls.push(...(await page.evaluate(inventory).catch(() => [])).map(entry => ({ ...entry, route: surface.route })));
    const faults = await page.evaluate(measure).catch(async () => { await page.waitForTimeout(2500); return page.evaluate(measure); });
    const unique = [...new Map(faults.map(fault => [`${fault.kind}|${fault.where}`, fault])).values()];
    report.push({ route: surface.route + (surface.click ? ` (click ${surface.click})` : ""), expanded, errors, faults: unique });
    const slug = `${surface.route}${surface.click ? `-${surface.click === "peek" ? "peek" : "drawer"}` : ""}`.replace(/[^a-z0-9]+/gi, "-");
    if (unique.length || args.includes("--shots")) await page.screenshot({ path: path.join(outDir, `${slug}.png`), fullPage: true });
    console.log(`${unique.length ? "✗" : "✓"} ${surface.route}${surface.click ? " +drawer" : ""}  ${unique.length} faults${errors.length ? `, ${errors.length} errors` : ""}`);
    for (const fault of unique.slice(0, 12)) console.log(`    ${fault.kind.padEnd(8)} ${fault.where} · ${fault.detail}`);
    if (unique.length > 12) console.log(`    … ${unique.length - 12} more`);
    for (const error of errors.slice(0, 3)) console.log(`    error    ${error.slice(0, 160)}`);
  }
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  if (args.includes("--controls")) await writeFile(path.join(outDir, "controls.json"), JSON.stringify(controls, null, 2));
  const total = report.reduce((sum, entry) => sum + entry.faults.length, 0);
  console.log(`\n${report.length} surfaces, ${total} faults, ${report.filter(entry => entry.faults.length).length} with faults`);
  await browser.close();
}

void main();
