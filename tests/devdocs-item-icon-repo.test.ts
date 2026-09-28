import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readIconMaster, repoIconKind, reviewRepoItemIcon, storeRepoItemIcon } from "../devdocs/server/handlers/icons.js";
import { generatedItemIconMaster, readItemIconArtRegistry, sharpItemIconGame } from "../tools/lib/item-icon-art.js";
import { repoRoot } from "../tools/lib/paths.js";

/*
  The checkout's icon store keeps the registry honest: an upload or a finished job leaves the
  original, its registry entry, and the two sizes `npm run icons` would make from that entry.
*/

let root: string;
const art = () => path.join(root, "art", "item-icons", "generated");
const original = () => readFile(path.join(repoRoot, "art", "item-icons", "generated", "air_orb.png"));
const loopback = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:4198" } };

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "item-icon-repo-"));
  await mkdir(art(), { recursive: true });
  await copyFile(path.join(repoRoot, "art", "item-icons", "generated", "registry.json"), path.join(art(), "registry.json"));
  await mkdir(path.join(root, "game", "content", "compiled"), { recursive: true });
  await writeFile(path.join(root, "game", "content", "compiled", "catalog.json"), JSON.stringify({ tables: { items: [{ id: "air_orb" }, { id: "brand_new_charm" }] } }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("repo item icons", () => {
  it("stores an original so the registry reproduces the same master and icon", async () => {
    const bytes = await original();
    const stored = await storeRepoItemIcon({ itemId: "air_orb", original: bytes, prompt: "  A swirling air orb  ", generator: "devdocs upload", generatedAt: "2026-09-27T12:00:00.000Z", generatorKind: "uploaded original" }, { root, actor: "tester" });

    expect(stored.outputs).toEqual(["art/item-icons/256/air_orb.png", "assets/icons/items/48/air_orb.png"]);
    const entry = (await readItemIconArtRegistry(art())).air_orb!;
    expect(entry).toMatchObject({ status: "pending", source: "air_orb.png", sha256: createHash("sha256").update(bytes).digest("hex"), prompt: "A swirling air orb", generator: "uploaded original" });
    const master = await readFile(path.join(root, "art", "item-icons", "256", "air_orb.png"));
    const game = await readFile(path.join(root, "game", "public", "assets", "icons", "items", "48", "air_orb.png"));
    // What `npm run icons` derives from the registry entry is exactly what was written.
    expect((await generatedItemIconMaster(entry, 256, art())).equals(master)).toBe(true);
    expect((await sharpItemIconGame(master)).equals(game)).toBe(true);
    // And the same original gives the published files, byte for byte.
    expect(master.equals(await readFile(path.join(repoRoot, "art", "item-icons", "256", "air_orb.png")))).toBe(true);
    const meta = JSON.parse(await readFile(path.join(root, "game", "content", "meta", "items.meta.json"), "utf8"));
    expect(meta.air_orb.icon).toEqual({ status: "candidate", sha256: entry.sha256, prompt: "A swirling air orb", generatedAt: "2026-09-27T12:00:00.000Z" });

    const approved = await reviewRepoItemIcon("air_orb", "approved", { root, actor: "tester" });
    expect(approved.status).toBe("accepted");
    expect(approved.review).toContain("Approved in devdocs by tester");
    const reviewed = JSON.parse(await readFile(path.join(root, "game", "content", "meta", "items.meta.json"), "utf8"));
    expect(reviewed.air_orb.icon.status).toBe("approved");
    expect(reviewed.air_orb.icon.approvedAt).toMatch(/^2\d{3}-/);
  }, 60_000);

  it("a new item's original goes under devdocs/ and its image job is stored the same way", async () => {
    const kind = repoIconKind({ root });
    await expect(kind.plan({ kind: "icon", itemId: "not_an_item", assetId: "", name: "x", prompt: "p", references: {} }, new Map())).rejects.toThrow("No item");
    expect(await kind.plan({ kind: "icon", itemId: "brand_new_charm", assetId: "", name: "Charm", prompt: "p", references: {} }, new Map())).toEqual([{ name: "icon" }]);
    const job = { id: "j", kind: "icon" as const, itemId: "brand_new_charm", assetId: "", name: "Charm", prompt: "A charm", materials: ["icon"], status: "running" as const, createdAt: "2026-09-27T12:00:00.000Z" };
    const finished = await kind.finish(job, [{ step: { name: "icon" }, file: "x", bytes: await original() }], { owner: undefined, generator: "codex exec + gpt-image", log: () => undefined });
    expect(finished.outputs).toEqual(["art/item-icons/256/brand_new_charm.png", "assets/icons/items/48/brand_new_charm.png"]);
    const entry = (await readItemIconArtRegistry(art())).brand_new_charm!;
    expect(entry).toMatchObject({ status: "pending", source: "devdocs/brand_new_charm.png", generator: "built-in image_gen", prompt: "A charm" });
    expect((await readFile(path.join(art(), "devdocs", "brand_new_charm.png"))).equals(await original())).toBe(true);
  }, 60_000);

  it("serves the routes: provenance, upload and review, refusing what the registry could not record", async () => {
    const post = (url: string, body: unknown) => readIconMaster({ method: "POST", url, ...loopback, body } as Parameters<typeof readIconMaster>[0], { root });
    const provenance = await readIconMaster({ method: "GET", url: "/__devdocs/icons/air_orb/provenance", ...loopback }, { root });
    expect(JSON.parse(String(provenance.body)).entry.status).toBe("accepted");

    const base64 = (await original()).toString("base64");
    expect((await post("/__devdocs/icons/air_orb", { original: base64 })).status).toBe(400);
    expect((await post("/__devdocs/icons/not_an_item", { original: base64, prompt: "p" })).status).toBe(404);
    const opaque = (await sharp({ create: { width: 64, height: 64, channels: 4, background: "red" } }).png().toBuffer()).toString("base64");
    const refused = await post("/__devdocs/icons/air_orb", { original: opaque, prompt: "p" });
    expect([refused.status, JSON.parse(String(refused.body)).error]).toEqual([400, expect.stringContaining("transparency")]);

    const stored = await post("/__devdocs/icons/air_orb", { original: base64, prompt: "A swirling air orb" });
    expect(stored.status).toBe(200);
    expect(JSON.parse(String(stored.body)).entry.status).toBe("pending");
    expect((await post("/__devdocs/icons/air_orb/review", { status: "maybe" })).status).toBe(400);
    const rejected = await post("/__devdocs/icons/air_orb/review", { status: "rejected" });
    expect(JSON.parse(String(rejected.body)).entry).toMatchObject({ status: "pending", review: expect.stringContaining("Rejected") });

    const master = await readIconMaster({ method: "GET", url: "/__devdocs/icons/air_orb.png", ...loopback }, { root });
    expect([master.status, master.headers["Content-Type"]]).toEqual([200, "image/png"]);
  }, 60_000);
});
