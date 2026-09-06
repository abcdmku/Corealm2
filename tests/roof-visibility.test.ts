import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RoofVisibility, roofOwner } from "../game/src/render/roofVisibility.js";
import { StaticCameraQueries } from "../game/src/systems/staticCameraQueries.js";
import type { SemanticEntity } from "../game/src/contracts.js";

function roof(owner: string, x: number, rotation = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 6));
  mesh.position.set(x, 3, 0);
  mesh.rotation.y = rotation;
  mesh.userData = { roofOwner: owner, structureCamera: `${owner}#roof` };
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe("occupied building roofs", () => {
  it("hides only the occupied roof, restores on exit, and ignores players on top", () => {
    const state = new RoofVisibility();
    state.setSources([roof("house", 0), roof("neighbor", 8)]);
    state.update([0, 0, 4]);
    expect(state.snapshot().hiddenEntityIds).toEqual([]);
    expect(state.update([0, 0, 0])).toBe(true);
    expect(state.snapshot().hiddenEntityIds).toEqual(["house#roof"]);
    expect(state.update([0, 0, 1])).toBe(false);
    state.update([0, 0, 3.05]);
    expect(state.snapshot().hiddenEntityIds).toEqual(["house#roof"]);
    state.update([0, 0, 3.3]);
    expect(state.snapshot().hiddenEntityIds).toEqual([]);
    state.update([8, 0, 0]);
    expect(state.snapshot().hiddenEntityIds).toEqual(["neighbor#roof"]);
    state.update([8, 4, 0]);
    expect(state.snapshot().hiddenEntityIds).toEqual([]);
  });

  it("does not treat the empty corners of a rotated roof's world bounds as indoors", () => {
    const state = new RoofVisibility();
    state.setSources([roof("rotated", 0, Math.PI / 4)]);
    state.update([3, 0, 3]);
    expect(state.snapshot().hiddenEntityIds).toEqual([]);
    state.update([0, 0, 0]);
    expect(state.snapshot().hiddenEntityIds).toEqual(["rotated#roof"]);
    state.setSources([]);
    state.update([0, 0, 0]);
    expect(state.snapshot().hiddenEntityIds).toEqual([]);
  });

  it("excludes hidden roofs from camera rays without excluding walls", () => {
    const query = new StaticCameraQueries();
    query.addStaticMesh(roof("house", 0));
    query.addStaticBox([0, 1, -4], [2, 1, 0.2]);
    expect(query.raycast([0, 1, 0], [0, 1, 0], 10)).not.toBeNull();
    query.setHiddenEntities(new Set(["house#roof"]));
    expect(query.raycast([0, 1, 0], [0, 1, 0], 10)).toBeNull();
    expect(query.raycast([0, 1, 0], [0, 0, -1], 10)).not.toBeNull();
    query.setHiddenEntities(new Set());
    expect(query.raycast([0, 1, 0], [0, 1, 0], 10)).not.toBeNull();
  });

  it("removes the overhead floor and upper walls, then preserves them when standing upstairs", () => {
    const floor = roof("house", 0);
    floor.userData.structureCamera = "house#ceiling";
    const upperRoof = roof("house", 0);
    upperRoof.position.y = 6; upperRoof.updateMatrixWorld(true);
    const upperWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 4));
    upperWall.position.set(2, 4.5, 0); upperWall.updateMatrixWorld(true);
    upperWall.userData = {structureOwner: "house", structureCamera: "house#upper-wall", structureAnchorY: 3};
    const pier = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 4));
    pier.position.set(2, 1.5, 0); pier.updateMatrixWorld(true);
    pier.userData = {structureOwner: "house", structureCamera: "house#pier", structureAnchorY: 0};
    const state = new RoofVisibility();
    state.setSources([floor, upperRoof, upperWall, pier, roof("neighbor", 8)]);
    state.update([0, 0, 0]);
    expect([...state.hiddenEntities].sort()).toEqual(["house#ceiling", "house#roof", "house#upper-wall"]);
    state.update([0, 3.2, 0]);
    expect([...state.hiddenEntities]).toEqual(["house#roof"]);
    expect(state.cutHeights.get("house")).toBeCloseTo(5.9);
    state.update([0, 3.2, 5]);
    expect([...state.hiddenEntities]).toEqual([]);
  });

  it("clips only the occupied building's camera boxes above the overhead floor", () => {
    const query = new StaticCameraQueries();
    query.addStaticBox([2, 3, 0], [0.2, 3, 2], 0, "house");
    query.addStaticBox([-2, 3, 0], [0.2, 3, 2], 0, "neighbor");
    query.setHiddenEntities(new Set(), new Map([["house", 3]]));
    expect(query.raycast([0, 4, 0], [1, 0, 0], 5)).toBeNull();
    expect(query.raycast([0, 1, 0], [1, 0, 0], 5)).not.toBeNull();
    expect(query.raycast([0, 4, 0], [-1, 0, 0], 5)).not.toBeNull();
    query.setHiddenEntities(new Set());
    expect(query.raycast([0, 4, 0], [1, 0, 0], 5)).not.toBeNull();
  });

  it("keeps the building hidden after exit until both actual and requested camera arms clear it", () => {
    const state = new RoofVisibility();
    state.setSources([roof("house", 0), roof("neighbor", 8)]);
    state.update([0, 0, 0], {actual: [0, 6, 6], requested: [0, 6, 6], nowMs: 0});
    // The player and compressed lens have left, but the desired camera arm still crosses the roof.
    state.update([0, 0, -4], {actual: [0, 2, -3.5], requested: [0, 6, 6], nowMs: 2000});
    expect([...state.hiddenEntities]).toEqual(["house#roof"]);
    // An open desired arm is insufficient if the current camera is still behind the obstruction.
    state.update([0, 0, -4], {actual: [0, 6, 6], requested: [0, 5, -8], nowMs: 4000});
    expect([...state.hiddenEntities]).toEqual(["house#roof"]);
    const clearView = {actual: [0, 5, -8] as const, requested: [0, 5, -8] as const};
    state.update([0, 0, -4], {...clearView, nowMs: 5000});
    expect([...state.hiddenEntities]).toEqual([]);
  });

  it("cuts upper structures from the camera arm without prior occupancy and restores on rotation", () => {
    const state = new RoofVisibility();
    state.setSources([roof("house", 0), roof("neighbor", 8)]);
    state.update([0, 0, -4], {actual: [0, 2, -3.5], requested: [0, 6, 6], nowMs: 0});
    expect([...state.hiddenEntities]).toEqual(["house#roof"]);
    state.update([0, 0, -4], {actual: [0, 5, -8], requested: [0, 5, -8], nowMs: 16});
    expect([...state.hiddenEntities]).toEqual([]);
  });

  it("retains the lower ceiling cut while crossing its edge under a higher roof", () => {
    const floor = roof("house", 0);
    floor.geometry = new THREE.BoxGeometry(4, 0.2, 2);
    floor.userData.structureCamera = "house#ceiling";
    const upperRoof = roof("house", 0);
    upperRoof.position.y = 6; upperRoof.updateMatrixWorld(true);
    const state = new RoofVisibility(); state.setSources([floor, upperRoof]);
    const view = {actual: [0, 6, 3] as const, requested: [0, 6, 3] as const, nowMs: 0};
    state.update([0, 0, 0], view);
    state.update([0, 0, -2], {...view, nowMs: 2000});
    expect(state.cutHeights.get("house")).toBeCloseTo(2.9);
    expect(state.hiddenEntities.has("house#ceiling")).toBe(true);
    state.update([0, 3.2, 0], {...view, nowMs: 2100});
    expect(state.hiddenEntities.has("house#ceiling")).toBe(false);
  });

  it("classifies separate roofs, floors and canopies but never walls, logs or unowned props", () => {
    const entity: SemanticEntity = {id: "house#roof", archetype: "landmark", meta: {buildingId: "house"},
      name: "House", tier: 1, regionId: "fallowmarch", position: [0, 0, 0], state: "present",
      interactions: [], view: {assetId: "roof_tiles_4x6"}};
    for (const assetId of ["roof_tiles_4x6", "roof_tower", "roof_wood_plank", "overhang_brick", "floor_brick", "floor_wood"]) {
      expect(roofOwner({...entity, view: {assetId}})).toBe("house");
    }
    for (const assetId of ["roof_log", "roof_gable_brick", "overhang_plaster", "wall_wood"]) {
      expect(roofOwner({...entity, view: {assetId}})).toBeNull();
    }
    expect(roofOwner({...entity, meta: {scenery: true}})).toBeNull();
  });
});
