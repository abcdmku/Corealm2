import { describe, expect, it } from "vitest";
import { REGIONS } from "../game/src/content/regions.js";
import { assembleFeatureLabStructure, buildFeatureLabStructureParts, sanitizeFeatureLabStructureSelection, compositionHero } from "../game/src/featureLab/structures.js";
import { buildPrefab, variantSeed } from "../game/src/render/buildings.js";
import { structureCollisionFromBoxes } from "../game/src/world/regionBuilder.js";
import { prefabCollision } from "../game/src/render/buildings.js";

describe("authored structure fixture fidelity", () => {
  it("retains a 6 x 2.2 porch's production footprint and part placements", () => {
    const selection = {kind:"prefab",id:"porch",kit:"plaster",width:6,depth:2.2,seed:41} as const;
    expect(sanitizeFeatureLabStructureSelection(selection)).toEqual(selection);
    expect(buildFeatureLabStructureParts(selection)).toEqual(buildPrefab("porch",[6,2.2],41,"plaster"));
    const fixture = assembleFeatureLabStructure(selection,[0,0,0]);
    expect(fixture.selection.depth).toBe(2.2);
    const expected = structureCollisionFromBoxes(prefabCollision("porch",[6,2.2]), {
      origin:[0,0,0],rotationY:0,regionId:"fallowmarch",ownerId:"feature-lab:structure",name:"Porch",prefab:"porch",
    });
    expect(fixture.solids).toEqual(expected.solids);
  });

  it("places the real Coldbrace vault tower behind its frame with matching solid and regional material", () => {
    const region = REGIONS.find(region=>region.id === "fallowmarch")!;
    const tower = region.settlement.buildings.find(building=>building.id === "coldbrace_vault")!;
    const landmark = region.landmarks.find(landmark=>landmark.id === "march_vault_tower")!;
    // A different selected kit must not recolour the native authored host.
    const selection = {kind:"composition",id:"vault_door",kit:"stone",width:6,depth:4,seed:5} as const;
    const origin = [20,7,-15] as const;
    const assembly = assembleFeatureLabStructure(selection,[...origin]);
    const host = assembly.entities.filter(entity=>entity.meta?.compositionHost === true);
    const native = buildPrefab(tower.prefab,tower.footprint,variantSeed(tower.id),region.settlement.kit);
    expect(host).toHaveLength(native.length);
    for (const part of native) {
      const actual = host.find(entity=>entity.id.endsWith(`#host_${part.tag}`))!;
      expect(actual).toBeDefined();
      // Inverse landmark yaw PI: native tower x reverses and z reverses behind the frame.
      expect(actual.position[0]).toBeCloseTo(origin[0]-part.dx,2);
      expect(actual.position[1]).toBeCloseTo(origin[1]+part.dy,2);
      expect(actual.position[2]).toBeCloseTo(origin[2]-(tower.position[1]-landmark.position[1])-part.dz,2);
      expect(actual.view!.rotationY).toBeCloseTo(part.rotationY-Math.PI,3);
      expect(actual.regionId).toBe(region.id);
      expect(actual.view!.materialTier).toBe(region.tier);
      expect(assembly.assetIds).toContain(part.assetId);
    }
    const towerSolid = assembly.solids.find(solid=>solid.id === "feature-lab:structure:host#body")!;
    expect(towerSolid).toMatchObject({kind:"box",position:[20,7,-18.3],size:[6,expect.any(Number),6]});
    expect(assembly.buildings).toHaveLength(1);
    expect(assembly.focus[1]).toBeGreaterThan(10);
    expect(assembly.focus[2]).toBeCloseTo(-16.65,2);
  });

  it("keeps the native unclipped Rootfall hero", () => {
    expect(compositionHero({kind:"composition",id:"rootfall_stump",kit:"timber",width:6,depth:4,seed:0})).toEqual({assetId:"corealm_stump_oak",scale:4,solid:false});
  });
});
