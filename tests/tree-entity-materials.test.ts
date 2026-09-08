import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Archetype, RegionId } from "../game/src/contracts.js";
import { TREE_SPECIES, treeAssetIds } from "../game/src/content/treeSpecies.js";
import type { AssetRegistry } from "../game/src/render/assets.js";
import { EntityViews } from "../game/src/render/entityViews.js";
import { MaterialLibrary } from "../game/src/render/materials.js";

describe("interactive tree materials", () => {
  it("retains the scatter material, authored colour and wind for every tree tier", () => {
    const materials = new MaterialLibrary();
    const views = new EntityViews(
      { entityGroup: new THREE.Group(), overlayGroup: new THREE.Group() },
      {} as AssetRegistry, materials,
    ) as unknown as {
      variantFor(base: THREE.Material, asset: string, archetype: Archetype,
        tier: number, region: RegionId, spent: boolean): THREE.Material;
    };
    for (const species of TREE_SPECIES) {
      for (const role of ["bark", "foliage"] as const) {
        const map = new THREE.Texture();
        const source = new THREE.MeshStandardMaterial({
          name: role === "bark" ? "Bark_Corealm" : species.id === "pine"
            ? "Leaves_Corealm_needle_cutout" : `Leaves_Corealm_broadleaf_${species.id}_cutout`,
          map, color: role === "bark" ? 0x573b25 : 0xa63318,
          alphaTest: role === "foliage" ? .32 : 0,
        });
        source.userData.corealmMagicTree = species.id === "magic";
        const organic = materials.organic(source, role);
        const scatter = role === "foliage" ? materials.wind(organic, .035) : organic;
        for (const asset of treeAssetIds(species)) {
          const interactive = views.variantFor(source, asset, "tree", species.level, "fallowmarch", false);
          expect(interactive, asset).toBe(scatter);
          const surface = interactive as THREE.MeshStandardMaterial;
          expect(surface.map, asset).toBe(map);
          expect(surface.color.equals(source.color), asset).toBe(true);
          expect(surface.emissive.getHex(), asset).toBe(source.emissive.getHex());
        }
        for (const stump of ["corealm_stump_oak", "corealm_stump_pine"]) {
          if (role === "bark") expect(views.variantFor(source, stump, "tree", species.level, "fallowmarch", true)).toBe(organic);
        }
        source.dispose(); map.dispose();
      }
    }
    materials.dispose();
  });
});
