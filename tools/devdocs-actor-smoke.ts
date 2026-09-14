import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { repoRoot } from "./lib/paths.js";

type JsonObject = Record<string, unknown>;

interface CollectionResponse {
  revision: string;
  data: unknown;
}

interface RecomputeResponse {
  diffs: JsonObject[];
  revisions: JsonObject;
}

const ACTOR_ENEMY_CHANGED_FIELDS = new Set([
  "maxHealth",
  "attackLevel",
  "defenceLevel",
  "accuracy",
  "armour",
  "magicArmour",
  "maxHit",
]);

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function rows(value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((row, index) => object(row, `${label}[${index}]`));
}

function inputRows(data: unknown, label: string): JsonObject[] {
  return rows(object(data, label).sourceInputs, `${label}.sourceInputs`);
}

function inputIdsForKind(data: unknown, kind: string, label: string): Set<string> {
  const ids = inputRows(data, label)
    .filter(input => input.kind === kind)
    .map(input => input.id)
    .filter((id): id is string => typeof id === "string");
  assert.equal(new Set(ids).size, ids.length, `${label} ${kind} source input ids must be unique`);
  return new Set(ids);
}

function derivation(row: JsonObject): JsonObject {
  return isObject(row.derivation) ? row.derivation : {};
}

function linkedIds(rowsToInspect: JsonObject[], inputIds: Set<string>, kind: string, label: string): Set<string> {
  const ids = rowsToInspect
    .filter(row => {
      const tag = derivation(row);
      return tag.kind === kind && typeof tag.inputId === "string" && inputIds.has(tag.inputId);
    })
    .map(row => row.id)
    .filter((id): id is string => typeof id === "string");
  assert.equal(new Set(ids).size, ids.length, `${label} linked record ids must be unique`);
  return new Set(ids);
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function changedKeys(before: JsonObject, after: JsonObject): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function withoutKey(value: JsonObject, key: string): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([entryKey]) => entryKey !== key));
}

function drops(value: unknown, label: string): JsonObject[] {
  return rows(value, label);
}

function withoutChance(value: JsonObject): JsonObject {
  return withoutKey(value, "chance");
}

function fractionChange(value: number, amount = 0.05): number {
  assert(Number.isFinite(value) && value >= 0 && value <= 1, "fraction example must start in the [0, 1] range");
  const increased = value + amount;
  return increased <= 1 ? increased : value - amount;
}

async function collection(page: Page, url: string, label: string): Promise<CollectionResponse> {
  const response = await page.request.get(url);
  assert.equal(response.status(), 200, `${label} API must be readable`);
  const body = object(await response.json(), label);
  if (typeof body.revision !== "string") throw new Error(`${label} API must expose a revision`);
  return { revision: body.revision, data: body.data };
}

async function saveCollection(page: Page, url: string, snapshot: CollectionResponse, data: unknown, label: string): Promise<void> {
  const response = await page.request.put(`${url}/$collection`, {
    data: { revision: snapshot.revision, record: structuredClone(data) },
  });
  assert.equal(response.status(), 200, `${label} parameter save must succeed`);
}

async function recomputePreview(page: Page, origin: string, kind: string): Promise<RecomputeResponse> {
  const response = await page.request.post(`${origin}/__devdocs/recompute`, { data: { operation: "preview", kind } });
  assert.equal(response.status(), 200, `${kind} API preview must succeed`);
  const body = object(await response.json(), `${kind} recompute response`);
  return {
    diffs: rows(body.diffs, `${kind} recompute diffs`),
    revisions: object(body.revisions, `${kind} recompute revisions`),
  };
}

