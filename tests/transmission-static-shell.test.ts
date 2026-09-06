import * as THREE from "three";
import { expect, it } from "vitest";
import { EntityViews } from "../game/src/render/entityViews.js";
import { withTransmissionOccluderSubset } from "../game/src/render/transmissionOcclusion.js";

it("selects only native trough instances in mixed batches and restores even after failed draws", () => {
  const geometry = new THREE.BoxGeometry();
  const mesh = new THREE.BatchedMesh(3, 100, 200, new THREE.MeshStandardMaterial());
  const geometryId = mesh.addGeometry(geometry);
  const first = mesh.addInstance(geometryId);
  const second = mesh.addInstance(geometryId);
  const trough = { assetId: "corealm_water_trough", slots: ["trough"] };
  const other = { assetId: "animal_chicken", slots: ["moving"] };
  const owners = [{ group: trough, slot: 0 }, { group: other, slot: 0 }];
  const views = Object.create(EntityViews.prototype) as EntityViews;
  Object.defineProperty(views, "batches", { value: new Map([["test", { mesh, owners }]]) });
  expect(views.staticOccluderMeshes()[0]?.instanceIds).toEqual([first]);
  const source = views.staticOccluderMeshes()[0]!;
  const before = mesh.onBeforeRender;
  mesh.castShadow = true;
  expect(() => withTransmissionOccluderSubset(source, () => {
    expect(mesh.getVisibleAt(first)).toBe(true);
    expect(mesh.getVisibleAt(second)).toBe(false);
    throw new Error("draw failed");
  })).toThrow("draw failed");
  expect(mesh.getVisibleAt(second)).toBe(true);
  expect(mesh.onBeforeRender).toBe(before);
  expect(mesh.castShadow).toBe(true);
  mesh.setVisibleAt(second, false);
  const original = views.staticOccluderMeshes();
  expect(original).toHaveLength(1);
  mesh.setMatrixAt(first, new THREE.Matrix4().makeTranslation(1, 2, 3));
  expect(views.staticOccluderMeshes()[0]?.revision).not.toBe(original[0]?.revision);
  mesh.setVisibleAt(second, true);
  expect(views.staticOccluderMeshes()[0]?.instanceIds).toEqual([first]);
  mesh.dispose(); geometry.dispose();
});

it("handles deleted instance holes and reused IDs without admitting a replacement owner", () => {
  const geometry = new THREE.BoxGeometry();
  const mesh = new THREE.BatchedMesh(4, 100, 200, new THREE.MeshStandardMaterial());
  const geometryId = mesh.addGeometry(geometry);
  const deleted = mesh.addInstance(geometryId);
  const troughId = mesh.addInstance(geometryId);
  const otherId = mesh.addInstance(geometryId);
  const trough = { assetId: "corealm_water_trough", slots: ["trough"] };
  const other = { assetId: "corealm_feed_trough", slots: ["other"] };
  const owners: ({ group: typeof trough; slot: number } | null)[] = [null, { group: trough, slot: 0 }, { group: other, slot: 0 }];
  mesh.deleteInstance(deleted);
  const views = Object.create(EntityViews.prototype) as EntityViews;
  Object.defineProperty(views, "batches", { value: new Map([["test", { mesh, owners }]]) });
  const source = views.staticOccluderMeshes()[0]!;
  expect(mesh.instanceCount).toBe(2);
  expect(source.sourceInstanceIds).toEqual([troughId, otherId]);
  withTransmissionOccluderSubset(source, () => {
    expect(mesh.getVisibleAt(troughId)).toBe(true);
    expect(mesh.getVisibleAt(otherId)).toBe(false);
  });
  expect(mesh.getVisibleAt(otherId)).toBe(true);
  const reused = mesh.addInstance(geometryId);
  expect(reused).toBe(deleted);
  owners[reused] = { group: other, slot: 0 };
  const replacement = views.staticOccluderMeshes()[0]!;
  expect(replacement.instanceIds).toEqual([troughId]);
  withTransmissionOccluderSubset(replacement, () => {
    expect(mesh.getVisibleAt(reused)).toBe(false);
    expect(mesh.getVisibleAt(otherId)).toBe(false);
    expect(mesh.getVisibleAt(troughId)).toBe(true);
  });
  expect(mesh.getVisibleAt(reused)).toBe(true);
  mesh.dispose(); geometry.dispose();
});
