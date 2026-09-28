import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { itemIconTrimBounds } from "../game/src/content/itemIconArt.js";
import { applyMetaOperation, parseMetaPatch } from "../game/src/content/metaOps.js";
import type { AdminActor, StoredMeta } from "../game/src/multiplayer/adminStorage.js";
import { decodePng } from "../game/src/multiplayer/imagegenPng.js";
import { ImagegenFailure } from "../game/src/multiplayer/imagegenRunner.js";
import { createIconKind, iconTask, serverIconStore } from "../game/src/multiplayer/itemIconJobs.js";
import { ITEM_ICON_ART_DIR } from "../tools/lib/item-icon-art.js";

const actor: AdminActor = { accountId: "acc_author", credential: "session", at: Date.parse("2026-09-27T12:00:00.000Z") };
const request = { kind: "icon" as const, itemId: "air_orb", assetId: "", name: "Air Orb", prompt: "A swirling air orb", references: {} };

function fakeServer() {
  const files = new Map<string, Buffer>();
  let meta: StoredMeta | null = null;
  return {
    files,
    meta: () => meta,
    store: serverIconStore({
      files: { async put(entries, by) { expect(by).toBe(actor); for (const [file, value] of Object.entries(entries)) files.set(file, Buffer.from(value, "base64")); return { revision: "r", files: {} }; } },
      meta: {
        async authoringMeta() { return meta; },
        async replaceAuthoringMeta(collection, expected, next) { expect(collection).toBe("items"); if ((meta?.revision ?? null) !== expected) return false; meta = { collection, ...next }; return true; },
      },
    }),
  };
}

describe("item icon jobs", () => {
  it("plans one painting for a known item and refuses anything else", async () => {
    const kind = createIconKind<AdminActor>({ hasItem: async id => id === "air_orb", store: async () => [] });
    expect(await kind.plan(request, new Map())).toEqual([{ name: "icon" }]);
    expect(await kind.plan(request, new Map([["current", Buffer.alloc(1)]]))).toEqual([{ name: "icon", reference: "current" }]);
    await expect(kind.plan({ ...request, itemId: "no_such_item" }, new Map())).rejects.toBeInstanceOf(ImagegenFailure);
    const { itemId: _dropped, ...withoutItem } = request;
    await expect(kind.plan(withoutItem, new Map())).rejects.toThrow("itemId");
    const task = iconTask({ itemId: "air_orb", name: "Air Orb", prompt: "A swirling air orb" }, { output: "/jobs/1/output-icon.png" });
    expect(task).toContain("A swirling air orb");
    expect(task).toContain("Save the result at exactly: /jobs/1/output-icon.png");
    expect(task).toContain("transparent alpha background");
  });

  it("a finished job on a server stores the 256 master and the 48 icon and records a candidate", async () => {
    const original = await readFile(path.join(ITEM_ICON_ART_DIR, "air_orb.png"));
    const server = fakeServer();
    const kind = createIconKind<AdminActor>({ hasItem: async () => true, store: server.store, now: () => new Date("2026-09-27T12:30:00.000Z") });
    const job = { id: "j1", kind: "icon" as const, itemId: "air_orb", assetId: "", name: "Air Orb", prompt: "A swirling air orb", materials: ["icon"], status: "running" as const, createdAt: "2026-09-27T12:00:00.000Z" };
    const logs: string[] = [];
    const finished = await kind.finish(job, [{ step: { name: "icon" }, file: "/jobs/j1/output-icon.png", bytes: original }], { owner: actor, generator: "codex exec + gpt-image", log: text => logs.push(text) });

    expect(finished.outputs).toEqual(["assets/icons/items/256/air_orb.png", "assets/icons/items/48/air_orb.png"]);
    const master = decodePng(server.files.get("assets/icons/items/256/air_orb.png")!);
    const game = decodePng(server.files.get("assets/icons/items/48/air_orb.png")!);
    expect([master.width, master.height, game.width, game.height]).toEqual([256, 256, 48, 48]);
    // The same artwork box the published icon has.
    expect(itemIconTrimBounds(master)).toEqual({ left: 8, top: 9, width: 240, height: 238 });
    const records = JSON.parse(server.meta()!.records) as Record<string, { icon?: unknown; history: { action: string }[] }>;
    expect(records.air_orb!.icon).toEqual({ status: "candidate", sha256: createHash("sha256").update(original).digest("hex"), prompt: "A swirling air orb", generatedAt: "2026-09-27T12:30:00.000Z" });
    expect(records.air_orb!.history.map(entry => entry.action)).toEqual(["icon.candidate"]);
    expect(logs.join("")).toContain("assets/icons/items/48/air_orb.png");
  }, 60_000);

  it("fails a job whose original has no transparency, storing nothing", async () => {
    const server = fakeServer();
    const kind = createIconKind<AdminActor>({ hasItem: async () => true, store: server.store });
    const opaque = await sharp({ create: { width: 64, height: 64, channels: 4, background: "red" } }).png().toBuffer();
    const job = { id: "j2", kind: "icon" as const, itemId: "air_orb", assetId: "", name: "Air Orb", prompt: "p", materials: ["icon"], status: "running" as const, createdAt: "2026-09-27T12:00:00.000Z" };
    await expect(kind.finish(job, [{ step: { name: "icon" }, file: "x", bytes: opaque }], { owner: actor, generator: "g", log: () => undefined })).rejects.toThrow("real transparency");
    expect(server.files.size).toBe(0);
    expect(server.meta()).toBeNull();
  });

  it("the icon metadata operation records a candidate, then its review", () => {
    const sha = "a".repeat(64);
    const candidate = parseMetaPatch({ revision: "b".repeat(64), operation: { kind: "icon", status: "candidate", sha256: sha, prompt: "p", generatedAt: "2026-09-27T12:00:00.000Z" } });
    expect("patch" in candidate).toBe(true);
    expect("issues" in parseMetaPatch({ revision: "b".repeat(64), operation: { kind: "icon", status: "candidate" } })).toBe(true);
    expect("issues" in parseMetaPatch({ revision: "b".repeat(64), operation: { kind: "icon", status: "approved", sha256: sha } })).toBe(true);
    let records = applyMetaOperation({}, "items", "air_orb", {}, { kind: "icon", status: "candidate", sha256: sha, prompt: "p", generatedAt: "2026-09-27T12:00:00.000Z" }, "author", "2026-09-27T12:00:00.000Z");
    records = applyMetaOperation(records, "items", "air_orb", {}, { kind: "icon", status: "approved" }, "reviewer", "2026-09-27T13:00:00.000Z");
    expect(records.air_orb!.icon).toEqual({ status: "approved", sha256: sha, prompt: "p", generatedAt: "2026-09-27T12:00:00.000Z", approvedAt: "2026-09-27T13:00:00.000Z" });
    records = applyMetaOperation(records, "items", "air_orb", {}, { kind: "icon", status: "rejected" }, "reviewer", "2026-09-27T14:00:00.000Z");
    expect(records.air_orb!.icon).toEqual({ status: "rejected", sha256: sha, prompt: "p", generatedAt: "2026-09-27T12:00:00.000Z" });
    expect(records.air_orb!.history.map(entry => entry.action)).toEqual(["icon.candidate", "icon.approved", "icon.rejected"]);
  });
});
