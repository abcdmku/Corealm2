import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("art/equipment-retexture"), staged = path.join(root, "candidates");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const catalog = JSON.parse(await readFile(path.join(staged, "catalog.json"), "utf8"));
const acceptance = JSON.parse(await readFile(path.join(root, "acceptance.json"), "utf8"));
assert(acceptance.visualAccepted && acceptance.rootAccepted, "Root visual acceptance is required");
assert(acceptance.runtimeSources?.length >= 3, "Reviewed runtime source hashes are required");
for (const source of acceptance.runtimeSources) {
  assert.equal(hash(await readFile(source.file)), source.sha256, `Runtime changed after review: ${source.file}`);
}
for (const file of acceptance.labReports) {
  const report = JSON.parse(await readFile(file, "utf8"));
  assert(report.passed, `Failed lab report ${file}`);
  for (const asset of catalog.assets) assert(report.assetHashes.some((row: any) => row.id === asset.id && row.sha256 === asset.sha256), `Stale lab asset ${asset.id}`);
}
const combat = JSON.parse(await readFile(acceptance.combatReport, "utf8"));
assert(combat.passed, "Combat proof is required");
const manifestFile = "game/public/assets/manifest.json";
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
for (const entry of catalog.assets) {
  assert(/^models\/[a-zA-Z0-9_/-]+\.glb$/.test(entry.file), `Unexpected model path ${entry.file}`);
  const file = path.join(staged, catalog.files[entry.id]);
  const bytes = await readFile(file);
  assert.equal(hash(bytes), entry.sha256);
  assert.equal(bytes.length, entry.bytes);
  const proof = catalog.provenance.evidence.find((row: any) => row.id === entry.id);
  assert(proof?.protectedStateMatches, `Changed model structure ${entry.id}`);
  const existing = await readFile(path.join("game/public/assets", entry.file));
  assert([proof.originalSha256, entry.sha256].includes(hash(existing)), `Production source changed ${entry.id}`);
}
for (const texture of catalog.sharedTextures) {
  assert(/^textures\/imported\/[a-f0-9]{64}\.png$/.test(texture.file));
  const bytes = await readFile(path.join(staged, texture.file));
  assert.equal(hash(bytes), texture.sha256); assert.equal(bytes.length, texture.bytes);
}
for (const texture of catalog.sharedTextures) {
  const target = path.join("game/public/assets", texture.file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(staged, texture.file), target);
}
for (const entry of catalog.assets) {
  await copyFile(path.join(staged, catalog.files[entry.id]), path.join("game/public/assets", entry.file));
  const index = manifest.assets.findIndex((row: any) => row.id === entry.id);
  assert(index >= 0, `Missing original manifest entry ${entry.id}`);
  manifest.assets[index] = { ...manifest.assets[index], bytes: entry.bytes, sha256: entry.sha256 };
}
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
await writeFile(path.join(root, "promotion.json"), JSON.stringify({ assets: catalog.assets.map((row: any) => ({ id: row.id, sha256: row.sha256 })), sharedTextures: catalog.sharedTextures, acceptance }, null, 2) + "\n");
console.log(`Promoted texture replacements for ${catalog.assets.length} existing models; geometry and rigs preserved.`);
