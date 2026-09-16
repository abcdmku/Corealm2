import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { repoRoot } from "./lib/paths.js";

const PIECE_SLOTS = ["head", "body", "legs", "hands", "feet"] as const;
type PieceSlot = (typeof PIECE_SLOTS)[number];

interface EquipmentSetRow {
  id: string;
  name?: string;
  members: Record<PieceSlot, string>;
}

interface CollectionResponse {
  revision: string;
  data: unknown;
}

interface MetaPiece {
  note?: string;
  status?: string;
}

interface MetaResponse {
  revision: string;
  data: {
    pieces?: Record<string, MetaPiece>;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fiveMemberSet(value: unknown): EquipmentSetRow | undefined {
  if (!isObject(value) || typeof value.id !== "string" || !isObject(value.members)) return undefined;
  const members = {} as Record<PieceSlot, string>;
  for (const slot of PIECE_SLOTS) {
    const itemId = value.members[slot];
    if (typeof itemId !== "string" || !itemId) return undefined;
    members[slot] = itemId;
  }
  return {
    id: value.id,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    members,
  };
}

function metaEndpoint(baseUrl: string, recordId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/__devdocs/meta/equipmentSets/${encodeURIComponent(recordId)}`;
}

/** Exercise the mounted equipment-set piece editor against a live devdocs page. */
export async function exerciseSetPiecePanel(page: Page, baseUrl: string): Promise<void> {
  const origin = baseUrl.replace(/\/+$/, "");
  const collectionUrl = `${origin}/__devdocs/collections/equipmentSets`;
  const collectionResponse = await page.request.get(collectionUrl);
  assert.equal(collectionResponse.status(), 200, "equipment-set collection API must be available");
  const collection = await collectionResponse.json() as CollectionResponse;
  assert.equal(typeof collection.revision, "string", "equipment-set collection API must expose a revision");
  assert(Array.isArray(collection.data), "equipment-set collection API must expose array data");
  const set = (collection.data as unknown[]).map(fiveMemberSet).find((row): row is EquipmentSetRow => Boolean(row));
  assert(set, "fixture needs a real equipment set with all five armor slots");

  const metadataUrl = metaEndpoint(origin, set.id);
  await page.goto(`${origin}/#/equipmentSets/${encodeURIComponent(set.id)}`);
  const panel = page.locator(".set-piece-panel");
  await panel.waitFor({ state: "visible", timeout: 30_000 });
  await page.getByRole("heading", { name: "Armor pieces", exact: true }).waitFor({ state: "visible" });

  const links = panel.locator(".set-piece-item-link");
  assert.equal(await links.count(), PIECE_SLOTS.length, "set-piece panel must render all five member links");
  for (const [index, slot] of PIECE_SLOTS.entries()) {
    assert.equal(
      await links.nth(index).getAttribute("href"),
      `#/items/${encodeURIComponent(set.members[slot])}`,
      `${slot} link must target its saved item member`,
    );
  }

  const rows = panel.locator(".set-piece-row");
  assert.equal(await rows.count(), PIECE_SLOTS.length, "set-piece panel must render one review row per armor slot");
  const headRow = rows.nth(0);
  // Status is a segment strip: one radio per status.
  const statusGroup = headRow.getByRole("group", { name: /status$/i });
  const status = {
    selectOption: (value: string) => statusGroup.getByRole("radio", { name: value.charAt(0).toUpperCase() + value.slice(1), exact: true }).click(),
    inputValue: async () => (await statusGroup.getByRole("radio", { checked: true }).textContent() ?? "").trim().toLowerCase(),
  };
  const note = headRow.getByRole("textbox");
  const save = headRow.getByRole("button", { name: "Save piece", exact: true });
  const savedNote = `Smoke review for ${set.id} head`;
  await status.selectOption("candidate");
  await note.fill(savedNote);

  const firstSave = page.waitForResponse(response => response.url() === metadataUrl && response.request().method() === "PATCH", { timeout: 15_000 });
  const firstRefresh = page.waitForResponse(response => response.url() === metadataUrl && response.request().method() === "GET", { timeout: 15_000 });
  await save.click();
  const [firstSaveResponse] = await Promise.all([firstSave, firstRefresh]);
  assert.equal(firstSaveResponse.status(), 200, "piece save must succeed through the browser control");

  const savedMetaResponse = await page.request.get(metadataUrl);
  assert.equal(savedMetaResponse.status(), 200, "saved piece metadata must remain readable");
  const savedMeta = await savedMetaResponse.json() as MetaResponse;
  assert.equal(savedMeta.data.pieces?.head?.note, savedNote, "saved note must persist in metadata");
  assert.equal(savedMeta.data.pieces?.head?.status, "candidate", "saved status must persist in metadata");
  const contentAfterSaveResponse = await page.request.get(collectionUrl);
  assert.equal(contentAfterSaveResponse.status(), 200);
  const contentAfterSave = await contentAfterSaveResponse.json() as CollectionResponse;
  assert.equal(contentAfterSave.revision, collection.revision, "metadata saves must not change the content collection revision");

  const draftNote = `Draft survives conflict for ${set.id}`;
  await status.selectOption("rejected");
  await note.fill(draftNote);
  const concurrentSlot = PIECE_SLOTS[1];
  const staleRevisionResponse = await page.request.get(metadataUrl);
  assert.equal(staleRevisionResponse.status(), 200);
  const staleMeta = await staleRevisionResponse.json() as MetaResponse;
  const concurrentResponse = await page.request.patch(metadataUrl, {
    data: {
      revision: staleMeta.revision,
      operation: { kind: "piece", slot: concurrentSlot, note: `Concurrent smoke update for ${set.id}` },
    },
  });
  assert.equal(concurrentResponse.status(), 200, "concurrent metadata write must establish the stale revision");
  const concurrentMeta = await concurrentResponse.json() as MetaResponse;
  assert.notEqual(concurrentMeta.revision, staleMeta.revision, "concurrent metadata write must advance the metadata revision");

  const conflictSave = page.waitForResponse(response => response.url() === metadataUrl && response.request().method() === "PATCH", { timeout: 15_000 });
  await save.click();
  const conflictResponse = await conflictSave;
  assert.equal(conflictResponse.status(), 409, "stale piece save must report a metadata conflict");
  const conflictPayload = conflictResponse.request().postDataJSON() as { revision?: unknown };
  assert.equal(conflictPayload.revision, staleMeta.revision, "the browser must submit the revision that became stale");
  await panel.getByRole("alert").filter({ hasText: "This metadata changed elsewhere" }).waitFor({ state: "visible" });
  assert.equal(await note.inputValue(), draftNote, "a conflict must preserve the unsaved note");
  assert.equal(await status.inputValue(), "rejected", "a conflict must preserve the unsaved status");
  assert.equal(await save.isDisabled(), true, "conflict state must pause further writes until reload");
  const evidence = path.join(repoRoot, "test-results/devdocs");
  await mkdir(evidence, { recursive: true });
  await page.locator("[data-sonner-toast]").last().waitFor({ state: "hidden", timeout: 15_000 });
  await page.screenshot({ path: path.join(evidence, "set-piece-conflict.png"), fullPage: true });

  const reloadResponse = page.waitForResponse(response => response.url() === metadataUrl && response.request().method() === "GET", { timeout: 15_000 });
  await panel.getByRole("button", { name: "Reload metadata", exact: true }).click();
  await reloadResponse;
  await page.waitForFunction(() => {
    const button = document.querySelector(".set-piece-row .set-piece-save");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  assert.equal(await note.inputValue(), draftNote, "reloading metadata must keep the unsaved note draft");
  assert.equal(await status.inputValue(), "rejected", "reloading metadata must keep the unsaved status draft");

  const finalSave = page.waitForResponse(response => response.url() === metadataUrl && response.request().method() === "PATCH", { timeout: 15_000 });
  const finalRefresh = page.waitForResponse(response => response.url() === metadataUrl && response.request().method() === "GET", { timeout: 15_000 });
  await save.click();
  const [finalSaveResponse] = await Promise.all([finalSave, finalRefresh]);
  assert.equal(finalSaveResponse.status(), 200, "draft must save after reloading a conflict");

  const finalMetaResponse = await page.request.get(metadataUrl);
  assert.equal(finalMetaResponse.status(), 200);
  const finalMeta = await finalMetaResponse.json() as MetaResponse;
  assert.equal(finalMeta.data.pieces?.head?.note, draftNote, "draft note must persist after conflict recovery");
  assert.equal(finalMeta.data.pieces?.head?.status, "rejected", "draft status must persist after conflict recovery");
  assert.equal(finalMeta.data.pieces?.[concurrentSlot]?.note, `Concurrent smoke update for ${set.id}`, "conflict recovery must preserve the concurrent piece update");
  const finalContentResponse = await page.request.get(collectionUrl);
  assert.equal(finalContentResponse.status(), 200);
  const finalContent = await finalContentResponse.json() as CollectionResponse;
  assert.equal(finalContent.revision, collection.revision, "piece metadata writes must leave content JSON unchanged");
  await page.locator("[data-sonner-toast]").last().waitFor({ state: "hidden", timeout: 15_000 });
  await page.screenshot({ path: path.join(evidence, "set-piece-panel.png"), fullPage: true });
}