async function openFormula(page: Page, origin: string, route: string, kind: string): Promise<void> {
  await page.goto(`${origin}/#/${route}`);
  await page.getByRole("tab", { name: "Formula", exact: true }).click();
  const formula = page.getByRole("combobox", { name: "Formula", exact: true });
  await formula.waitFor({ state: "visible" });
  await formula.selectOption(kind);
  await page.getByRole("combobox", { name: "Example record", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
}

async function previewAndApply(page: Page, expectedCount: number, screenshotPath: string): Promise<void> {
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  const apply = page.getByRole("button", { name: /^Apply changes to \d+ records$/ });
  await apply.waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await apply.innerText(), `Apply changes to ${expectedCount} records`);
  assert.equal(await apply.isDisabled(), false, "formula preview apply must be enabled");
  await page.locator("[data-sonner-toast]").last().waitFor({ state: "hidden", timeout: 15_000 });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const [response] = await Promise.all([
    page.waitForResponse(candidate => candidate.url().endsWith("/__devdocs/recompute")
      && candidate.request().method() === "POST"
      && candidate.request().postDataJSON()?.operation === "apply"),
    apply.click(),
  ]);
  assert.equal(response.status(), 200, "formula apply must succeed");
  await page.getByText(`Applied changes to ${expectedCount} records`, { exact: false }).waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForResultChange(page: Page, before: string): Promise<void> {
  await page.waitForFunction(previous => {
    const result = document.querySelector(".balance-example-result > div:nth-child(2) dl");
    return result instanceof HTMLElement && result.innerText !== previous;
  }, before);
}

async function exerciseEnemyActorExample(page: Page, origin: string, recordId: string, label: string, nextValue: number): Promise<void> {
  const records = page.getByRole("combobox", { name: "Example record", exact: true });
  await records.selectOption(recordId);
  const result = page.locator(".balance-example-result > div").nth(1).locator("dl");
  await result.waitFor({ state: "visible" });
  const formulaInput = page.locator(".balance-example-result > div").first();
  const formulaInputText = await formulaInput.innerText();
  assert(formulaInputText.includes("input.kind"), `${label} formula input must show the authored input`);
  assert(formulaInputText.includes("input.tier"), `${label} formula input must show the authored tier`);
  const before = await result.innerText();
  const control = page.getByRole("spinbutton", { name: label, exact: true });
  await control.waitFor({ state: "visible" });
  const savedValue = Number(await control.inputValue());
  assert(Number.isFinite(savedValue), `${label} example control must start with a finite number`);
  await control.fill(String(nextValue));
  await waitForResultChange(page, before);
  assert.notEqual(await result.innerText(), before, `${label} must change the local calculation`);
  await control.fill("");
  await page.getByRole("alert").filter({ hasText: /finite|whole-number/i }).first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Reset inputs", exact: true }).click();
  await page.waitForFunction(previous => {
    const result = document.querySelector(".balance-example-result > div:nth-child(2) dl");
    return result instanceof HTMLElement && result.innerText === previous;
  }, before);
  assert.equal(Number(await control.inputValue()), savedValue, `${label} reset must restore the saved number`);
}

async function exerciseLootActorExample(page: Page, recordId: string, nextValue: number): Promise<void> {
  await page.getByRole("combobox", { name: "Example record", exact: true }).selectOption(recordId);
  const result = page.locator(".balance-example-result > div").nth(1).locator("dl");
  await result.waitFor({ state: "visible" });
  const formulaInputText = await page.locator(".balance-example-result > div").first().innerText();
  assert(formulaInputText.includes("input.kind"), "actor loot formula input must show the authored input");
  assert(formulaInputText.includes("input.tier"), "actor loot formula input must show the authored tier");
  const before = await result.innerText();
  const control = page.getByRole("spinbutton", { name: "Example loot chance", exact: true });
  await control.waitFor({ state: "visible" });
  const savedValue = Number(await control.inputValue());
  assert(Number.isFinite(savedValue), "actor loot chance example must start with a finite number");
  await control.fill(String(nextValue));
  await waitForResultChange(page, before);
  assert.notEqual(await result.innerText(), before, "actor loot chance must change the local calculation");
  await control.fill("");
  await page.getByRole("alert").filter({ hasText: /finite loot chance/i }).first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Reset inputs", exact: true }).click();
  await page.waitForFunction(previous => {
    const result = document.querySelector(".balance-example-result > div:nth-child(2) dl");
    return result instanceof HTMLElement && result.innerText === previous;
  }, before);
  assert.equal(Number(await control.inputValue()), savedValue, "actor loot chance reset must restore the saved number");
}

/** Exercise the actor source and actor loot formula panels against an already-running devdocs server. */
export async function exerciseActorFormulas(page: Page, baseUrl: string): Promise<void> {
  const origin = baseUrl.replace(/\/+$/, "");
  const evidence = path.join(repoRoot, "test-results/devdocs");
  await mkdir(evidence, { recursive: true });

  const enemyBalanceUrl = `${origin}/__devdocs/collections/balance/enemies`;
  const enemyRowsUrl = `${origin}/__devdocs/collections/enemies`;
  const enemyBalanceBefore = await collection(page, enemyBalanceUrl, "enemy balance");
  const enemyRowsBeforeResponse = await collection(page, enemyRowsUrl, "enemy records");
  const enemyRowsBefore = rows(enemyRowsBeforeResponse.data, "enemy records");
  const enemyDataBefore = structuredClone(enemyBalanceBefore.data);
  const universalInputIds = inputIdsForKind(enemyDataBefore, "universal", "enemy balance");
  assert.equal(universalInputIds.size, 63, "universal actor source inputs must total 63");
  const universalEnemyIds = linkedIds(enemyRowsBefore, universalInputIds, "sourceEnemy.v1", "universal actor enemies");
  assert.equal(universalEnemyIds.size, 63, "universal actor source rows must total 63");
  for (const inputId of universalInputIds) {
    assert.equal([...enemyRowsBefore].filter(row => derivation(row).inputId === inputId).length, 1, `universal input ${inputId} must have one canonical row`);
  }

  const enemyParams = object(enemyDataBefore, "enemy balance data");
  const actorSourceParameters = object(enemyParams.actorSourceParameters, "enemy balance actorSourceParameters");
  const universalParameters = object(actorSourceParameters.universal, "enemy balance universal actor parameters");
  const savedMultiplier = universalParameters.targetLevelMultiplier;
  assert(typeof savedMultiplier === "number" && Number.isFinite(savedMultiplier) && savedMultiplier > 0, "universal multiplier must be finite and positive");
  const updatedMultiplier = savedMultiplier + 0.5;
  const enemyDataEdited = structuredClone(enemyDataBefore) as JsonObject;
  const editedActorSourceParameters = object(enemyDataEdited.actorSourceParameters, "edited actorSourceParameters");
  const editedUniversalParameters = object(editedActorSourceParameters.universal, "edited universal actor parameters");
  editedUniversalParameters.targetLevelMultiplier = updatedMultiplier;
  await saveCollection(page, enemyBalanceUrl, enemyBalanceBefore, enemyDataEdited, "enemy balance");
  const enemyRowsAfterParameterSave = rows((await collection(page, enemyRowsUrl, "enemy records after parameter save")).data, "enemy records after parameter save");
  assert.deepEqual(enemyRowsAfterParameterSave, enemyRowsBefore, "saving actor parameters must not rewrite canonical enemies");

  const universalApiPreview = await recomputePreview(page, origin, "sourceEnemy.v1");
  assert.equal(universalApiPreview.diffs.length, 63, "universal multiplier preview must have exactly 63 diffs");
  const universalDiffIds = new Set(universalApiPreview.diffs.map(diff => String(diff.recordId)));
  assert.deepEqual(sorted(universalDiffIds), sorted(universalEnemyIds), "universal preview must exclude every other enemy record");
  for (const diff of universalApiPreview.diffs) {
    assert.deepEqual(diff.inputIds, [String(derivation(enemyRowsBefore.find(row => row.id === diff.recordId)!).inputId)], "source diffs must retain their input id provenance");
  }

  await page.reload();
  await openFormula(page, origin, "balance/enemies/sourceParameters", "sourceEnemy.v1");
  assert.equal(await page.locator("#source-enemies option[value='enemyActorSources']").count(), 1, "sourceEnemy formula must expose enemyActorSources.ts");
  await previewAndApply(page, 63, path.join(evidence, "actor-source-preview.png"));

  const enemyRowsAfter = rows((await collection(page, enemyRowsUrl, "enemy records after source apply")).data, "enemy records after source apply");
  assert.deepEqual(enemyRowsAfter.map(row => row.id), enemyRowsBefore.map(row => row.id), "actor source apply must preserve canonical enemy order");
  const enemyBeforeById = new Map(enemyRowsBefore.map(row => [String(row.id), row]));
  const universalAfterById = new Map(enemyRowsAfter.map(row => [String(row.id), row]));
  const universalExpectedAfter = new Map(universalApiPreview.diffs.map(diff => [String(diff.recordId), object(diff.after, `diff after ${String(diff.recordId)}`)]));
  const changedUniversalIds = new Set<string>();
  for (const afterRow of enemyRowsAfter) {
    const id = String(afterRow.id);
    const beforeRow = enemyBeforeById.get(id);
    assert(beforeRow, `enemy ${id} must exist before apply`);
    if (!universalEnemyIds.has(id)) {
      assert.deepEqual(afterRow, beforeRow, `non-universal enemy ${id} must remain unchanged`);
      continue;
    }
    const expectedAfter = universalExpectedAfter.get(id);
    assert(expectedAfter, `universal preview must include ${id}`);
    assert.deepEqual(afterRow, { ...beforeRow, ...expectedAfter }, `universal enemy ${id} must match its reviewed diff`);
    const keys = changedKeys(beforeRow, afterRow);
    assert(keys.length > 0, `universal enemy ${id} must change after a multiplier edit`);
    assert(keys.every(key => ACTOR_ENEMY_CHANGED_FIELDS.has(key)), `universal enemy ${id} changed an authored field: ${keys.join(", ")}`);
    assert(keys.includes("maxHealth"), `universal enemy ${id} must change maxHealth with the multiplier`);
    changedUniversalIds.add(id);
  }
  assert.deepEqual(sorted(changedUniversalIds), sorted(universalEnemyIds), "exactly the 63 universal enemies must change");
  assert.equal(universalAfterById.size, enemyRowsBefore.length, "enemy rows must remain unique after actor apply");
  const enemyBalanceAfter = await collection(page, enemyBalanceUrl, "enemy balance after source apply");
  const enemyDataExpected = structuredClone(enemyDataBefore) as JsonObject;
  const expectedEnemyActorSourceParameters = object(enemyDataExpected.actorSourceParameters, "expected actorSourceParameters");
  const expectedEnemyUniversal = object(expectedEnemyActorSourceParameters.universal, "expected universal actor parameters");
  expectedEnemyUniversal.targetLevelMultiplier = updatedMultiplier;
  assert.deepEqual(enemyBalanceAfter.data, enemyDataExpected, "actor source apply must preserve every parameter except the edited multiplier");
  assert.deepEqual((await recomputePreview(page, origin, "sourceEnemy.v1")).diffs, [], "sourceEnemy must have no remaining drift after actor apply");

  const lootBalanceUrl = `${origin}/__devdocs/collections/balance/loot`;
  const lootRowsUrl = `${origin}/__devdocs/collections/lootTables`;
  const lootBalanceBefore = await collection(page, lootBalanceUrl, "loot balance");
  const lootRowsBeforeResponse = await collection(page, lootRowsUrl, "loot tables");
  const lootRowsBefore = rows(lootRowsBeforeResponse.data, "loot tables");
  const lootDataBefore = structuredClone(lootBalanceBefore.data);
  const fairyInputIds = inputIdsForKind(lootDataBefore, "fairy", "loot balance");
  assert.equal(fairyInputIds.size, 36, "fairy actor loot inputs must total 36");
  const fairyLootIds = linkedIds(lootRowsBefore, fairyInputIds, "sourceLoot.v1", "fairy actor loot");
  assert.equal(fairyLootIds.size, 36, "fairy actor loot rows must total 36");
  const lootParams = object(lootDataBefore, "loot balance data");
  const actorLootParameters = object(lootParams.actorLootParameters, "loot balance actorLootParameters");
  const fairyLootParameters = object(actorLootParameters.fairy, "fairy actor loot parameters");
  const earth = object(fairyLootParameters.earth, "fairy earth parameters");
  const earthRoll = object(earth.roll, "fairy earth roll");
  const savedEarthChance = earthRoll.chance;
  assert(typeof savedEarthChance === "number" && Number.isFinite(savedEarthChance) && savedEarthChance >= 0 && savedEarthChance <= 1, "fairy earth chance must be finite in [0, 1]");
  const updatedEarthChance = fractionChange(savedEarthChance, 0.1);
  assert.notEqual(updatedEarthChance, savedEarthChance, "fairy earth example must change the chance");
  const lootDataEdited = structuredClone(lootDataBefore) as JsonObject;
  const editedLootActorParameters = object(lootDataEdited.actorLootParameters, "edited actorLootParameters");
  const editedFairy = object(editedLootActorParameters.fairy, "edited fairy actor loot parameters");
  const editedEarth = object(editedFairy.earth, "edited fairy earth parameters");
  const editedEarthRoll = object(editedEarth.roll, "edited fairy earth roll");
  editedEarthRoll.chance = updatedEarthChance;
  await saveCollection(page, lootBalanceUrl, lootBalanceBefore, lootDataEdited, "loot balance");
  const lootRowsAfterParameterSave = rows((await collection(page, lootRowsUrl, "loot tables after parameter save")).data, "loot tables after parameter save");
  assert.deepEqual(lootRowsAfterParameterSave, lootRowsBefore, "saving actor loot parameters must not rewrite canonical loot tables");

  const fairyApiPreview = await recomputePreview(page, origin, "sourceLoot.v1");
  assert.equal(fairyApiPreview.diffs.length, 36, "fairy earth chance preview must have exactly 36 diffs");
  const fairyDiffIds = new Set(fairyApiPreview.diffs.map(diff => String(diff.recordId)));
  assert.deepEqual(sorted(fairyDiffIds), sorted(fairyLootIds), "fairy loot preview must exclude every other loot table");
  for (const diff of fairyApiPreview.diffs) {
    const beforeRow = lootRowsBefore.find(row => row.id === diff.recordId);
    assert(beforeRow, `fairy loot diff ${String(diff.recordId)} must have a source row`);
    assert.deepEqual(diff.inputIds, [String(derivation(beforeRow).inputId)], "loot diffs must retain their input id provenance");
  }

  await page.reload();
  await openFormula(page, origin, "balance/loot/sourceLoot", "sourceLoot.v1");
  assert.equal(await page.locator("#source-loot option[value='actorLoot']").count(), 1, "sourceLoot formula must expose actorLoot.ts");
  await previewAndApply(page, 36, path.join(evidence, "actor-loot-preview.png"));

  const lootRowsAfter = rows((await collection(page, lootRowsUrl, "loot tables after source apply")).data, "loot tables after source apply");
  assert.deepEqual(lootRowsAfter.map(row => row.id), lootRowsBefore.map(row => row.id), "actor loot apply must preserve canonical loot order");
  const lootBeforeById = new Map(lootRowsBefore.map(row => [String(row.id), row]));
  const changedFairyLootIds = new Set<string>();
  for (const afterRow of lootRowsAfter) {
    const id = String(afterRow.id);
    const beforeRow = lootBeforeById.get(id);
    assert(beforeRow, `loot table ${id} must exist before apply`);
    if (!fairyLootIds.has(id)) {
      assert.deepEqual(afterRow, beforeRow, `non-fairy loot table ${id} must remain unchanged`);
      continue;
    }
    assert.deepEqual(withoutKey(afterRow, "drops"), withoutKey(beforeRow, "drops"), `fairy loot table ${id} identity must remain unchanged`);
    const beforeDrops = drops(beforeRow.drops, `${id} before drops`);
    const afterDrops = drops(afterRow.drops, `${id} after drops`);
    assert.equal(afterDrops.length, beforeDrops.length, `fairy loot table ${id} drop order must remain the same length`);
    let changedEarthDrops = 0;
    for (const [index, afterDrop] of afterDrops.entries()) {
      const beforeDrop = beforeDrops[index];
      assert(beforeDrop, `${id} drop ${index} must exist before apply`);
      assert.deepEqual(withoutChance(afterDrop), withoutChance(beforeDrop), `${id} drop ${index} identity/order must remain unchanged`);
      if (afterDrop.itemId === "earth_essence") {
        assert.equal(afterDrop.chance, updatedEarthChance, `${id} earth chance must use the saved parameter`);
        assert.notEqual(afterDrop.chance, beforeDrop.chance, `${id} earth chance must change`);
        changedEarthDrops += 1;
      } else assert.equal(afterDrop.chance, beforeDrop.chance, `${id} non-earth drop chance must remain unchanged`);
    }
    assert.equal(changedEarthDrops, 1, `${id} must contain exactly one changed earth drop`);
    changedFairyLootIds.add(id);
  }
  assert.deepEqual(sorted(changedFairyLootIds), sorted(fairyLootIds), "exactly the 36 fairy/garden loot tables must change");
  const lootBalanceAfter = await collection(page, lootBalanceUrl, "loot balance after source apply");
  const lootDataExpected = structuredClone(lootDataBefore) as JsonObject;
  const expectedLootActorParameters = object(lootDataExpected.actorLootParameters, "expected actorLootParameters");
  const expectedLootFairy = object(expectedLootActorParameters.fairy, "expected fairy actor loot parameters");
  const expectedLootEarth = object(expectedLootFairy.earth, "expected fairy earth parameters");
  const expectedLootEarthRoll = object(expectedLootEarth.roll, "expected fairy earth roll");
  expectedLootEarthRoll.chance = updatedEarthChance;
  assert.deepEqual(lootBalanceAfter.data, lootDataExpected, "actor loot apply must preserve every parameter except the edited earth chance");
  assert.deepEqual((await recomputePreview(page, origin, "sourceLoot.v1")).diffs, [], "sourceLoot must have no remaining drift after actor apply");

  const localEnemyBaseline = await collection(page, enemyRowsUrl, "enemy rows before local examples");
  const localEnemyBalanceBaseline = await collection(page, enemyBalanceUrl, "enemy balance before local examples");
  const localLootBaseline = await collection(page, lootRowsUrl, "loot rows before local examples");
  const localLootBalanceBaseline = await collection(page, lootBalanceUrl, "loot balance before local examples");
  const sourceInputByKind = new Map<string, string>();
  for (const kind of ["universal", "fairy", "garden"]) {
    const ids = inputIdsForKind(localEnemyBalanceBaseline.data, kind, "enemy balance local examples");
    assert(ids.size > 0, `${kind} local example needs a source input`);
    const id = [...ids].find(inputId => enemyRowsBefore.some(row => derivation(row).inputId === inputId));
    assert(id, `${kind} local example needs a linked canonical enemy`);
    sourceInputByKind.set(kind, id);
  }
  const canonicalEnemyForInput = (inputId: string): string => {
    const row = enemyRowsBefore.find(candidate => derivation(candidate).inputId === inputId);
    assert(row, `canonical enemy for ${inputId} must exist`);
    return String(row.id);
  };
  await openFormula(page, origin, "balance/enemies/sourceParameters", "sourceEnemy.v1");
  await exerciseEnemyActorExample(page, origin, canonicalEnemyForInput(sourceInputByKind.get("universal")!), "Example target level multiplier", updatedMultiplier + 0.5);
  await exerciseEnemyActorExample(page, origin, canonicalEnemyForInput(sourceInputByKind.get("fairy")!), "Example template health", 80);
  await exerciseEnemyActorExample(page, origin, canonicalEnemyForInput(sourceInputByKind.get("garden")!), "Example template health", 80);
  await page.locator("[data-sonner-toast]").last().waitFor({ state: "hidden", timeout: 15_000 });
  await page.locator(".balance-example").screenshot({ path: path.join(evidence, "actor-source-examples.png") });

  const lootInputByKind = new Map<string, string>();
  for (const kind of ["fairy", "universalJewelry"]) {
    const ids = inputIdsForKind(localLootBalanceBaseline.data, kind, "loot balance local examples");
    assert(ids.size > 0, `${kind} local loot example needs a source input`);
    const id = [...ids].find(inputId => lootRowsBefore.some(row => derivation(row).inputId === inputId));
    assert(id, `${kind} local loot example needs a linked canonical loot table`);
    lootInputByKind.set(kind, id);
  }
  const canonicalLootForInput = (inputId: string): string => {
    const row = lootRowsBefore.find(candidate => derivation(candidate).inputId === inputId);
    assert(row, `canonical loot table for ${inputId} must exist`);
    return String(row.id);
  };
  await openFormula(page, origin, "balance/loot/sourceLoot", "sourceLoot.v1");
  const fairyLocalChance = updatedEarthChance;
  await exerciseLootActorExample(page, canonicalLootForInput(lootInputByKind.get("fairy")!), fractionChange(fairyLocalChance));
  const universalJewelryParameters = object(object(localLootBalanceBaseline.data, "loot local data").actorLootParameters, "local actor loot parameters");
  const universalJewelry = object(universalJewelryParameters.universalJewelry, "local universal jewelry parameters");
  const universalJewelryChance = universalJewelry.totalChance;
  assert(typeof universalJewelryChance === "number" && Number.isFinite(universalJewelryChance), "universal jewelry chance must be finite");
  await exerciseLootActorExample(page, canonicalLootForInput(lootInputByKind.get("universalJewelry")!), fractionChange(universalJewelryChance));
  await page.locator("[data-sonner-toast]").last().waitFor({ state: "hidden", timeout: 15_000 });
  await page.locator(".balance-example").screenshot({ path: path.join(evidence, "actor-loot-examples.png") });

  await page.goto(`${origin}/#/lootTables/${encodeURIComponent(canonicalLootForInput(lootInputByKind.get("fairy")!))}`);
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await page.getByText("Formula-controlled fields are read only.", { exact: false }).waitFor();
  assert.equal(await page.locator(".entity-editor [role=alert]").count(), 0, "loot editor must load crafting-tier dependencies before protecting formula fields");

  assert.deepEqual((await collection(page, enemyRowsUrl, "enemy rows after local examples")).data, localEnemyBaseline.data, "enemy local examples must not write canonical rows");
  assert.deepEqual((await collection(page, enemyBalanceUrl, "enemy balance after local examples")).data, localEnemyBalanceBaseline.data, "enemy local examples must not write parameters");
  assert.deepEqual((await collection(page, lootRowsUrl, "loot rows after local examples")).data, localLootBaseline.data, "loot local examples must not write canonical rows");
  assert.deepEqual((await collection(page, lootBalanceUrl, "loot balance after local examples")).data, localLootBalanceBaseline.data, "loot local examples must not write parameters");
}
