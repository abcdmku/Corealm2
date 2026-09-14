import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import rawSets from "../game/content/data/equipmentSets.json";
import rawProgression from "../game/content/data/progression.json";
import rawBalance from "../game/content/data/balance/sets.json";
import { createMetaHandler, isMetaPath, type MetaHandler, type MetaResponse } from "../devdocs/server/handlers/meta.js";
import type { DevdocsJsonResponse } from "../devdocs/server/handlers/collections.js";
import { contentRevision } from "../tools/content/format.js";
import { emptyMetaRecord, type MetaFile } from "../tools/content/meta.js";

const at = "2026-09-13T12:00:00.000Z";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function body<T>(response: DevdocsJsonResponse | undefined): T {
  if (!response) throw new Error("Expected response");
  return JSON.parse(response.body) as T;
}
async function fixture(): Promise<{ root: string; handler: MetaHandler }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "corealm-devdocs-meta-"));
  roots.push(root);
  await mkdir(path.join(root, "data", "balance"), { recursive: true });
  await writeFile(path.join(root, "data", "shops.json"), JSON.stringify([
    { id: "shop", name: "Test Shop", buyMultiplier: 1, sellMultiplier: 0.5, stock: [] },
    { id: "other", name: "Other Shop", buyMultiplier: 1, sellMultiplier: 0.5, stock: [] },
    { id: "__proto__", name: "Unusual Shop", buyMultiplier: 1, sellMultiplier: 0.5, stock: [] },
  ]));
  await writeFile(path.join(root, "data", "equipmentSets.json"), JSON.stringify(rawSets));
  await writeFile(path.join(root, "data", "progression.json"), JSON.stringify(rawProgression));
  await writeFile(path.join(root, "data", "balance", "sets.json"), JSON.stringify(rawBalance));
  return { root, handler: createMetaHandler({ contentRoot: root, actor: "Borg", now: () => at }) };
}
const url = "/__devdocs/meta/shops/shop";
async function get(handler: MetaHandler, target = url): Promise<MetaResponse> {
  const result = await handler({ url: target });
  expect(result?.status).toBe(200);
  return body<MetaResponse>(result);
}
async function patch(handler: MetaHandler, revision: string, operation: unknown, target = url) {
  return handler({ method: "PATCH", url: target, body: { revision, operation } });
}

