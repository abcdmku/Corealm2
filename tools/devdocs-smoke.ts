import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";
import { repoRoot } from "./lib/paths.js";
import type { ViewerSnapshot } from "../devdocs/src/viewer/types.js";

const evidence = path.join(repoRoot, "test-results/devdocs");
await mkdir(evidence, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), "corealm-devdocs-smoke-"));
const contentRoot = path.join(temporary, "content");
await cp(path.join(repoRoot, "game/content/data"), path.join(contentRoot, "data"), { recursive: true });
const oldRoot = process.env.DEVDOCS_CONTENT_ROOT;
process.env.DEVDOCS_CONTENT_ROOT = contentRoot;
const server = await createServer({ configFile: path.join(repoRoot, "devdocs/vite.config.ts"), cacheDir: path.join(repoRoot, "node_modules/.vite-devdocs-smoke"), optimizeDeps: { force: true }, logLevel: "error", server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false } });
if (oldRoot === undefined) delete process.env.DEVDOCS_CONTENT_ROOT; else process.env.DEVDOCS_CONTENT_ROOT = oldRoot;
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const checks: Record<string, unknown> = {};
let expectedConflict = false;
async function snapshot(page: Page): Promise<ViewerSnapshot> { return JSON.parse((await page.locator("script[data-viewer-state]").textContent())!) as ViewerSnapshot; }
async function moving(page: Page): Promise<ViewerSnapshot> {
  await page.locator('[data-viewer-ready="true"]').waitFor({ timeout: 50_000 });
  const before = await snapshot(page);
  await page.waitForFunction(time => {
    const state = JSON.parse(document.querySelector("script[data-viewer-state]")!.textContent!);
    return state.time !== time;
  }, before.time);
  const after = await snapshot(page);
  assert(after.playing && after.clips.length > 0);
  return after;
}
try {
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("Missing TCP address");
  const url = `http://127.0.0.1:${address.port}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, colorScheme: "dark" });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !(expectedConflict && message.text().includes("409"))) errors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400 && !(expectedConflict && response.status() === 409)) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${url}/#/items`);
  await page.getByRole("grid", { name: "Items", exact: true }).waitFor();
  assert(await page.getByRole("row").count() < 100, "Item table must virtualize 399 records");
  checks.virtualizedItems = true;
  await page.screenshot({ path: path.join(evidence, "items-dark.png") });
  await page.getByRole("textbox", { name: "Search items", exact: true }).fill("grithe_sword");
  await page.getByRole("row").filter({ hasText: "Copper Sword" }).click();
  await page.getByRole("heading", { name: "Copper Sword", exact: true }).waitFor();
  await page.waitForFunction(() => (document.querySelector(".item-art-large img") as HTMLImageElement)?.naturalWidth === 256);
  checks.itemMasterIcon = 256;
  await page.getByRole("tab", { name: "Sources and uses", exact: true }).click();
  await page.getByRole("button", { name: "Copper Sword", exact: true }).waitFor();
  checks.itemRecipeConnection = true;
  await page.getByRole("tab", { name: "3D model", exact: true }).click();
  const sword = await moving(page);
  assert(sword.clip?.includes("Sword_Attack"));
  assert(sword.attachments.some(part => part.slot === "mainHand" && part.bone));
  checks.sword = { clip: sword.clip, attachments: sword.attachments, time: sword.time };
  await page.screenshot({ path: path.join(evidence, "sword.png") });
  await page.goto(`${url}/#/equipmentSets/hide`);
  await page.getByRole("tab", { name: "3D model", exact: true }).click();
  await moving(page);
  await page.getByLabel("Body", { exact: true }).selectOption("female");
  await page.waitForFunction(() => document.querySelector('[data-viewer-body="female"]')?.getAttribute("data-viewer-ready") === "true");
  const female = await moving(page);
  assert(female.parts.length >= 5 && female.missingBones.length === 0);
  checks.femaleSet = { parts: female.parts, clip: female.clip, missingBones: female.missingBones };
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await snapshot(page);
  await page.getByLabel("Animation time", { exact: true }).fill(String(paused.duration / 2));
  const scrubbed = await snapshot(page);
  assert(!scrubbed.playing && Math.abs(scrubbed.time - paused.duration / 2) < .02);
  await page.screenshot({ path: path.join(evidence, "female-set.png") });
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").waitFor();
  await page.getByRole("combobox").fill("redbrush_fox");
  await page.getByRole("option").filter({ hasText: "Creatures" }).first().click();
  await page.getByRole("tab", { name: "3D model", exact: true }).click();
  const creature = await moving(page);
  checks.creature = { clip: creature.clip, clips: creature.clips.length, time: creature.time };
  await page.screenshot({ path: path.join(evidence, "creature.png") });
  await page.getByRole('heading', { name: 'Red Fox', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Open combat record', exact: true }).click();
  await page.waitForFunction(() => location.hash.endsWith('/enemies/redbrush_fox_t1'));
  const [unlinkedCreature] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/collections/enemies/redbrush_fox_t1') && response.request().method() === 'PUT'),
    page.getByRole('button', { name: 'Keep these values', exact: true }).click(),
  ]);
  assert.equal(unlinkedCreature.status(), 200);
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await page.getByRole('spinbutton', { name: /^Max health$/i }).fill('9');
  const [enemySave] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/collections/enemies/redbrush_fox_t1') && response.request().method() === 'PUT'),
    page.getByRole('button', { name: 'Save changes', exact: true }).click(),
  ]);
  assert.equal(enemySave.status(), 200);
  const savedEnemies = JSON.parse(await readFile(path.join(contentRoot, 'data/enemies.json'), 'utf8'));
  assert.equal(savedEnemies.find((row: { id: string }) => row.id === 'redbrush_fox_t1').maxHealth, 9);
  checks.creatureCombatEdit = true;
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.goto(`${url}/#/items`);
  await page.getByRole("grid", { name: "Items", exact: true }).waitFor();
  await page.screenshot({ path: path.join(evidence, "items-light.png") });
  await page.getByLabel("Group by", { exact: true }).selectOption("");
  const grid = page.getByRole("grid", { name: "Items", exact: true });
  await grid.focus(); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: "Overview", exact: true }).waitFor();
  checks.keyboardNavigation = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator(".sidebar").getByRole("button", { name: /^gear \d+$/ }).click();
  await page.waitForFunction(() => location.hash.includes("balance"));
  await page.getByRole("grid", { name: "gear", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".page-transition")!).opacity) >= .99);
  await page.screenshot({ path: path.join(evidence, "mobile-balance.png") });
  checks.mobileWidth = 390;
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${url}/#/items/grithe_sword`);
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  const description = page.getByRole("textbox", { name: "Description", exact: true });
  await description.fill("A copper sword edited by the isolated browser smoke.");
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  assert.equal(await description.inputValue(), "A copper sword edited by the isolated browser smoke.");
  const [itemSave] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/collections/items/grithe_sword') && response.request().method() === 'PUT'),
    page.getByRole('button', { name: 'Save changes', exact: true }).click(),
  ]);
  assert.equal(itemSave.status(), 200);
  const itemFile = path.join(contentRoot, "data/items.json");
  const savedItems = JSON.parse(await readFile(itemFile, "utf8")) as { id: string; description: string }[];
  assert.equal(savedItems.find(row => row.id === "grithe_sword")!.description, "A copper sword edited by the isolated browser smoke.");
  checks.isolatedItemEdit = true;
  await description.fill("A draft that must survive a conflict.");
  const current = await (await page.request.get(`${url}/__devdocs/collections/items`)).json();
  const copper = current.data.find((row: { id: string }) => row.id === "grithe_sword");
  const concurrent = await page.request.put(`${url}/__devdocs/collections/items/grithe_sword`, { data: { revision: current.revision, record: { ...copper, description: "A concurrent author saved this text." } } });
  assert.equal(concurrent.status(), 200);
  expectedConflict = true;
  const conflictResponse = page.waitForResponse(response => response.status() === 409);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await conflictResponse;
  await page.getByText(/This file changed after you opened it/).waitFor();
  assert.equal(await description.inputValue(), "A draft that must survive a conflict.");
  assert(await page.getByRole("button", { name: "Save changes", exact: true }).isDisabled());
  assert.equal((JSON.parse(await readFile(itemFile, "utf8")) as typeof savedItems).find(row => row.id === "grithe_sword")!.description, "A concurrent author saved this text.");
  await page.screenshot({ path: path.join(evidence, "edit-conflict.png") });
  await page.getByRole("button", { name: "Reset draft", exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Description"]') as HTMLTextAreaElement)?.value === "A concurrent author saved this text.");
  expectedConflict = false;
  checks.conflictPreservesDraft = true;
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByRole("checkbox", { name: "Flag as request", exact: true }).check();
  await page.getByPlaceholder("Describe the change to make").fill("Review this sword's grip from the browser.");
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  assert.equal(await page.getByPlaceholder("Describe the change to make").inputValue(), "Review this sword's grip from the browser.");
  checks.draftsSurviveTabs = true;
  await page.getByLabel("Request kind", { exact: true }).selectOption("art");
  await page.getByRole("button", { name: "Open request", exact: true }).click();
  await page.locator(".notes-entry-text").filter({ hasText: "Review this sword's grip from the browser." }).waitFor();
  await page.screenshot({ path: path.join(evidence, "notes-request.png") });
  checks.browserRequestWrite = true;
  await page.goto(`${url}/#/requests`);
  await page.getByRole("heading", { name: "Requests", exact: true }).waitFor();
  await page.getByText("Review this sword's grip from the browser.", { exact: true }).waitFor();
  checks.requestsPage = true;
  await page.goto(`${url}/#/kits`);
  await page.getByRole("group", { name: "Filter by tier", exact: true }).getByRole("button", { name: "1", exact: true }).click();
  assert.equal(await page.locator(".kits-tier").count(), 1);
  await page.getByRole("button", { name: "Open Copper Sword", exact: true }).waitFor();
  await page.keyboard.press("/");
  assert(await page.getByRole("textbox", { name: "Search kits", exact: true }).evaluate(element => element === document.activeElement));
  await page.screenshot({ path: path.join(evidence, "kits.png") });
  await page.getByRole("button", { name: "Open Copper Sword", exact: true }).click();
  await page.getByRole("heading", { name: "Copper Sword", exact: true }).waitFor();
  checks.kits = true;
  await page.goto(`${url}/#/balance/gear/rare`);
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  const rareMultiplier = page.locator('[id="edit-rare.bonusMultiplier"] input');
  await rareMultiplier.fill("1.25");
  const itemsBeforeParameterEdit = await readFile(itemFile, "utf8");
  const parameterSaved = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("balance"));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  assert.equal((await parameterSaved).status(), 200);
  assert.equal(await readFile(itemFile, "utf8"), itemsBeforeParameterEdit, "Parameter saves must not silently rewrite items");
  const driftValidation = await (await page.request.post(`${url}/__devdocs/validate`)).json();
  assert.equal(driftValidation.ok, false);
  assert(driftValidation.diagnostics.some((issue: { message: string; severity: string }) => issue.severity === "error" && issue.message.includes("Drifted")));
  await page.getByRole("tab", { name: "Formula", exact: true }).click();
  await page.locator(".balance-code .shiki").waitFor();
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  await page.getByRole("button", { name: "Apply changes to 8 records", exact: true }).waitFor();
  assert.equal(await readFile(itemFile, "utf8"), itemsBeforeParameterEdit, "Preview must not write");
  await page.screenshot({ path: path.join(evidence, "balance-preview.png") });
  await page.getByRole("button", { name: "Apply changes to 8 records", exact: true }).click();
  await page.getByText(/Applied changes to 8 records/).waitFor();
  assert.notEqual(await readFile(itemFile, "utf8"), itemsBeforeParameterEdit);
  const recomputed = await (await page.request.post(`${url}/__devdocs/recompute`, { data: { operation: "preview", kind: "gear" } })).json();
  assert.deepEqual(recomputed.diffs, []);
  const validation = await (await page.request.post(`${url}/__devdocs/validate`)).json();
  assert.equal(validation.ok, true, JSON.stringify(validation.diagnostics));
  const gitStatus = await (await page.request.get(`${url}/__devdocs/git/status`)).json();
  assert(Array.isArray(gitStatus.changes));
  checks.parameterPreviewApply = { count: 8, remaining: 0 };
  const metadataUrl = `${url}/__devdocs/meta/items/grithe_sword`;
  const metadata = await (await page.request.get(metadataUrl)).json();
  const written = await page.request.patch(metadataUrl, { data: { revision: metadata.revision, operation: { kind: "request.open", requestId: "smoke-grip", requestKind: "art", text: "Verify the grip." } } });
  assert.equal(written.status(), 200);
  const report = await (await page.request.get(`${url}/__devdocs/requests`)).json();
  assert(report.requests.some((row: { entityId: string }) => row.entityId === "grithe_sword"));
  assert((await readFile(path.join(contentRoot, "meta/items.meta.json"), "utf8")).includes("smoke-grip"));
  checks.isolatedRequestWrite = true;
  const changeWornPrice = async () => {
    const parameters = await (await page.request.get(`${url}/__devdocs/collections/balance/gear`)).json();
    const baseline = parameters.data.baselines.find((row: { id: string }) => row.id === 'worn_sword');
    baseline.value += 1;
    const response = await page.request.put(`${url}/__devdocs/collections/balance/gear/$collection`, { data: { revision: parameters.revision, record: parameters.data } });
    assert.equal(response.status(), 200);
    return baseline.value;
  };
  const appliedPrice = await changeWornPrice();
  await page.goto(`${url}/#/items/worn_sword`);
  await page.getByRole('button', { name: 'Preview formula changes', exact: true }).click();
  await page.getByRole('heading', { name: 'Formula drift', exact: true }).waitFor();
  await page.waitForFunction(() => {
    const button = document.querySelector('.record-formula-apply button');
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await page.screenshot({ path: path.join(evidence, 'record-formula-preview.png') });
  const [recordApply] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/recompute') && response.request().postDataJSON()?.operation === 'apply'),
    page.getByRole('button', { name: 'Apply formula values', exact: true }).click(),
  ]);
  assert.equal(recordApply.status(), 200);
  assert.equal(JSON.parse(await readFile(itemFile, 'utf8')).find((row: { id: string }) => row.id === 'worn_sword').value, appliedPrice);
  await changeWornPrice();
  await page.getByRole('button', { name: 'Refresh preview', exact: true }).click();
  await page.getByRole('heading', { name: 'Formula drift', exact: true }).waitFor();
  const [kept] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/collections/items/worn_sword') && response.request().method() === 'PUT'),
    page.getByRole('button', { name: 'Keep these values', exact: true }).click(),
  ]);
  assert.equal(kept.status(), 200);
  const handTuned = JSON.parse(await readFile(itemFile, 'utf8')).find((row: { id: string }) => row.id === 'worn_sword');
  assert.equal(handTuned.value, appliedPrice);
  assert.equal(handTuned.derivation, undefined);
  checks.perRecordFormulaApplyAndKeep = true;
  const enemyFile = path.join(contentRoot, "data/enemies.json");
  const enemyBalanceCollection = `${url}/__devdocs/collections/balance/enemies`;
  const enemyBalanceResponse = await page.request.get(enemyBalanceCollection);
  assert.equal(enemyBalanceResponse.status(), 200);
  const enemyBalance = await enemyBalanceResponse.json() as {
    revision: string;
    data: { marksPerTier: { ordinary: [number, number] } };
  };
  const ordinaryMarks = enemyBalance.data.marksPerTier.ordinary;
  const updatedOrdinaryMarks: [number, number] = [ordinaryMarks[0] + 1, ordinaryMarks[1]];
  enemyBalance.data.marksPerTier.ordinary = updatedOrdinaryMarks;
  const enemyBalanceWrite = await page.request.put(`${enemyBalanceCollection}/$collection`, { data: { revision: enemyBalance.revision, record: enemyBalance.data } });
  assert.equal(enemyBalanceWrite.status(), 200);
  const enemiesBeforeFormula = JSON.parse(await readFile(enemyFile, "utf8")) as Record<string, unknown>[];
  const frogBeforeFormula = enemiesBeforeFormula.find(row => row.id === "frog_t1");
  assert(frogBeforeFormula);
  const previousFrogMarks = frogBeforeFormula.marks as [number, number];
  const expectedFrogMarks: [number, number] = [
    Math.round(Number(frogBeforeFormula.tier) * updatedOrdinaryMarks[0]),
    Math.round(Number(frogBeforeFormula.tier) * updatedOrdinaryMarks[1]),
  ];
  await page.goto(`${url}/#/enemies/frog_t1`);
  await page.getByRole("heading", { name: "Frog", exact: true }).waitFor();
  await page.getByRole("button", { name: "Preview formula changes", exact: true }).click();
  await page.getByRole("heading", { name: "Formula drift", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const button = document.querySelector(".record-formula-apply button");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  const marksDiff = page.locator(".record-formula-preview tbody tr").filter({ hasText: "marks" });
  await marksDiff.waitFor();
  const marksDiffText = await marksDiff.innerText();
  assert(marksDiffText.includes(String(previousFrogMarks[0])));
  assert(marksDiffText.includes(String(expectedFrogMarks[0])));
  await page.getByText("Formula inputs: legacy/frog_t1", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(evidence, "enemy-formula-preview.png") });
  const [enemyRecordApply] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/recompute") && response.request().postDataJSON()?.operation === "apply"),
    page.getByRole("button", { name: "Apply formula values", exact: true }).click(),
  ]);
  assert.equal(enemyRecordApply.status(), 200);
  const enemiesAfterFormula = JSON.parse(await readFile(enemyFile, "utf8")) as Record<string, unknown>[];
  const frogAfterFormula = enemiesAfterFormula.find(row => row.id === "frog_t1");
  assert(frogAfterFormula);
  assert.deepEqual(frogAfterFormula.marks, expectedFrogMarks);
  assert.deepEqual(
    Object.fromEntries(Object.entries(frogAfterFormula).filter(([key]) => key !== "marks")),
    Object.fromEntries(Object.entries(frogBeforeFormula).filter(([key]) => key !== "marks")),
  );
  await page.goto(`${url}/#/balance/enemies/marksPerTier`);
  await page.getByRole("tab", { name: "Formula", exact: true }).click();
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  const applyEnemyFormulaChanges = page.getByRole("button", { name: /^Apply changes to \d+ records$/ });
  await applyEnemyFormulaChanges.waitFor();
  assert.equal(await applyEnemyFormulaChanges.innerText(), "Apply changes to 23 records");
  await page.waitForFunction(() => {
    const button = document.querySelector(".balance-apply-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  const [enemyAllApply] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/recompute") && response.request().postDataJSON()?.operation === "apply"),
    applyEnemyFormulaChanges.click(),
  ]);
  assert.equal(enemyAllApply.status(), 200);
  await page.getByText(/Applied changes to 23 records/).waitFor();
  const remainingEnemyDiffs = await (await page.request.post(`${url}/__devdocs/recompute`, { data: { operation: "preview", kind: "legacyMarks.v1" } })).json();
  assert.deepEqual(remainingEnemyDiffs.diffs, []);
  checks.enemyFormulaPreviewApply = { recordId: "frog_t1", marks: expectedFrogMarks, remaining: 0 };
  const enemyParametersBeforeExamples = await readFile(path.join(contentRoot, "data/balance/enemies.json"), "utf8");
  const enemyRecordsBeforeExamples = await readFile(enemyFile, "utf8");
  const marksExampleBefore = await page.locator(".balance-example-result").innerText();
  await page.getByLabel("Example input tier", { exact: true }).fill("5");
  await page.waitForFunction(before => (document.querySelector(".balance-example-result") as HTMLElement | null)?.innerText !== before, marksExampleBefore);
  assert.notEqual(await page.locator(".balance-example-result").innerText(), marksExampleBefore);
  await page.getByRole("combobox", { name: "Formula", exact: true }).selectOption("legacyBossCombat.v1");
  const multiplierInput = page.getByLabel("Example boss target multiplier", { exact: true });
  await multiplierInput.waitFor();
  const bossExampleBefore = await page.locator(".balance-example-result").innerText();
  const savedMultiplier = Number(await multiplierInput.inputValue());
  await multiplierInput.fill(String(savedMultiplier + 1));
  await page.waitForFunction(before => (document.querySelector(".balance-example-result") as HTMLElement | null)?.innerText !== before, bossExampleBefore);
  assert.notEqual(await page.locator(".balance-example-result").innerText(), bossExampleBefore);
  await page.locator(".balance-example").screenshot({ path: path.join(evidence, "enemy-boss-example.png") });
  await multiplierInput.fill("");
  await page.getByRole("alert").filter({ hasText: /multiplier/i }).first().waitFor();
  await page.getByRole("button", { name: "Reset inputs", exact: true }).click();
  assert.equal(await multiplierInput.inputValue(), String(savedMultiplier));
  assert.equal(await readFile(path.join(contentRoot, "data/balance/enemies.json"), "utf8"), enemyParametersBeforeExamples);
  assert.equal(await readFile(enemyFile, "utf8"), enemyRecordsBeforeExamples);
  checks.enemyLiveExamples = true;

  const sourceBalanceResponse = await page.request.get(enemyBalanceCollection);
  assert.equal(sourceBalanceResponse.status(), 200);
  const sourceBalance = await sourceBalanceResponse.json() as {
    revision: string;
    data: { sourceParameters: { rpg: { healthBase: number } } };
  };
  const sourceHealthBase = sourceBalance.data.sourceParameters.rpg.healthBase;
  sourceBalance.data.sourceParameters.rpg.healthBase = sourceHealthBase + 2;
  const sourceBalanceWrite = await page.request.put(`${enemyBalanceCollection}/$collection`, { data: { revision: sourceBalance.revision, record: sourceBalance.data } });
  assert.equal(sourceBalanceWrite.status(), 200);
  await page.reload();
  const sourceEnemiesBefore = JSON.parse(await readFile(enemyFile, "utf8")) as Record<string, unknown>[];
  const sourceRpgRowsBefore = sourceEnemiesBefore.filter(row => {
    const tag = row.derivation !== null && typeof row.derivation === "object" && !Array.isArray(row.derivation)
      ? row.derivation as Record<string, unknown> : {};
    return tag.kind === "sourceEnemy.v1" && typeof tag.inputId === "string" && tag.inputId.startsWith("rpg/");
  });
  assert.equal(sourceRpgRowsBefore.length, 25);
  const sourceRpgIds = new Set(sourceRpgRowsBefore.map(row => String(row.id)));
  const sourceMetaFile = path.join(contentRoot, "meta/items.meta.json");
  const sourceMetaBefore = await readFile(sourceMetaFile, "utf8");
  await page.goto(`${url}/#/balance/enemies/sourceParameters`);
  await page.getByRole("tab", { name: "Formula", exact: true }).click();
  await page.getByRole("combobox", { name: "Formula", exact: true }).selectOption("sourceEnemy.v1");
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  const applySourceChanges = page.getByRole("button", { name: /^Apply changes to \d+ records$/ });
  await applySourceChanges.waitFor();
  assert.equal(await applySourceChanges.innerText(), "Apply changes to 25 records");
  await page.waitForFunction(() => {
    const button = document.querySelector(".balance-apply-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await page.locator("[data-sonner-toast]").last().waitFor({ state: "hidden", timeout: 15_000 });
  await page.screenshot({ path: path.join(evidence, "core-source-preview.png") });
  const [sourceApply] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/recompute") && response.request().postDataJSON()?.operation === "apply"),
    applySourceChanges.click(),
  ]);
  assert.equal(sourceApply.status(), 200);
  await page.getByText(/Applied changes to 25 records/).waitFor();
  const sourceEnemiesAfter = JSON.parse(await readFile(enemyFile, "utf8")) as Record<string, unknown>[];
  assert.equal(sourceEnemiesAfter.length, sourceEnemiesBefore.length);
  const sourceBeforeById = new Map(sourceEnemiesBefore.map(row => [String(row.id), row]));
  const sourceAfterById = new Map(sourceEnemiesAfter.map(row => [String(row.id), row]));
  const withoutMaxHealth = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "maxHealth"));
  const changedSourceIds: string[] = [];
  for (const afterRow of sourceEnemiesAfter) {
    const beforeRow = sourceBeforeById.get(String(afterRow.id));
    assert(beforeRow);
    assert.deepEqual(withoutMaxHealth(afterRow), withoutMaxHealth(beforeRow));
    if (!Object.is(afterRow.maxHealth, beforeRow.maxHealth)) changedSourceIds.push(String(afterRow.id));
  }
  assert.deepEqual(new Set(changedSourceIds), sourceRpgIds);
  for (const id of sourceRpgIds) {
    const beforeRow = sourceBeforeById.get(id);
    const afterRow = sourceAfterById.get(id);
    assert(beforeRow && afterRow);
    assert(Number(afterRow.maxHealth) > Number(beforeRow.maxHealth));
  }
  assert.equal(await readFile(sourceMetaFile, "utf8"), sourceMetaBefore);
  const sourceBalanceAfter = JSON.parse(await readFile(path.join(contentRoot, "data/balance/enemies.json"), "utf8")) as { sourceParameters: { rpg: { healthBase: number } } };
  assert.equal(sourceBalanceAfter.sourceParameters.rpg.healthBase, sourceHealthBase + 2);
  const remainingSourceDiffs = await (await page.request.post(`${url}/__devdocs/recompute`, { data: { operation: "preview", kind: "sourceEnemy.v1" } })).json();
  assert.deepEqual(remainingSourceDiffs.diffs, []);
  checks.sourceEnemyPreviewApply = { count: 25, changedField: "maxHealth", healthBase: sourceHealthBase + 2, remaining: 0 };

  const lootFile = path.join(contentRoot, "data/lootTables.json");
  const lootBalanceCollection = url + "/__devdocs/collections/balance/loot";
  const lootBalanceResponse = await page.request.get(lootBalanceCollection);
  assert.equal(lootBalanceResponse.status(), 200);
  const lootBalance = await lootBalanceResponse.json() as {
    revision: string;
    data: {
      sourceLoot: { starter: { chance: number } };
      sourceInputs: { id: string; kind: string }[];
    };
  };
  const starterChance = lootBalance.data.sourceLoot.starter.chance;
  const updatedStarterChance = starterChance + 0.1;
  assert(updatedStarterChance >= 0 && updatedStarterChance <= 1);
  lootBalance.data.sourceLoot.starter.chance = updatedStarterChance;
  const lootBalanceWrite = await page.request.put(lootBalanceCollection + "/$collection", { data: { revision: lootBalance.revision, record: lootBalance.data } });
  assert.equal(lootBalanceWrite.status(), 200);
  await page.reload();
  const lootRowsBefore = JSON.parse(await readFile(lootFile, "utf8")) as Record<string, unknown>[];
  const starterInputIds = new Set(lootBalance.data.sourceInputs.filter(input => input.kind === "starter").map(input => input.id));
  const expectedLootIds = new Set(lootRowsBefore.filter(row => {
    const tag = row.derivation !== null && typeof row.derivation === "object" && !Array.isArray(row.derivation)
      ? row.derivation as Record<string, unknown> : {};
    return tag.kind === "sourceLoot.v1" && typeof tag.inputId === "string" && starterInputIds.has(tag.inputId);
  }).map(row => String(row.id)));
  assert(expectedLootIds.size > 0);
  const lootMetaBefore = await readFile(sourceMetaFile, "utf8");
  await page.goto(url + "/#/balance/loot/sourceLoot");
  await page.getByRole("tab", { name: "Formula", exact: true }).click();
  await page.getByRole("combobox", { name: "Formula", exact: true }).selectOption("sourceLoot.v1");
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  const applyLootChanges = page.getByRole("button", { name: /^Apply changes to \d+ records$/ });
  await applyLootChanges.waitFor();
  const lootApplyMatch = /^Apply changes to (\d+) records$/.exec(await applyLootChanges.innerText());
  assert(lootApplyMatch);
  const lootChangedCount = Number(lootApplyMatch[1]);
  assert.equal(lootChangedCount, expectedLootIds.size);
  await page.waitForFunction(() => {
    const button = document.querySelector(".balance-apply-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await page.locator("[data-sonner-toast]").last().waitFor({ state: "hidden", timeout: 15_000 });
  await page.screenshot({ path: path.join(evidence, "loot-source-preview.png") });
  const [lootApply] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/recompute") && response.request().postDataJSON()?.operation === "apply"),
    applyLootChanges.click(),
  ]);
  assert.equal(lootApply.status(), 200);
  await page.getByText(new RegExp("Applied changes to " + lootChangedCount + " records")).waitFor();
  const lootRowsAfter = JSON.parse(await readFile(lootFile, "utf8")) as Record<string, unknown>[];
  assert.equal(lootRowsAfter.length, lootRowsBefore.length);
  const lootBeforeById = new Map(lootRowsBefore.map(row => [String(row.id), row]));
  const withoutDrops = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "drops"));
  const withoutChance = (drops: unknown) => (drops as Record<string, unknown>[]).map(drop => Object.fromEntries(Object.entries(drop).filter(([key]) => key !== "chance")));
  const changedLootIds: string[] = [];
  for (const afterRow of lootRowsAfter) {
    const beforeRow = lootBeforeById.get(String(afterRow.id));
    assert(beforeRow);
    assert.deepEqual(withoutDrops(afterRow), withoutDrops(beforeRow));
    if (JSON.stringify(afterRow.drops) !== JSON.stringify(beforeRow.drops)) changedLootIds.push(String(afterRow.id));
  }
  assert.deepEqual(new Set(changedLootIds), expectedLootIds);
  for (const id of expectedLootIds) {
    const beforeRow = lootBeforeById.get(id);
    const afterRow = lootRowsAfter.find(row => String(row.id) === id);
    assert(beforeRow && afterRow);
    assert.deepEqual(withoutChance(afterRow.drops), withoutChance(beforeRow.drops));
    const afterDrops = afterRow.drops as Record<string, unknown>[];
    assert(afterDrops.length > 0 && afterDrops.every(drop => drop.chance === updatedStarterChance));
  }
  assert.equal(await readFile(sourceMetaFile, "utf8"), lootMetaBefore);
  const lootBalanceAfter = JSON.parse(await readFile(path.join(contentRoot, "data/balance/loot.json"), "utf8")) as { sourceLoot: { starter: { chance: number } } };
  assert.equal(lootBalanceAfter.sourceLoot.starter.chance, updatedStarterChance);
  const remainingLootDiffs = await (await page.request.post(url + "/__devdocs/recompute", { data: { operation: "preview", kind: "sourceLoot.v1" } })).json();
  assert.deepEqual(remainingLootDiffs.diffs, []);
  checks.sourceLootPreviewApply = { count: lootChangedCount, changedField: "drops.chance", starterChance: updatedStarterChance, remaining: 0 };

  const localFormulaFiles = ["data/enemies.json", "data/balance/enemies.json", "data/lootTables.json", "data/balance/loot.json"];
  const localFormulaBytes = await Promise.all(localFormulaFiles.map(file => readFile(path.join(contentRoot, file), "utf8")));
  for (const example of [
    { route: "/#/balance/enemies/sourceParameters", kind: "sourceEnemy.v1", record: "grass_viper_t1", label: "Example source health", value: "19", screenshot: "source-health-example.png" },
    { route: "/#/balance/enemies/fantasy", kind: "fantasyScale.v1", record: "fen_crawler_t1", label: "Example target tier", value: "5", screenshot: "fantasy-tier-example.png" },
    { route: "/#/balance/loot/sourceLoot", kind: "sourceLoot.v1", record: "loot_enemy_grass_viper_t1", label: "Example loot chance", value: "0.33", screenshot: "loot-chance-example.png" },
  ]) {
    await page.goto(url + example.route);
    await page.getByRole("tab", { name: "Formula", exact: true }).click();
    await page.getByRole("combobox", { name: "Formula", exact: true }).selectOption(example.kind);
    await page.getByRole("combobox", { name: "Example record", exact: true }).selectOption(example.record);
    const control = page.getByRole("spinbutton", { name: example.label, exact: true });
    await control.waitFor();
    const result = page.locator(".balance-example-result > div").nth(1).locator("dl");
    await result.waitFor();
    const before = await result.innerText();
    await control.fill(example.value);
    await page.waitForFunction(previous => {
      const result = document.querySelector(".balance-example-result > div:nth-child(2) dl");
      return result instanceof HTMLElement && result.innerText !== previous;
    }, before);
    assert.notEqual(await result.innerText(), before);
    await page.locator("[data-sonner-toast]").last().waitFor({ state: "hidden", timeout: 15_000 });
    await page.locator(".balance-example").screenshot({ path: path.join(evidence, example.screenshot) });
    await control.fill("");
    await page.getByRole("alert").first().waitFor();
    await page.getByRole("button", { name: "Reset inputs", exact: true }).click();
    await result.waitFor();
    assert.equal(await result.innerText(), before);
  }
  assert.deepEqual(await Promise.all(localFormulaFiles.map(file => readFile(path.join(contentRoot, file), "utf8"))), localFormulaBytes);
  checks.sourceFormulaLiveExamples = { kinds: ["sourceEnemy.v1", "fantasyScale.v1", "sourceLoot.v1"], changed: true, invalidRejected: true, reset: true, noWrites: true };

  await page.goto(`${url}/#/review`);
  await page.locator('.review-validation-result.is-ok').waitFor();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.page-transition')!).opacity) >= .99);
  await page.screenshot({ path: path.join(evidence, 'review.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.screenshot({ path: path.join(evidence, 'review-mobile.png') });
  checks.reviewPage = true;
  assert.deepEqual(errors, []);
  await writeFile(path.join(evidence, "report.json"), JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
} catch (error) {
  await writeFile(path.join(evidence, "report.json"), JSON.stringify({ passed: false, checks, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close(); await server.close();
  if (path.dirname(temporary) !== path.resolve(tmpdir())) throw new Error("Unexpected temporary root");
  await rm(temporary, { recursive: true, force: true });
}
