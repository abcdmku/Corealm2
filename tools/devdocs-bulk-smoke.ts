import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { repoRoot } from "./lib/paths.js";

type Row = Record<string, unknown>;

interface CollectionResponse {
  revision: string;
  data: unknown;
}

interface MetaResponse {
  revision: string;
  data: Row;
}

interface BulkResponse {
  collection: string;
  recordIds: string[];
  action: Row;
  revisions: { content: string; meta?: string };
  diffs: Row[];
}

/** The bulk panel's choices are segment strips: a group of radios named by the group. */
async function choose(scope: Locator, group: string, option: string): Promise<void> {
  await scope.getByRole("group", { name: group, exact: true }).getByRole("radio", { name: option, exact: true }).click();
}

function object(value: unknown, message: string): Row {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), message);
  return value as Row;
}

function rows(value: unknown, message: string): Row[] {
  assert(Array.isArray(value), message);
  return value.map((row, index) => object(row, `${message} row ${index} must be an object`));
}

function rowId(row: Row): string {
  if (typeof row.id !== "string") throw new Error("every item row must expose a string id");
  return row.id;
}

function ownsNumericTier(row: Row): boolean {
  return Object.hasOwn(row, "tier") && typeof row.tier === "number" && Number.isFinite(row.tier);
}

function removeKeys(row: Row, keys: ReadonlySet<string>): Row {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.has(key)));
}

async function collection(page: Page, origin: string): Promise<{ revision: string; rows: Row[] }> {
  const response = await page.request.get(`${origin}/__devdocs/collections/items`);
  assert.equal(response.status(), 200, "items collection API must be available for the bulk fixture");
  const payload = object(await response.json(), "items collection response must be an object") as unknown as CollectionResponse;
  assert.equal(typeof payload.revision, "string", "items collection response must expose a revision");
  return { revision: payload.revision, rows: rows(payload.data, "items collection response must expose array data") };
}

async function metadata(page: Page, origin: string, id: string): Promise<MetaResponse> {
  const url = `${origin}/__devdocs/meta/items/${encodeURIComponent(id)}`;
  const response = await page.request.get(url);
  assert.equal(response.status(), 200, `metadata API must expose ${id}`);
  const payload = object(await response.json(), `${id} metadata response must be an object`) as unknown as MetaResponse;
  assert.equal(typeof payload.revision, "string", `${id} metadata response must expose a revision`);
  return { revision: payload.revision, data: object(payload.data, `${id} metadata response must expose data`) };
}

function bulkResponse(value: unknown): BulkResponse {
  const payload = object(value, "bulk response must be an object");
  assert.equal(typeof payload.collection, "string");
  assert(Array.isArray(payload.recordIds), "bulk response must expose record ids");
  assert(payload.recordIds.every(id => typeof id === "string"), "bulk response record ids must be strings");
  assert(object(payload.action, "bulk response must expose action"));
  const revisions = object(payload.revisions, "bulk response must expose revisions");
  assert.equal(typeof revisions.content, "string");
  assert(Array.isArray(payload.diffs), "bulk response must expose diffs");
  return payload as unknown as BulkResponse;
}

function requestOperation(response: { request(): { method(): string; postDataJSON(): unknown } }, operation: "preview" | "apply"): boolean {
  const request = response.request();
  if (request.method() !== "POST") return false;
  try {
    return object(request.postDataJSON(), "bulk request must be JSON").operation === operation;
  } catch {
    return false;
  }
}

async function waitForBulkResponse(page: Page, operation: "preview" | "apply"): Promise<{ response: Awaited<ReturnType<Page["waitForResponse"]>>; body: unknown }> {
  const response = await page.waitForResponse(candidate => candidate.url().endsWith("/__devdocs/bulk") && requestOperation(candidate, operation), { timeout: 20_000 });
  return { response, body: await response.json().catch(() => ({})) };
}

async function selectRecords(page: Page, ids: readonly string[]): Promise<void> {
  const search = page.getByRole("textbox", { name: "Search items", exact: true });
  for (const id of ids) {
    await search.fill(id);
    const checkbox = page.getByRole("checkbox", { name: `Select record ${id}`, exact: true });
    await checkbox.waitFor({ state: "visible", timeout: 20_000 });
    await checkbox.check();
  }
  const selection = page.locator(".collection-selection-status");
  await selection.filter({ hasText: `${ids.length} selected` }).waitFor({ state: "visible", timeout: 20_000 });
  if (ids.length > 1) {
    await selection.filter({ hasText: `${ids.length} selected, ${ids.length - 1} hidden by filter` }).waitFor({ state: "visible", timeout: 20_000 });
  }
}