describe("devdocs metadata handler", () => {
  it("reads defaults without creating files, appends notes, and writes only inside its content root", async () => {
    const { root, handler } = await fixture();
    const first = await get(handler);
    expect(first).toEqual({ collection: "shops", entityId: "shop", revision: contentRevision("{}\n"), data: emptyMetaRecord() });
    await expect(readFile(path.join(root, "meta", "shops.meta.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const added = await patch(handler, first.revision, { kind: "note", text: "First note", label: "review" });
    expect(added?.status).toBe(200);
    const second = body<MetaResponse>(added);
    expect(second.data.notes).toEqual([{ by: "Borg", at, text: "First note", label: "review" }]);
    const third = body<MetaResponse>(await patch(handler, second.revision, { kind: "note", text: "Second note" }));
    expect(third.data.notes.map(note => note.text)).toEqual(["First note", "Second note"]);
    expect(third.data.history.map(row => row.action)).toEqual(["note.add", "note.add"]);
    const stored = await readFile(path.join(root, "meta", "shops.meta.json"), "utf8");
    expect(contentRevision(stored)).toBe(third.revision);
    expect(JSON.parse(stored).shop).toEqual(third.data);
    expect(await readdir(path.join(root, "meta"))).toEqual(["shops.meta.json"]);
    expect(JSON.parse(await readFile(path.join(root, "data", "shops.json"), "utf8"))[0].name).toBe("Test Shop");
  });

  it("serializes independent handler instances and refuses stale writes across the whole collection", async () => {
    const { root, handler } = await fixture();
    const sibling = createMetaHandler({ contentRoot: root, actor: "Other user", now: () => at });
    const first = await get(handler);
    const results = await Promise.all([
      patch(handler, first.revision, { kind: "note", text: "Writer one" }),
      patch(sibling, first.revision, { kind: "note", text: "Writer two" }, "/__devdocs/meta/shops/other"),
    ]);
    expect(results.map(result => result!.status).sort()).toEqual([200, 409]);
    const stored = JSON.parse(await readFile(path.join(root, "meta", "shops.meta.json"), "utf8")) as MetaFile;
    expect(Object.values(stored).flatMap(row => row.notes)).toHaveLength(1);
    const stale = results.find(result => result!.status === 409)!;
    expect(body<{ revision: string }>(stale).revision).toBe(contentRevision(await readFile(path.join(root, "meta", "shops.meta.json"), "utf8")));
    expect(await readdir(path.join(root, "meta"))).toEqual(["shops.meta.json"]);
  });

  it("opens requests with generated authors and closes only requests on the selected entity", async () => {
    const { handler } = await fixture();
    const initial = await get(handler);
    const opened = body<MetaResponse>(await patch(handler, initial.revision, {
      kind: "request.open", requestId: "fix-shop", requestKind: "text", text: "Change greeting", label: "shop copy",
    }));
    expect(opened.data.notes[0]).toMatchObject({ by: "Borg", at, label: "shop copy", request: { id: "fix-shop", state: "open" } });
    expect((await patch(handler, opened.revision, { kind: "request.open", requestId: "fix-shop", requestKind: "art", text: "Duplicate" }))?.status).toBe(400);
    expect((await patch(handler, opened.revision, { kind: "request.close", requestId: "fix-shop" }, "/__devdocs/meta/shops/other"))?.status).toBe(404);
    const closed = body<MetaResponse>(await patch(handler, opened.revision, { kind: "request.close", requestId: "fix-shop" }));
    expect(closed.data.notes[0]!.request).toMatchObject({ state: "closed", closedAt: at });
    expect(closed.data.history.map(row => row.action)).toEqual(["request.open", "request.close"]);
    const same = body<MetaResponse>(await patch(handler, closed.revision, { kind: "request.close", requestId: "fix-shop" }));
    expect(same).toEqual(closed);
  });

  it("allows authoring status and set-piece notes while preserving approval and candidate state", async () => {
    const { root, handler } = await fixture();
    await mkdir(path.join(root, "meta"));
    const live = { ...emptyMetaRecord("live"), approvals: { male: true, female: true }, candidates: [{
      candidateId: "live-candidate", kind: "glb", sha256: "a".repeat(64), file: "art/candidates/test.glb", bytes: 12,
      status: "live", uploadedAt: at, approvedAt: at, promotedAt: at, approvals: { male: true, female: true },
    }] };
    await writeFile(path.join(root, "meta", "equipmentSets.meta.json"), JSON.stringify({ duskguard: live }));
    const target = "/__devdocs/meta/equipmentSets/duskguard";
    const first = await get(handler, target);
    const changed = body<MetaResponse>(await patch(handler, first.revision, { kind: "status", status: "candidate" }, target));
    expect(changed.data.status).toBe("candidate");
    expect(changed.data.candidates).toEqual(live.candidates);
    expect(changed.data.approvals).toEqual(live.approvals);
    const piece = body<MetaResponse>(await patch(handler, changed.revision, { kind: "piece", slot: "body", note: "Check trim", status: "draft" }, target));
    expect(piece.data.pieces).toEqual({ body: { note: "Check trim", status: "draft" } });
    expect((await patch(handler, piece.revision, { kind: "piece", slot: "head", note: "No hood" }, target))?.status).toBe(400);
    const ordinary = await get(handler);
    expect((await patch(handler, ordinary.revision, { kind: "piece", slot: "body", note: "Wrong collection" }))?.status).toBe(400);
  });

  it("rejects direct record edits, approval bypasses, forged authors and empty operations without writing", async () => {
    const { root, handler } = await fixture();
    const initial = await get(handler);
    for (const operation of [
      { kind: "status", status: "approved" }, { kind: "status", status: "live" },
      { kind: "piece", slot: "body", status: "approved" }, { kind: "piece", slot: "body" },
      { kind: "note", text: " " }, { kind: "note", text: "x", by: "Agent", at },
      { kind: "request.open", requestId: "x", requestKind: "text", text: "x", state: "closed" },
      { kind: "request.claim", requestId: "x" }, { kind: "history", history: [] },
      { kind: "status", status: "draft", approvals: { male: true } },
    ]) expect((await patch(handler, initial.revision, operation))?.status).toBe(400);
    for (const extra of [{ candidates: [] }, { history: [] }, { approvals: { male: true } }, { notes: [] }, { sourceRefs: [] }]) {
      expect((await handler({ method: "PATCH", url, body: { revision: initial.revision, operation: { kind: "note", text: "x" }, ...extra } }))?.status).toBe(400);
    }
    expect((await handler({ method: "PATCH", url }))?.status).toBe(400);
    await expect(readFile(path.join(root, "meta", "shops.meta.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validates registered entities, numeric IDs and whole-object metadata with safe balance filenames", async () => {
    const { root, handler } = await fixture();
    for (const target of ["/__devdocs/meta/noSuchCollection/x", "/__devdocs/meta/shops/noSuchEntity", "/__devdocs/meta/balance/sets/byTier"]) {
      expect((await handler({ url: target }))?.status).toBe(404);
    }
    const numeric = await get(handler, `/__devdocs/meta/progression/${rawProgression[0]!.id}`);
    expect(numeric.entityId).toBe(rawProgression[0]!.id);
    const encoded = "/__devdocs/meta/balance%2Fsets/%24collection";
    const split = "/__devdocs/meta/balance/sets/$collection";
    expect(await get(handler, encoded)).toEqual(await get(handler, split));
    const first = await get(handler, encoded);
    expect((await patch(handler, first.revision, { kind: "note", text: "Balance note" }, split))?.status).toBe(200);
    expect(JSON.parse(await readFile(path.join(root, "meta", "balance--sets.meta.json"), "utf8"))["$collection"].notes[0].text).toBe("Balance note");
    const special = await get(handler, "/__devdocs/meta/shops/__proto__");
    expect((await patch(handler, special.revision, { kind: "note", text: "Own key" }, "/__devdocs/meta/shops/__proto__"))?.status).toBe(200);
    expect(Object.hasOwn(JSON.parse(await readFile(path.join(root, "meta", "shops.meta.json"), "utf8")), "__proto__")).toBe(true);
  });

  it("rejects traversal, remote origins and unsupported methods and leaves unrelated URLs alone", async () => {
    const { handler } = await fixture();
    for (const target of ["/__devdocs/meta", "/__devdocs/meta/../shops/shop", "/__devdocs/meta/%2e%2e/shop", "/__devdocs/meta/shops/%2e%2e", "/__devdocs/meta/shops/a%2fb", "/__devdocs/meta/shops/%00", "/__devdocs/meta/shops/%", "/__devdocs/meta/balance/..%2fsets/$collection"]) {
      expect((await handler({ url: target }))?.status, target).toBe(400);
    }
    for (const headers of [{ host: "evil.example" }, { origin: "https://evil.example" }, { origin: "null" }]) {
      expect((await handler({ url, headers }))?.status).toBe(403);
    }
    expect((await handler({ url, socket: { remoteAddress: "192.0.2.1" } }))?.status).toBe(403);
    expect((await handler({ url: `https://evil.example${url}` }))?.status).toBe(403);
    expect((await handler({ url, method: "DELETE" }))?.headers.Allow).toBe("GET, PATCH");
    expect(await handler({ url: "/items/shop" })).toBeUndefined();
    expect(isMetaPath("/__devdocs/metaphor")).toBe(false);
  });

  it("leaves malformed metadata untouched and reports server failures without local paths", async () => {
    const { root, handler } = await fixture();
    await mkdir(path.join(root, "meta"));
    const file = path.join(root, "meta", "shops.meta.json");
    await writeFile(file, "broken json");
    const result = await handler({ url });
    expect(result?.status).toBe(500);
    expect(result?.body).not.toContain(root);
    expect((await patch(handler, contentRevision("broken json"), { kind: "note", text: "x" }))?.status).toBe(500);
    expect(await readFile(file, "utf8")).toBe("broken json");
    expect(await readdir(path.join(root, "meta"))).toEqual(["shops.meta.json"]);
  });
});
