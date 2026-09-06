import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REGIONAL_PACK_ACTIVATION, activatedRegionalPackIds, type RegionalPackActivation,
} from "../game/src/content/regionalPackActivation.js";
import { REGIONAL_PACKS } from "../game/src/content/regionalPacks.js";
import { createRpgRegionalPackCatalogue } from "../game/src/content/rpgRegionalPacks.js";
import { STARTER_GROUPS } from "../game/src/content/starterHabitats.js";

interface ManifestAsset {
  readonly id: string;
  readonly size?: { x: number; y: number; z: number };
  readonly base?: { x: number; y: number; z: number };
}

const manifest = JSON.parse(readFileSync(new URL("../game/public/assets/manifest.json", import.meta.url), "utf8")) as {
  assets: ManifestAsset[];
};
const publicAssets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
const measure = (assetId: string) => {
  const entry = publicAssets.get(assetId);
  return entry?.base && entry.size ? { size: entry.size, base: entry.base } : null;
};

describe("regional pack activation", () => {
  it("does not duplicate pockets already populated by starter encounters", () => {
    const ids = new Set(activatedRegionalPackIds());
    for (const group of STARTER_GROUPS) expect(ids.has(group.id), group.id).toBe(false);
  });
  it("activates only packs inside root-accepted regions and never through a query parameter", () => {
    const ids = activatedRegionalPackIds();
    const byId = new Map(REGIONAL_PACKS.map((pack) => [pack.id, pack]));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      const pack = byId.get(id);
      expect(pack, id).toBeDefined();
      expect(REGIONAL_PACK_ACTIVATION.regions).toContain(pack!.regionId);
      expect(REGIONAL_PACK_ACTIVATION.excludedPackIds).not.toContain(id);
    }
    for (const region of REGIONAL_PACK_ACTIVATION.regions) {
      const inRegion = REGIONAL_PACKS.filter((pack) => pack.regionId === region && !REGIONAL_PACK_ACTIVATION.excludedPackIds.includes(pack.id));
      expect(inRegion.every((pack) => ids.includes(pack.id)), region).toBe(true);
    }
  });

  it("rejects unknown exclusions and overrides instead of silently ignoring them", () => {
    const bad: RegionalPackActivation = { regions: [], excludedPackIds: ["pack_missing"], assignmentOverrides: {} };
    expect(() => activatedRegionalPackIds(bad)).toThrow(/Unknown excluded regional pack/);
    const badOverride: RegionalPackActivation = { regions: [], excludedPackIds: [], assignmentOverrides: { pack_missing: null } };
    expect(() => activatedRegionalPackIds(badOverride)).toThrow(/Unknown regional pack override/);
  });

  it("builds every activated pack from promoted public measurements only", () => {
    const ids = activatedRegionalPackIds();
    if (!ids.length) {
      expect(REGIONAL_PACK_ACTIVATION.regions).toEqual([]);
      return;
    }
    const catalogue = createRpgRegionalPackCatalogue(measure, ids, REGIONAL_PACK_ACTIVATION.assignmentOverrides);
    expect(catalogue.packs.map((pack) => pack.id).sort()).toEqual([...ids].sort());
    for (const group of catalogue.groups) {
      const entry = publicAssets.get(group.assetId);
      expect(entry, `${group.id} uses unpromoted asset ${group.assetId}`).toBeDefined();
      expect(Object.values(entry!.size!).every((value) => Number.isFinite(value) && value > 0), group.assetId).toBe(true);
    }
    const memberIds = catalogue.packs.flatMap((pack) => pack.members.map((member) => member.id));
    expect(new Set(memberIds).size).toBe(memberIds.length);
  });

  it("excludes a pack from its activated region without touching the other packs", () => {
    const first = REGIONAL_PACKS[0]!;
    const activation: RegionalPackActivation = { regions: [first.regionId], excludedPackIds: [first.id], assignmentOverrides: {} };
    const ids = activatedRegionalPackIds(activation);
    expect(ids).not.toContain(first.id);
    expect(ids.length).toBe(REGIONAL_PACKS.filter((pack) => pack.regionId === first.regionId).length - 1);
  });
});
