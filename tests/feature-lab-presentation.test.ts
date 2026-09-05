import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { resourceDef } from "../game/src/content/resources.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { createPresentationFixture } from "../game/src/featureLab/presentation.js";
import { GRASS_COLOURS } from "../game/src/render/artDirection.js";
import type { AssetRegistry } from "../game/src/render/assets.js";
import type { EntityViews } from "../game/src/render/entityViews.js";
import type { GrassSpritePlacement, ScatterPlacement, WorldScene } from "../game/src/render/scene.js";
import { EntityStore } from "../game/src/world/entities.js";

function fixtureDeps(missing: string[] = []) {
  const source = new THREE.Group();
  const assets = {
    assetSize: vi.fn(() => ({ x: 3, y: 5, z: 4 })),
    baseY: () => -0.35,
    load: vi.fn(async () => source),
  };
  const scene = {
    meshHeightAt: (x: number, z: number) => 2 + x * 0.01 + z * 0.02,
    scatterInstanced: vi.fn((_source: THREE.Object3D, _placements: ScatterPlacement[]) => []),
    scatterGrassSprites: vi.fn((_placements: readonly GrassSpritePlacement[]) => []),
  };
  const entityStore = new EntityStore({ skillLevels: () => ({}) as never });
  const bank: SemanticEntity = {
    id: "existing-bank", name: "Bank", archetype: "bank", tier: 1, regionId: "fallowmarch",
    position: [2, 0, 1], state: "closed", interactions: ["inspect", "bank"],
  };
  entityStore.add(bank);
  const entityViews = {
    prepare: vi.fn(async (_entities: readonly SemanticEntity[]) => ({ loaded: 3, missing })),
    sync: vi.fn(),
  };
  return {
    source, assets, scene, bank, entityStore, entityViews,
    deps: {
      assets: assets as unknown as AssetRegistry,
      scene: scene as unknown as WorldScene,
      entityStore,
      entityViews: entityViews as unknown as EntityViews,
    },
  };
}

describe("production presentation fixture", () => {
  it("grounds both tree paths at the same drawn size and preserves the existing yard", async () => {
    const setup = fixtureDeps();
    const view = await createPresentationFixture(setup.deps);
    const tree = setup.entityStore.get(view.resourceEntityIds[0]!)!;
    const ore = setup.entityStore.get(view.resourceEntityIds[1]!)!;
    const decorativeTree = setup.scene.scatterInstanced.mock.calls[0]![1][0]!;
    const renderedTreeScale = tree.view!.scale! * tierSilhouetteScale(tree.view!.materialTier!);
    expect(renderedTreeScale * 5).toBe(resourceDef("tree_palewood").presentation.targetWorldSize);
    expect(decorativeTree.scale).toBe(renderedTreeScale);
    for (const [position, scale] of [
      [tree.position, renderedTreeScale],
      [decorativeTree.position, decorativeTree.scale as number],
    ] as const) {
      expect(position[1] + setup.assets.baseY() * scale)
        .toBeCloseTo(setup.scene.meshHeightAt(position[0], position[2]), 12);
    }
    expect(setup.entityStore.get(setup.bank.id)).toBe(setup.bank);
    expect(setup.entityViews.sync).toHaveBeenCalledWith(setup.entityStore.all());
    expect(tree).toMatchObject({
      interactions: ["inspect", "chop"], requirements: { woodcutting: 1 }, state: "available",
      resource: { itemId: "palewood_log" }, meta: { resourceId: "tree_palewood" },
      view: { depletedAssetId: resourceDef("tree_palewood").presentation.depletedAssetId },
    });
    expect(ore).toMatchObject({ interactions: ["inspect", "mine"], resource: { itemId: "grithe_ore" } });
    const grass = setup.scene.scatterGrassSprites.mock.calls[0]![0];
    expect(new Set(grass.map((entry) => entry.colour)))
      .toEqual(new Set([GRASS_COLOURS.green, GRASS_COLOURS.dry]));
    expect(view.scatterInstances).toBe(1 + 3 + grass.length);
    expect(grass.every((entry) => entry.position[1]
      === setup.scene.meshHeightAt(entry.position[0], entry.position[2]))).toBe(true);
  });

  it("keeps foliage positions deterministic across independent fixture boots", async () => {
    const first = fixtureDeps();
    const second = fixtureDeps();
    expect(await createPresentationFixture(first.deps)).toEqual(await createPresentationFixture(second.deps));
    expect(first.scene.scatterGrassSprites.mock.calls).toEqual(second.scene.scatterGrassSprites.mock.calls);
    expect(first.scene.scatterInstanced.mock.calls.map((call) => call[1]))
      .toEqual(second.scene.scatterInstanced.mock.calls.map((call) => call[1]));
  });

  it("fails before mutating the yard if the depleted production asset is unavailable", async () => {
    const setup = fixtureDeps(["nature_tree_stump"]);
    await expect(createPresentationFixture(setup.deps)).rejects.toThrow("nature_tree_stump");
    expect(setup.entityStore.all()).toEqual([setup.bank]);
    expect(setup.scene.scatterInstanced).not.toHaveBeenCalled();
    expect(setup.scene.scatterGrassSprites).not.toHaveBeenCalled();
  });
});
