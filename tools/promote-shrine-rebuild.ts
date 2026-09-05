/** Root-run shrine integration. Use --check for read-only validation; no flag applies the pair.
 * The promoted models still require production feature-lab and navigation acceptance.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, getBounds, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import type { AssetEntry, AssetManifest } from "../game/src/render/assets.js";
import { assetRoot, inspectModel, sha256, type ModelMetrics } from "./audit-model-library.js";
import { repoRoot } from "./lib/paths.js";

const stageRoot = path.join(repoRoot, "runs/local-model-rebuild");
const backupRoot = path.join(stageRoot, "backup");
const ids = ["altar_ruins_site", "altar_ruins_altar"];
const structural = /^(?:Arch_|Broken_column|Gate|Platform_circle|Stone_post|Stone_slab|Stone_structure|Wall_)/;

interface StagedShrine {
  id: string;
  source: string;
  stagedFile: string;
  before: ModelMetrics;
  after: ModelMetrics;
  geometry: { triangles: number; maxPositionError: number; maxUvError: number; maxNormalError: number };
  collision: { unchanged: boolean; namedStructuralMeshes: number; fingerprint: string };
  compressedNormals: Array<{ p95Degrees: number; resize: boolean; chromaSubsampling: string }>;
}

function colliderFingerprint(document: Document): string {
  const colliders = document.getRoot().listNodes().filter((node) => structural.test(node.getName()) && node.getMesh())
    .map((node) => ({ name: node.getName(), matrix: node.getWorldMatrix(),
      primitives: node.getMesh()!.listPrimitives().map((primitive) => ({ mode: primitive.getMode(),
        indices: Array.from(primitive.getIndices()?.getArray() ?? []),
        attributes: primitive.listSemantics().sort().map((semantic) => {
          const attribute = primitive.getAttribute(semantic)!;
          return { semantic, type: attribute.getType(), normalized: attribute.getNormalized(), values: Array.from(attribute.getArray()!) };
        }),
      })),
    })).sort((a, b) => a.name.localeCompare(b.name));
  return sha256(Buffer.from(JSON.stringify(colliders)));
}

async function main(): Promise<void> {
  assert(process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === "--check", "Usage: npx tsx tools/promote-shrine-rebuild.ts [--check]");
  const checkOnly = process.argv.includes("--check");
  const report = JSON.parse(await readFile(path.join(stageRoot, "optimization-report.json"), "utf8")) as {
    schemaVersion: number; status: string; results: StagedShrine[];
  };
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.status, "staged-awaiting-lab-acceptance");
  assert.deepEqual(report.results.map((row) => row.id).sort(), [...ids].sort(), "Report must contain exactly the shrine pair.");
  const manifestFile = path.join(assetRoot, "manifest.json");
  const manifestBytes = await readFile(manifestFile);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as AssetManifest;
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
  const prepared: Array<{ row: StagedShrine; entry: AssetEntry; destination: string; current: Buffer; staged: Buffer; original: boolean }> = [];

  // Validate both models before any backup or production write. Paths are fixed, never supplied
  // by the report, and the report's hashes tie offline evidence to exactly these bytes.
  for (const row of report.results) {
    const entry = manifest.assets.find((asset) => asset.id === row.id);
    assert(entry, `Missing manifest row ${row.id}`);
    assert.equal(entry.file, `models/magic/${row.id}.glb`);
    assert.equal(row.source, `game/public/assets/${entry.file}`);
    assert.equal(row.stagedFile, `runs/local-model-rebuild/${row.id}.glb`);
    const destination = path.join(assetRoot, entry.file);
    const stagedFile = path.join(stageRoot, `${row.id}.glb`);
    const current = await readFile(destination), staged = await readFile(stagedFile);
    const currentHash = sha256(current);
    const original = currentHash === row.before.sha256;
    assert(original || currentHash === row.after.sha256, `${row.id}: production file changed since offline acceptance.`);
    assert.equal(sha256(staged), row.after.sha256, `${row.id}: staged hash mismatch.`);
    assert.equal(staged.length, row.after.bytes);
    assert.deepEqual(await inspectModel(stagedFile), row.after, `${row.id}: staged metrics differ from the report.`);
    assert.equal(row.collision.unchanged, true);
    assert.equal(row.geometry.triangles, row.before.renderTriangles);
    assert.equal(row.after.renderTriangles, row.before.renderTriangles);
    assert(row.geometry.maxPositionError <= 0.0001 && row.geometry.maxUvError <= 0.000001 && row.geometry.maxNormalError <= 0.00001);
    assert(row.compressedNormals.length > 0 && row.compressedNormals.every((normal) => !normal.resize && normal.chromaSubsampling === "4:4:4" && normal.p95Degrees <= 3));
    const document = await io.read(stagedFile);
    assert.equal(colliderFingerprint(document), row.collision.fingerprint, `${row.id}: staged named collider geometry changed.`);
    assert.equal(colliderFingerprint(await io.read(destination)), row.collision.fingerprint, `${row.id}: source named collider geometry changed.`);
    const bounds = getBounds(document.getRoot().getDefaultScene()!);
    assert(entry.base, `${row.id}: missing manifest bounds.`);
    for (const [axis, index] of [["x", 0], ["y", 1], ["z", 2]] as const) {
      assert(Math.abs(bounds.min[index] - entry.base[axis]) <= 0.0001 && Math.abs(bounds.max[index] - bounds.min[index] - entry.size[axis]) <= 0.0001,
        `${row.id}: bounds no longer match the authored manifest.`);
    }
    entry.bytes = row.after.bytes;
    (entry as AssetEntry & { sha256: string }).sha256 = row.after.sha256.toUpperCase();
    entry.materials = document.getRoot().listMaterials().map((material) => material.getName());
    // Geometry, authored bounds, tags, paths, identity and all gameplay metadata remain valid.
    prepared.push({ row, entry, destination, current, staged, original });
  }
  if (checkOnly) {
    console.log(JSON.stringify({ status: "validated-no-files-changed", ids, reportHashesMatch: true, namedCollidersUnchanged: true, boundsUnchanged: true }));
    return;
  }

  await mkdir(backupRoot, { recursive: true });
  for (const item of prepared) {
    const backup = path.join(backupRoot, `${item.row.id}.glb`);
    if (item.original) {
      try { await writeFile(backup, item.current, { flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    assert.equal(sha256(await readFile(backup)), item.row.before.sha256, `${item.row.id}: original backup missing or mismatched; it will never be overwritten.`);
  }
  try { await writeFile(path.join(backupRoot, "manifest.json"), manifestBytes, { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  assert.equal(sha256(await readFile(manifestFile)), sha256(manifestBytes), "Manifest changed during validation; rerun after concurrent edits finish.");
  for (const item of prepared) assert.equal(sha256(await readFile(item.destination)), sha256(item.current), `${item.row.id}: production changed during validation.`);
  for (const item of prepared) if (item.original) await writeFile(item.destination, item.staged);
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const item of prepared) assert.equal(sha256(await readFile(item.destination)), item.row.after.sha256);
  console.log(JSON.stringify({ status: "promoted-awaiting-lab-acceptance", ids, backup: path.relative(repoRoot, backupRoot),
    savedBytes: prepared.reduce((sum, item) => sum + item.row.before.bytes - item.row.after.bytes, 0) }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
