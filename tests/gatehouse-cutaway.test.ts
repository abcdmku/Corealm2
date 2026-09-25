/**
 * Every authored gatehouse opens for the camera like any other building.
 *
 * Walking through a gate puts the default follow seat (11 m out at pitch 0.52, so 9.55 m back and
 * 5.5 m over the head) on the far side of the gatehouse's upper storey. The cutaway has to take the
 * head course, the deck and the roof away for that arm, and leave the ground-floor piers the player
 * walks between. Parts are built the way the world builds them (`buildPrefab` and
 * `structureEntitiesFromParts`) and measured the way `structureCameraSources` tags them, with each
 * mesh a box of the asset's manifest bounds.
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SemanticEntity, Vec3 } from "../game/src/contracts.js";
import { REGIONS } from "../game/src/content/regions.js";
import { buildPrefab, STOREY_METRES, variantSeed } from "../game/src/render/buildings.js";
import { OrbitCamera } from "../game/src/render/camera.js";
import { RoofVisibility, roofCutawayFrame, roofOwner, structureOwner } from "../game/src/render/roofVisibility.js";
import { structureEntitiesFromParts } from "../game/src/world/regionBuilder.js";

const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as {
  assets: { id: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } }[];
};
const bounds = new Map(manifest.assets.map((asset) => [asset.id, asset]));

/** One camera source mesh per part, tagged exactly as `buildStructureCameraSources` tags it. */
function cameraMesh(entity: SemanticEntity): THREE.Mesh {
  const asset = bounds.get(entity.view!.assetId)!;
  const geometry = new THREE.BoxGeometry(asset.size.x, asset.size.y, asset.size.z);
  geometry.translate(asset.base.x + asset.size.x / 2, asset.base.y + asset.size.y / 2, asset.base.z + asset.size.z / 2);
  const mesh = new THREE.Mesh(geometry);
  mesh.position.fromArray(entity.position);
  mesh.rotation.y = entity.view!.rotationY ?? 0;
  const scale = entity.view!.scale ?? 1, axes = entity.view!.scaleAxes ?? [1, 1, 1];
  mesh.scale.set(scale * axes[0], scale * axes[1], scale * axes[2]);
  mesh.updateMatrixWorld(true);
  mesh.userData = { structureCamera: entity.id, roofOwner: roofOwner(entity), structureOwner: structureOwner(entity),
    structureAnchorY: entity.position[1] };
  return mesh;
}

const gatehouses = REGIONS.flatMap((region) => region.settlements.flatMap((settlement) => settlement.buildings
  .filter((building) => building.prefab === "gatehouse" && !building.model)
  .map((building) => ({ region, settlement, building }))));

/**
 * The production follow camera at its default zoom and pitch, looking along `facing`, run the way
 * `GameLoop` runs it: the cutaway step first, then the camera update. Returns what the drawn parts
 * were last told to hide.
 */
function follower(roofs: RoofVisibility) {
  const lens = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
  const camera = new OrbitCamera(lens);
  camera.fixedFollow = true;
  let hidden: ReadonlySet<string> = new Set();
  const frame = roofCutawayFrame({
    roofs, camera, lens: () => lens.position.toArray() as Vec3,
    views: { setHiddenRoofs: (ids) => { hidden = new Set(ids); } },
    rays: { setHiddenEntities: () => {} },
  });
  return (feet: Vec3, facing: readonly [number, number]): ReadonlySet<string> => {
    // The seat sits behind the player: `yaw` points from the player to the lens.
    camera.yaw = Math.atan2(-facing[0], -facing[1]);
    camera.update(feet[0], feet[1], feet[2], true);
    frame(feet);
    camera.update(feet[0], feet[1], feet[2]);
    return hidden;
  };
}

describe("gatehouse cutaway", () => {
  it("covers every settlement gatehouse", () => {
    expect(gatehouses.length).toBeGreaterThanOrEqual(8);
    expect(gatehouses.map(({ building }) => building.id)).toContain("rootfall_gate_west");
  });

  it.each(gatehouses.map((gate) => [gate.building.id, gate] as const))(
    "%s opens its upper storey for a camera arm through the gate and keeps its piers",
    (_id, { region, settlement, building }) => {
      const parts = structureEntitiesFromParts(
        buildPrefab(building.prefab, building.footprint, variantSeed(building.id), settlement.kit),
        { origin: [building.position[0], 0, building.position[1]], rotationY: building.rotationY, regionId: region.id,
          tier: settlement.tier, ownerId: building.id, name: building.name,
          meta: { buildingId: building.id, prefab: building.prefab, settlementId: settlement.id, scenery: true } },
      );
      const state = new RoofVisibility();
      state.setSources(parts.map(cameraMesh));
      const look = follower(state);
      // The passage runs along the building's local Z; `through` points out of its +Z face.
      const through = [Math.sin(building.rotationY), Math.cos(building.rotationY)] as const;
      const at = (metres: number): Vec3 => [building.position[0] + through[0] * metres, 0,
        building.position[1] + through[1] * metres];
      const upper = parts.filter((part) => part.position[1] >= STOREY_METRES - 0.01).map((part) => part.id);
      const piers = parts.filter((part) => part.position[1] < 0.01 && /^.*#[pr]/.test(part.id)).map((part) => part.id);
      expect(upper.length).toBeGreaterThan(10);
      expect(piers.length).toBeGreaterThan(4);

      for (const direction of [1, -1] as const) {
        const facing = [through[0] * direction, through[1] * direction] as const;
        // Just through the gate, 3 m past its face, with the camera arm crossing the head course.
        for (const metres of [building.footprint[1] / 2 + 3, building.footprint[1] / 2 + 6]) {
          const hidden = look(at(direction * metres), facing);
          const label = `${building.id} ${direction > 0 ? "+Z" : "-Z"} ${metres} m`;
          expect([...state.hiddenBuildings], label).toEqual([building.id]);
          for (const id of upper) expect(hidden.has(id), `${label} ${id}`).toBe(true);
          for (const id of piers) expect(hidden.has(id), `${label} ${id}`).toBe(false);
        }
        // Standing in the passage, under the ceiling.
        look(at(0), facing);
        expect([...state.hiddenBuildings], `${building.id} in the passage`).toEqual([building.id]);
      }
      // Walking up to the gate from outside, the gate is ahead of the player and stays whole.
      expect([...look(at(building.footprint[1] / 2 + 4), [-through[0], -through[1]])]).toEqual([]);
      expect([...state.hiddenBuildings]).toEqual([]);
    },
  );
});