async function panel(page: Page): Promise<ReturnType<Page["locator"]>> {
  const value = page.locator(".bulk-actions");
  await value.waitFor({ state: "visible", timeout: 20_000 });
  await value.getByRole("heading", { name: "Bulk actions", exact: true }).waitFor({ state: "visible" });
  return value;
}

async function waitForLastToast(page: Page): Promise<void> {
  const toast = page.locator("[data-sonner-toast]").last();
  if (await toast.count()) await toast.waitFor({ state: "hidden", timeout: 15_000 });
}

async function preview(page: Page, bulkPanel: Awaited<ReturnType<typeof panel>>, expectedIds: readonly string[], expectedAction: Row): Promise<BulkResponse> {
  const button = bulkPanel.getByRole("button", { name: /^(Preview changes|Refresh preview)$/ });
  await button.waitFor({ state: "visible" });
  const pending = waitForBulkResponse(page, "preview");
  await button.click();
  const result = await pending;
  assert.equal(result.response.status(), 200, "bulk preview must succeed");
  const payload = bulkResponse(result.body);
  assert.equal(payload.collection, "items");
  assert.deepEqual(new Set(payload.recordIds), new Set(expectedIds), "bulk preview must include every selected id");
  assert.deepEqual(payload.action, expectedAction, "bulk preview must carry the reviewed action");
  return payload;
}

async function apply(page: Page, bulkPanel: Awaited<ReturnType<typeof panel>>, expectedIds: readonly string[]): Promise<BulkResponse> {
  const button = bulkPanel.getByRole("button", { name: "Apply reviewed changes", exact: true });
  await button.waitFor({ state: "visible" });
  assert.equal(await button.isDisabled(), false, "a changed bulk preview must enable apply");
  const pending = waitForBulkResponse(page, "apply");
  await button.click();
  const result = await pending;
  assert.equal(result.response.status(), 200, "bulk apply must succeed");
  const payload = bulkResponse(result.body);
  assert.deepEqual(new Set(payload.recordIds), new Set(expectedIds), "bulk apply must include every selected id");
  await page.locator(".bulk-actions").waitFor({ state: "detached", timeout: 20_000 });
  return payload;
}

async function assertMetadataStatus(page: Page, origin: string, ids: readonly string[], expected: string): Promise<void> {
  for (const id of ids) assert.equal((await metadata(page, origin, id)).data.status, expected, `${id} status must persist in metadata`);
}

async function assertMetadataNote(page: Page, origin: string, ids: readonly string[], text: string, label: string): Promise<void> {
  for (const id of ids) {
    const record = await metadata(page, origin, id);
    const notes = record.data.notes;
    assert(Array.isArray(notes), `${id} metadata must expose notes`);
    const note = notes.map(value => object(value, `${id} metadata note must be an object`)).find(value => value.text === text);
    assert(note, `${id} metadata must contain the shared note`);
    assert.equal(note.label, label, `${id} shared note must retain its label`);
  }
}

function assertContentRowsUnchanged(before: readonly Row[], after: readonly Row[], message: string): void {
  assert.deepEqual(after.map(rowId), before.map(rowId), `${message}: ids and order must remain unchanged`);
  const afterById = new Map(after.map(row => [rowId(row), row]));
  for (const oldRow of before) {
    const nextRow = afterById.get(rowId(oldRow));
    assert(nextRow, `${message}: ${rowId(oldRow)} must remain present`);
    assert.deepEqual(nextRow, oldRow, `${message}: ${rowId(oldRow)} fields must remain unchanged`);
  }
}

