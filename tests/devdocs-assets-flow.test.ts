import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAssetsHandler, type AssetActionResponse, type AssetCandidatesResponse } from "../devdocs/server/handlers/assets.js";
import { contentRevision } from "../tools/content/format.js";
import { emptyMetaRecord } from "../tools/content/meta.js";

const temporaryRoots: string[] = [];
const at = "2026-09-13T12:00:00.000Z";

async function fixture(): Promise<{ root: string; contentRoot: string; publicRoot: string; handler: ReturnType<typeof createAssetsHandler>; candidateBytes: Buffer; oldBytes: Buffer }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "corealm-devdocs-assets-"));
  temporaryRoots.push(root);
  const contentRoot = path.join(root, "game", "content");
  const publicRoot = path.join(root, "game", "public", "assets");
  await mkdir(path.join(contentRoot, "data"), { recursive: true });
  await mkdir(path.join(contentRoot, "meta"), { recursive: true });
  await mkdir(path.join(publicRoot, "models", "weapon"), { recursive: true });

  await writeFile(path.join(contentRoot, "data", "items.json"), JSON.stringify([{
    id: "test_sword", name: "Test Sword", tier: 1, description: "A fixture sword.", stackable: false, value: 1, category: "equipment",
    equip: { slot: "mainHand", bonuses: { meleeAccuracy: 0, magicAccuracy: 0, defence: 0, health: 0, meleePower: 1, magicPower: 0, vitality: 0 }, requires: {} },
  }], null, 2) + "\n");
  const note = { at, by: "fixture", text: "Keep this note while the model is reviewed.", label: "asset" };
  await writeFile(path.join(contentRoot, "meta", "items.meta.json"), JSON.stringify({ test_sword: { ...emptyMetaRecord(), notes: [note] } }, null, 2) + "\n");

  const candidateBytes = await readFile(path.join(process.cwd(), "game", "public", "assets", "models", "animal", "animal_frog.glb"));
  const oldBytes = await readFile(path.join(process.cwd(), "game", "public", "assets", "models", "items", "worn_sword.glb"));
  const oldEntry = { id: "corealm_item_test_sword", file: "models/weapon/test_sword.glb", pack: "fixture-pack", category: "weapon", is: "sword", tags: ["fixture"], bytes: oldBytes.length, size: { x: 1, y: 1, z: 1 }, animations: [], materials: [] };
  await writeFile(path.join(publicRoot, "models", "weapon", "test_sword.glb"), oldBytes);
  await writeFile(path.join(publicRoot, "manifest.json"), JSON.stringify({ generatedAt: at, packs: [{ id: "fixture-pack", name: "Fixture", author: "fixture", source: "fixture", license: "fixture" }], assets: [oldEntry] }, null, 2) + "\n");

  const handler = createAssetsHandler({ contentRoot, repoRoot: root, publicAssetRoot: publicRoot, actor: "fixture-user", now: () => at });
  return { root, contentRoot, publicRoot, handler, candidateBytes, oldBytes };
}

function jsonBody<T>(response: { body: string | Uint8Array }): T {
  return JSON.parse(typeof response.body === "string" ? response.body : Buffer.from(response.body).toString("utf8")) as T;
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("DevDocs asset candidate lifecycle", () => {
  it("uploads, reviews, promotes, and archives the replaced asset in an isolated root", async () => {
    const { root, contentRoot, publicRoot, handler, candidateBytes, oldBytes } = await fixture();
    const metadataFile = path.join(contentRoot, "meta", "items.meta.json");
    const initialRevision = contentRevision(await readFile(metadataFile, "utf8"));

    const listed = await handler({ method: "GET", url: "/__devdocs/assets/candidates" });
    expect(listed?.status).toBe(200);
    expect(jsonBody<AssetCandidatesResponse>(listed!).candidates).toHaveLength(0);

    const uploaded = await handler({
      method: "PUT", url: "/__devdocs/assets/upload",
      body: { collection: "items", entityId: "test_sword", revision: initialRevision, fileName: "worn-sword.glb", fileBase64: candidateBytes.toString("base64"), provenance: { source: "fixture" } },
    });
    expect(uploaded?.status).toBe(201);
    const upload = jsonBody<AssetActionResponse>(uploaded!);
    expect(upload.candidate.status).toBe("candidate");
    expect(upload.candidate.file).toMatch(/^art\/candidates\/items\/test_sword\/.+\.glb$/);
    expect(upload.candidate.animations?.length).toBeGreaterThan(0);
    expect(createHash("sha256").update(await readFile(path.join(root, upload.candidate.file))).digest("hex")).toBe(upload.candidate.sha256);

    const candidateFile = await handler({ method: "GET", url: upload.candidate.fileUrl });
    expect(candidateFile?.status).toBe(200);
    expect(Buffer.from(candidateFile!.body)).toEqual(candidateBytes);

    const approved = await handler({ method: "POST", url: `/__devdocs/assets/${encodeURIComponent(upload.candidate.candidateId)}/approve`, body: { revision: upload.revision } });
    expect(approved?.status).toBe(200);
    const approval = jsonBody<AssetActionResponse>(approved!);
    expect(approval.candidate.status).toBe("approved");

    const promoted = await handler({ method: "POST", url: `/__devdocs/assets/${encodeURIComponent(approval.candidate.candidateId)}/promote`, body: { revision: approval.revision } });
    expect(promoted?.status).toBe(200);
    const promotion = jsonBody<AssetActionResponse>(promoted!);
    expect(promotion.candidate.status).toBe("live");
    expect(promotion.asset?.id).toBe("corealm_item_test_sword");
    expect(promotion.previousAsset?.assetId).toBe("corealm_item_test_sword");
    expect(promotion.previousAsset?.archiveFile).toMatch(/^art\/candidates\/previous\/corealm_item_test_sword\/.+\.glb$/);
    expect(await readFile(path.join(publicRoot, "models", "weapon", "test_sword.glb"))).toEqual(candidateBytes);
    expect(await readFile(path.join(root, promotion.previousAsset!.archiveFile))).toEqual(oldBytes);

    const metadata = JSON.parse(await readFile(metadataFile, "utf8")) as Record<string, { notes: Array<{ text: string }>; candidates: Array<{ status: string }> }>;
    expect(metadata.test_sword?.notes[0]?.text).toBe("Keep this note while the model is reviewed.");
    expect(metadata.test_sword?.candidates[0]?.status).toBe("live");
    const manifest = JSON.parse(await readFile(path.join(publicRoot, "manifest.json"), 'utf8')) as { assets: Array<{ id: string; bytes: number }> };
    expect(manifest.assets.find(asset => asset.id === "corealm_item_test_sword")?.bytes).toBe(candidateBytes.length);
  });
});
