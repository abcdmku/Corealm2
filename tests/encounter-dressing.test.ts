import { describe, expect, it } from "vitest";
import MANIFEST from "../game/public/assets/manifest.json";
import { encounterSetting } from "../game/src/content/encounterDressing.js";
import { RPG_BESTIARY } from "../game/src/content/rpgBestiary.js";
import { STARTER_CREATURES } from "../game/src/content/starterCreatures.js";
import { createRpgRegionalPackCatalogue } from "../game/src/content/rpgRegionalPacks.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { regionalPackDressingSite } from "../game/src/world/regionalPackDressing.js";

const assets = new Map(MANIFEST.assets.map((row) => [row.id, row]));
const catalogue = createRpgRegionalPackCatalogue((id) => {
  const species = RPG_BESTIARY.find((row) => row.assetId === id);
  if (!species) {
    const asset = assets.get(id);
    return asset?.base ? { size: asset.size, base: asset.base } : null;
  }
  return { size: { x: species.nativeSize[0], y: species.nativeSize[1], z: species.nativeSize[2] },
    base: { x: species.nativeBase[0], y: species.nativeBase[1], z: species.nativeBase[2] } };
});

describe("purposeful RPG encounter settings", () => {
  it("assigns camps, burial sites, workings and roosts without dressing the retained wildlife", () => {
    const dressed = catalogue.habitats.filter((habitat) => habitat.dressing.length);
    expect(dressed.length).toBeLessThan(81);
    for (const pack of catalogue.packs.filter(pack => STARTER_CREATURES.some(row => row.id === pack.speciesId))) {
      expect(catalogue.habitats.find(row => row.groupId === pack.id)!.dressing).toEqual([]);
    }
    expect(encounterSetting("goblin", [0, 0], 4).kind).toBe("supply-camp");
    expect(encounterSetting("zombie", [0, 0], 4).kind).toBe("burial-shrine");
    expect(encounterSetting("golem", [0, 0], 4).kind).toBe("stone-working");
    expect(encounterSetting("harpy", [0, 0], 4).kind).toBe("roost");
    expect(encounterSetting("demon", [0, 0], 4).kind).toBe("ritual-court");
  });
  it("uses compact compositions instead of shrinking normal props into crowded formations", () => {
    const compact = encounterSetting("goblin", [0, 0], 1.8);
    const roomy = encounterSetting("goblin", [0, 0], 4);
    expect(compact.dressing).toHaveLength(2);
    expect(roomy.dressing).toHaveLength(4);
    expect(compact.dressing).toEqual(roomy.dressing.slice(0, 2));
    expect(() => encounterSetting("goblin", [0, 0], 1)).toThrow("central setting space");
  });
  it("keeps complete prop bounds inside each reservation and clear of every spawn body", () => {
    for (const habitat of catalogue.habitats) {
      const pack = catalogue.packs.find((row) => row.id === habitat.groupId)!;
      const species = RPG_BESTIARY.find((row) => row.id === pack.speciesId);
      if (!species) continue;
      const bodyRadius = Math.max(species.nativeSize[0], species.nativeSize[2])
        * pack.scale * tierSilhouetteScale(species.stats.tier) * 1.04 / 2;
      for (const piece of habitat.dressing) {
        const asset = assets.get(piece.assetId)!;
        expect(asset, piece.assetId).toBeDefined();
        const sx = typeof piece.scale === "number" ? piece.scale : piece.scale[0];
        const sz = typeof piece.scale === "number" ? piece.scale : piece.scale[2];
        const radius = Math.hypot(asset.size.x * sx / 2, asset.size.z * sz / 2);
        expect(Math.hypot(piece.x - pack.centre[0], piece.z - pack.centre[1]) + radius, `${pack.id}/${piece.id}`)
          .toBeLessThan(pack.radius);
        for (const anchor of pack.anchors) expect(Math.hypot(piece.x - anchor[0], piece.z - anchor[1]) - radius - bodyRadius,
          `${pack.id}/${piece.id} spawn clearance`).toBeGreaterThan(0.15);
        // No setting piece blocks the straight central south approach.
        expect(piece.z - pack.centre[1] + radius, `${pack.id}/${piece.id} approach`).toBeLessThan(1.5);
      }
    }
  });
  it("projects world coordinates into the same production site used by the compact fixture", () => {
    const habitat = catalogue.habitats[0]!;
    const site = regionalPackDressingSite(habitat);
    expect(site.dressing).toBe(habitat.dressing);
    expect(site.centre).toEqual([0, 0]);
    expect(site.regionId).toBe(habitat.regionId);
    expect(site.locationId).toBe(habitat.groupId);
  });
});
