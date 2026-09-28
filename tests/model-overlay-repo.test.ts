import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createAssetsHandler, DEVDOCS_UPLOAD_SOURCE } from "../devdocs/server/handlers/assets.js";
import { putFiles } from "../devdocs/server/handlers/files.js";
import type { AssetManifest } from "../game/src/render/assets.js";
import { footprintRadius } from "../game/src/render/manifestOverlay.js";
import { measureModel, modelEntry } from "../game/src/render/measureModel.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const at = "2026-09-27T12:00:00.000Z";
const TABLE = "// Generated from promoted asset bounds by tools/build-encounter-footprints.ts.\r\nexport const ENCOUNTER_ASSET_RADII: Readonly<Record<string, number>> = {\r\n  \"animal_deer\": 0.5,\r\n};\r\n";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "corealm-repo-models-")); roots.push(root);
  const publicRoot = path.join(root, "game", "public");
  await mkdir(path.join(publicRoot, "assets"), { recursive: true });
  await mkdir(path.join(root, "game", "src", "content"), { recursive: true });
  await writeFile(path.join(root, "game", "src", "content", "encounterFootprints.ts"), TABLE);
  const pipeline = { id: "animal_deer", file: "models/animal/animal_deer.glb", pack: "animal-pack-deluxe", category: "character", is: "animal", tags: [], bytes: 1, size: { x: 1, y: 1, z: 1 }, animations: [], materials: [] };
  await writeFile(path.join(publicRoot, "assets", "manifest.json"), JSON.stringify({ generatedAt: at, packs: [{ id: "animal-pack-deluxe", name: "Animals", author: "a", source: "https://example.test", license: "l" }], assets: [pipeline] }, null, 2));
  const handler = createAssetsHandler({ contentRoot: path.join(root, "game", "content"), repoRoot: root, publicAssetRoot: path.join(publicRoot, "assets"), actor: "author", now: () => at });
  const post = async (body: unknown) => { const response = (await handler({ method: "POST", url: "/__devdocs/assets/models", body }))!; return { status: response.status, body: JSON.parse(String(response.body)) }; };
  const manifest = async () => JSON.parse(await readFile(path.join(publicRoot, "assets", "manifest.json"), "utf8")) as AssetManifest;
  return { root, publicRoot, post, manifest };
}

describe("a model uploaded in the repository", () => {
  it("lands in game/public/assets and manifest.json with a footprint line, and only uploads are replaced or removed", async () => {
    const { root, publicRoot, post, manifest } = await fixture();
    const bytes = await readFile("game/public/assets/models/animal/animal_deer.glb");
    const entry = modelEntry(await measureModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
      { id: "animal_moonhart", category: "character", pack: "devdocs-uploads", is: "animal", tags: ["deer"] });

    // The entry waits for its file.
    expect((await post({ entry })).status).toBe(409);
    await putFiles({ files: { [`assets/${entry.file}`]: bytes.toString("base64") } }, { publicRoot });
    const added = await post({ entry });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body.footprint).toBe(footprintRadius(entry.size));

    const written = await manifest();
    expect(written.assets.map(row => row.id)).toEqual(["animal_deer", "animal_moonhart"]);
    expect(written.assets[1]).toMatchObject({ ...entry, sha256: expect.stringMatching(/^[0-9A-F]{64}$/) });
    expect(written.packs.find(pack => pack.id === "devdocs-uploads")).toMatchObject({ source: DEVDOCS_UPLOAD_SOURCE, author: "author" });
    const table = await readFile(path.join(root, "game", "src", "content", "encounterFootprints.ts"), "utf8");
    expect(table).toBe(TABLE.replace("};", `  "animal_moonhart": ${footprintRadius(entry.size)},\r\n};`));

    // Replacing keeps one row and one line; the pipeline's rows and packs are refused.
    expect((await post({ entry: { ...entry, tags: ["deer", "fey"] } })).status).toBe(200);
    expect((await manifest()).assets.filter(row => row.id === "animal_moonhart")).toHaveLength(1);
    expect((await post({ entry: { ...entry, id: "animal_deer", file: "models/character/animal_deer.glb" } })).status).toBe(409);
    expect((await post({ entry: { ...entry, pack: "animal-pack-deluxe" } })).status).toBe(409);
    expect((await post({ remove: "animal_deer" })).status).toBe(409);

    expect((await post({ remove: "animal_moonhart" })).status).toBe(200);
    const after = await manifest();
    expect(after.assets.map(row => row.id)).toEqual(["animal_deer"]);
    expect(after.packs.map(pack => pack.id)).toEqual(["animal-pack-deluxe"]);
    await expect(stat(path.join(publicRoot, "assets", entry.file))).rejects.toThrow();
  });
});
