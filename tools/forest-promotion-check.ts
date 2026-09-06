/** Verify accepted tree bytes and authentic forest gate evidence without launching Chromium. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { KHRMeshQuantization } from "@gltf-transform/extensions";
import { resourceDef } from "../game/src/content/resources.js";
import { yieldRange } from "../game/src/content/index.js";
import { repoRoot } from "./lib/paths.js";

const readJSON = async (file: string) => JSON.parse(await readFile(path.join(repoRoot, file), "utf8"));
const candidate = await readJSON("art/rebuild/candidates/finish-foliage/catalog.json");
const manifest = await readJSON("game/public/assets/manifest.json");
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const checked: { id: string; sha256: string; triangles: number }[] = [];
let lastPromotionMs = 0;
for (const source of candidate.assets.filter((a: { id: string }) => /^corealm_(oak|pine)_\d+$/.test(a.id))) {
  const live = manifest.assets.find((a: { id: string }) => a.id === source.id);
  assert(live, `Missing promoted tree ${source.id}`);
  const bytes = await readFile(path.join(repoRoot, "game/public/assets", live.file));
  lastPromotionMs = Math.max(lastPromotionMs, (await stat(path.join(repoRoot, "game/public/assets", live.file))).mtimeMs);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256, source.sha256, `${source.id} public bytes differ from accepted candidate`);
  const document = await io.readBinary(bytes);
  const bounds = getBounds(document.getRoot().listScenes()[0]!);
  const triangles = document.getRoot().listMeshes().flatMap(m => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION")!.getCount()) / 3, 0);
  assert.equal(triangles, source.triangles);
  assert.deepEqual(live.size, source.size, `${source.id} manifest dimensions`);
  assert.deepEqual(live.base, source.base, `${source.id} manifest grounded origin`);
  for (const [axis, key] of ["x", "y", "z"].entries()) {
    assert(Math.abs(bounds.min[axis]! - source.base[key]) < .0001, `${source.id} actual GLB base`);
    assert(Math.abs(bounds.max[axis]! - bounds.min[axis]! - source.size[key]) < .0001, `${source.id} actual GLB dimensions`);
  }
  checked.push({ id: source.id, sha256, triangles });
}
assert.equal(checked.length, 6);

let lab;
if (process.argv.includes("--lab-evidence")) {
  assert((await stat(path.join(repoRoot, "test-results/forest-lab/report.json"))).mtimeMs >= lastPromotionMs, "Forest lab evidence predates tree promotion");
  const report = await readJSON("test-results/forest-lab/report.json");
  assert.equal(report.passed, true);
  const tree = report.tree;
  const resource = resourceDef(tree.resourceId);
  const [minimum, maximum] = resource.yieldRange ?? yieldRange(resource.tier);
  const sizeFactor = Math.max(.65, Math.min(1.5, tree.scale));
  const available = report.phases.available.entity;
  assert.equal(available.view.assetId, tree.assetId);
  assert.equal(available.resource.itemId, resource.itemId);
  assert(available.resource.maxYields >= Math.max(1, Math.round(minimum * sizeFactor)));
  assert(available.resource.maxYields <= Math.max(1, Math.round(maximum * sizeFactor)));
  for (const observation of [report.phases.available, report.phases.naturalDepletion.observation, report.phases.saveRestore, report.phases.distanceSuppression.returned, report.phases.respawn.observation]) {
    assert.deepEqual(observation.entity.position, tree.position, "Exact scatter origin changed across harvesting/save/return");
    assert.equal(observation.entity.id, tree.id);
  }
  assert.equal(report.phases.naturalDepletion.initialYields, report.phases.naturalDepletion.received);
  lab = { treeId: tree.id, assetId: tree.assetId, origin: tree.position, itemId: resource.itemId, yields: available.resource.maxYields, received: report.phases.naturalDepletion.received, distantMetres: report.phases.distanceSuppression.farDistance };
}
let world;
if (process.argv.includes("--world-evidence")) {
  assert((await stat(path.join(repoRoot, "test-results/world-resources/report.json"))).mtimeMs >= lastPromotionMs, "World forest evidence predates tree promotion");
  const report = await readJSON("test-results/world-resources/report.json");
  assert.equal(report.passed, true);
  const tree = report.forestSelection.entity;
  const proof = report.forestPersistence;
  assert(checked.some(asset => asset.id === tree.view.assetId));
  const definition = resourceDef(tree.meta.resourceId);
  assert.equal(tree.resource.itemId, definition.itemId);
  assert.equal(proof.received, tree.resource.maxYields);
  for (const observation of [proof.restored, proof.returned]) {
    assert.equal(observation.entity.id, tree.id);
    assert.deepEqual(observation.entity.position, tree.position);
    assert.equal(observation.entity.resource.remaining, 0);
    assert.equal(observation.entity.state, "depleted");
    assert.equal(observation.bounds.path, "instanced-spent");
  }
  const distance = Math.hypot(proof.distant.x - tree.position[0], proof.distant.z - tree.position[2]);
  assert(distance > 50);
  world = { treeId: tree.id, assetId: tree.view.assetId, origin: tree.position, itemId: definition.itemId, received: proof.received, distantMetres: distance };
}
console.log(JSON.stringify({ passed: true, promoted: checked, lab, world }, null, 2));