/** Exercise the mounted bulk editor against the live DevDocs page. */
export async function exerciseBulkEditor(page: Page, baseUrl: string): Promise<void> {
  const origin = baseUrl.replace(/\/+$/, "");
  const evidence = path.join(repoRoot, "test-results/devdocs");
  await mkdir(evidence, { recursive: true });
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 1100 });

  const initial = await collection(page, origin);
  const formulaRow = initial.rows.find(row => ownsNumericTier(row) && row.tier !== 2 && Object.hasOwn(row, "derivation"));
  assert(formulaRow, "bulk fixture needs an item with an owned numeric tier and formula tag");
  const formulaId = rowId(formulaRow);
  const ownedRow = initial.rows.find(row => {
    if (!ownsNumericTier(row)) return false;
    const id = rowId(row);
    return row.tier !== 2 && id !== formulaId && !formulaId.includes(id) && !id.includes(formulaId);
  });
  assert(ownedRow, "bulk fixture needs a second item with an owned numeric tier");
  const ownedId = rowId(ownedRow);
  const ids = [formulaId, ownedId] as const;
  assert(ids.every(id => initial.rows.some(row => rowId(row) === id)), "bulk fixture ids must exist in the live collection");

  await page.goto(`${origin}/#/items`);
  await page.getByRole("grid", { name: "Items", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await selectRecords(page, ids);
  const statusPanel = await panel(page);
  await choose(statusPanel, "Bulk action", "Set status");
  await choose(statusPanel, "New status", "Candidate");
  const statusAction = { kind: "status", status: "candidate" };
  const statusPreview = await preview(page, statusPanel, ids, statusAction);
  assert.equal(statusPreview.diffs.length, ids.length, "status preview must show both selected rows");
  await waitForLastToast(page);
  await page.screenshot({ path: path.join(evidence, "bulk-editor-desktop.png"), fullPage: true });
  await apply(page, statusPanel, ids);
  await assertMetadataStatus(page, origin, ids, "candidate");

  const afterStatus = await collection(page, origin);
  assertContentRowsUnchanged(initial.rows, afterStatus.rows, "status metadata apply");

  await selectRecords(page, ids);
  const notePanel = await panel(page);
  await choose(notePanel, "Bulk action", "Add note");
  const sharedNote = "Bulk smoke shared note";
  const sharedLabel = "bulk smoke";
  await notePanel.locator("textarea").fill(sharedNote);
  await notePanel.locator('input[placeholder="For example, art review"]').fill(sharedLabel);
  const notePreview = await preview(page, notePanel, ids, { kind: "note", text: sharedNote, label: sharedLabel });
  assert.equal(notePreview.diffs.length, ids.length, "note preview must show both selected rows");
  await apply(page, notePanel, ids);
  await assertMetadataNote(page, origin, ids, sharedNote, sharedLabel);

  const beforeRetier = await collection(page, origin);
  assert.deepEqual(beforeRetier.rows.map(rowId), initial.rows.map(rowId), "metadata actions must preserve item ids and order");
  const retierBeforeById = new Map(beforeRetier.rows.map(row => [rowId(row), row]));
  assert(ownsNumericTier(retierBeforeById.get(formulaId)!), "formula fixture row must still own a numeric tier");
  assert(ownsNumericTier(retierBeforeById.get(ownedId)!), "second fixture row must still own a numeric tier");

  await selectRecords(page, ids);
  const retierPanel = await panel(page);
  await choose(retierPanel, "Bulk action", "Retier");
  const retierOption = retierPanel.locator('option[value="retier"]');
  assert.equal(await retierOption.isDisabled(), false, "retier must remain enabled for owned numeric tiers");
  await retierPanel.locator('input[type="number"]').fill("2");
  assert((await retierPanel.getByText(/1 formula linked/).count()) > 0, "retier panel must count the formula-linked selection");
  const unlink = retierPanel.getByRole("checkbox", { name: "Keep other values and unlink formulas", exact: true });
  assert.equal(await unlink.isChecked(), false, "formula unlink must be an explicit opt-in");
  await unlink.check();
  assert.equal(await unlink.isChecked(), true, "formula unlink must be checked before preview");
  const retierAction = { kind: "retier", tier: 2, unlinkFormulas: true };
  const retierPreview = await preview(page, retierPanel, ids, retierAction);
  assert.equal(retierPreview.diffs.length, ids.length, "retier preview must include both selected rows");
  await apply(page, retierPanel, ids);

  const afterRetier = await collection(page, origin);
  assert.deepEqual(afterRetier.rows.map(rowId), beforeRetier.rows.map(rowId), "retier must preserve item ids and order");
  const afterRetierById = new Map(afterRetier.rows.map(row => [rowId(row), row]));
  const changedKeys = new Set(["tier", "derivation"]);
  for (const beforeRow of beforeRetier.rows) {
    const id = rowId(beforeRow);
    const afterRow = afterRetierById.get(id);
    assert(afterRow, `${id} must remain after retier`);
    assert.deepEqual(removeKeys(afterRow, changedKeys), removeKeys(beforeRow, changedKeys), `${id} fields outside tier and formula tag must remain unchanged`);
    if (ids.includes(id)) {
      assert.equal(afterRow.tier, 2, `${id} must receive the requested tier`);
      if (id === formulaId) assert.equal(Object.hasOwn(afterRow, "derivation"), false, `${id} formula tag must be unlinked explicitly`);
      else assert.equal(Object.hasOwn(afterRow, "derivation"), Object.hasOwn(beforeRow, "derivation"), `${id} non-formula fields must remain stable`);
    } else assert.deepEqual(afterRow, beforeRow, `${id} unselected row must remain unchanged`);
  }

  await selectRecords(page, ids);
  const conflictPanel = await panel(page);
  await choose(conflictPanel, "Bulk action", "Add note");
  const conflictDraft = "Bulk smoke conflict draft";
  const conflictLabel = "conflict fixture";
  await conflictPanel.locator("textarea").fill(conflictDraft);
  await conflictPanel.locator('input[placeholder="For example, art review"]').fill(conflictLabel);
  await preview(page, conflictPanel, ids, { kind: "note", text: conflictDraft, label: conflictLabel });

  const concurrentId = ids[0];
  const concurrentMetadata = await metadata(page, origin, concurrentId);
  const concurrentNote = "Bulk smoke concurrent note";
  const concurrentWrite = await page.request.patch(`${origin}/__devdocs/meta/items/${encodeURIComponent(concurrentId)}`, {
    data: { revision: concurrentMetadata.revision, operation: { kind: "note", text: concurrentNote, label: conflictLabel } },
  });
  assert.equal(concurrentWrite.status(), 200, "concurrent metadata write must establish a stale bulk revision");
  const applyButton = conflictPanel.getByRole("button", { name: "Apply reviewed changes", exact: true });
  const conflictPending = waitForBulkResponse(page, "apply");
  await applyButton.click();
  const conflictResult = await conflictPending;
  assert.equal(conflictResult.response.status(), 409, "stale bulk apply must report a conflict");
  await conflictPanel.getByRole("alert").filter({ hasText: "changed after this preview" }).waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(await conflictPanel.locator("textarea").inputValue(), conflictDraft, "bulk conflict must preserve the note draft");
  assert.equal(await conflictPanel.locator('input[placeholder="For example, art review"]').inputValue(), conflictLabel, "bulk conflict must preserve the label draft");
  assert.equal(await applyButton.isDisabled(), true, "stale bulk preview must disable apply until refreshed");
  await page.locator(".collection-selection-status").filter({ hasText: `${ids.length} selected, ${ids.length - 1} hidden by filter` }).waitFor({ state: "visible" });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, "bulk editor must fit a 390px viewport");
  await waitForLastToast(page);
  await page.screenshot({ path: path.join(evidence, "bulk-editor-mobile.png"), fullPage: true });

  const refreshPreview = conflictPanel.getByRole("button", { name: "Refresh preview", exact: true });
  const refreshed = waitForBulkResponse(page, "preview");
  await refreshPreview.click();
  const refreshedResult = await refreshed;
  assert.equal(refreshedResult.response.status(), 200, "bulk conflict recovery must require and allow a fresh preview");
  assert.equal(await applyButton.isDisabled(), false, "fresh bulk preview must re-enable apply");
  await apply(page, conflictPanel, ids);
  await assertMetadataNote(page, origin, ids, conflictDraft, conflictLabel);
  const concurrentAfter = await metadata(page, origin, concurrentId);
  assert((concurrentAfter.data.notes as unknown[]).some(note => object(note, "concurrent note must be an object").text === concurrentNote), "fresh preview apply must preserve the concurrent note");

  await page.setViewportSize(originalViewport ?? { width: 1440, height: 1100 });
  await page.getByRole("textbox", { name: "Search items", exact: true }).fill("");
  await page.getByRole("grid", { name: "Items", exact: true }).waitFor({ state: "visible" });
}
