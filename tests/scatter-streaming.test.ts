import { describe, expect, it } from "vitest";
import type { RegionId } from "../game/src/contracts.js";
import type { AssetEntry } from "../game/src/render/assets.js";
import type { GrassSpritePlacement, Rect } from "../game/src/render/scene.js";
import {
  ExclusionZones,
  deriveScatterTileSeed,
  mergeScatterResults,
  scatterTilesForBounds,
  scatterWorldTile,
  type RegionScatterSpec,
  type ScatterTile,
} from "../game/src/world/scatter.js";
import { ScatterStreamingController } from "../game/src/world/scatterStreaming.js";

const GRASS_ID = "grass_common_short";

interface ScatterHarnessOptions {
  bounds: Rect;
  surfaceAt?: (x: number, z: number) => {
    height: number;
    normal: readonly [number, number, number];
    slope: number;
    density: number;
  } | null;
  waters?: readonly {
    closed: boolean;
    centre: readonly [number, number];
    contour: readonly (readonly [number, number])[];
    level: number;
  }[];
}

function grassEntry(): AssetEntry {
  return {
    id: GRASS_ID,
    file: `${GRASS_ID}.glb`,
    pack: "test-pack",
    category: "nature",
    is: "grass",
    tags: ["grass"],
    bytes: 100,
    size: { x: 0.5, y: 0.8, z: 0.5 },
    animations: [],
    materials: [],
  };
}

function scatterHarness(options: ScatterHarnessOptions) {
  const placements = new Map<string, GrassSpritePlacement[]>();
  const scene = {
    getScatterBounds: () => options.bounds,
    describeRegions: () => [{ regionId: "fallowmarch" as const }],
    getRegionRect: (_regionId: RegionId) => options.bounds,
    getWaterBodies: () => options.waters ?? [],
    getRoadPolylines: () => [],
    scatterSurfaceAt: (x: number, z: number) => options.surfaceAt
      ? options.surfaceAt(x, z)
      : ({
          height: 0,
          normal: [0, 1, 0] as const,
          slope: 0,
          density: 1,
        }),
    regionWeightAt: () => 1,
    meshHeightAt: () => 0,
    normalAt: () => [0, 1, 0] as const,
    scatterGrassSprites: (
      next: readonly GrassSpritePlacement[],
      name: string,
    ) => {
      placements.set(name, next.map((placement) => ({
        ...placement,
        position: [...placement.position],
        normal: placement.normal ? [...placement.normal] : undefined,
      })) as GrassSpritePlacement[]);
      return [];
    },
  };
  const entry = grassEntry();
  const assets = {
    entry: (id: string) => id === GRASS_ID ? entry : undefined,
    byTags: () => [],
    assetSize: (id: string) => id === GRASS_ID ? entry.size : null,
    loadMany: async () => undefined,
  };
  return { scene, assets, placements };
}

function recipe(
  bounds: Rect,
  exclusions = new ExclusionZones(),
  layerIds: readonly string[] = ["ground-cover"],
  maxCount = 64,
): RegionScatterSpec {
  return {
    regionId: "fallowmarch",
    rect: bounds,
    exclusions,
    layers: layerIds.map((id) => ({
      id,
      assetIds: [GRASS_ID],
      spacing: 4,
      maxCount,
      scale: [1, 1],
      bleed: 0,
      exclusion: { base: { hard: 0, fade: 0 } },
    })),
  };
}

function placementFingerprint(placements: ReadonlyMap<string, readonly GrassSpritePlacement[]>): string[] {
  return [...placements.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, rows]) => `${name}:${JSON.stringify(rows)}`);
}

async function generateInOrder(
  tiles: readonly ScatterTile[],
  seed: number,
  bounds: Rect,
): Promise<string[]> {
  const harness = scatterHarness({ bounds });
  const spec = recipe(bounds);
  for (const tile of tiles) {
    await scatterWorldTile(
      harness.scene as never,
      harness.assets as never,
      seed,
      tile,
      { fallowmarch: spec },
    );
  }
  return placementFingerprint(harness.placements);
}

describe("scatter tile streaming", () => {
  it("derives independent stable streams from every seed dimension", () => {
    const baseline = deriveScatterTileSeed(41, "fallowmarch", "ground-cover", "0:0");
    expect(deriveScatterTileSeed(41, "fallowmarch", "ground-cover", "0:0")).toBe(baseline);
    expect(new Set([
      baseline,
      deriveScatterTileSeed(42, "fallowmarch", "ground-cover", "0:0"),
      deriveScatterTileSeed(41, "vellenwood", "ground-cover", "0:0"),
      deriveScatterTileSeed(41, "fallowmarch", "flowers", "0:0"),
      deriveScatterTileSeed(41, "fallowmarch", "ground-cover", "1:0"),
    ])).toHaveLength(5);
  });

  it("produces the same tile contents regardless of load order", async () => {
    const bounds = { minX: 0, maxX: 192, minZ: 0, maxZ: 192 };
    const tiles = scatterTilesForBounds(bounds);
    expect(tiles.map((tile) => tile.id)).toEqual(["0:0", "1:0", "0:1", "1:1"]);

    const forward = await generateInOrder(tiles, 9_123, bounds);
    const reverse = await generateInOrder([...tiles].reverse(), 9_123, bounds);
    expect(forward.length).toBeGreaterThan(0);
    expect(reverse).toEqual(forward);
  });

  it("keeps coast, dry-land, lake, road, and gameplay exclusions authoritative", async () => {
    const bounds = { minX: 0, maxX: 96, minZ: 0, maxZ: 96 };
    const exclusions = new ExclusionZones()
      .addCircle(42, 22, 7, "road", "test-road")
      .addCircle(62, 22, 7, "custom", "test-gameplay-volume");
    const lake = {
      closed: true,
      centre: [22, 22] as const,
      contour: [
        [30, 22],
        [22, 30],
        [14, 22],
        [22, 14],
      ] as const,
      level: 0,
    };
    const harness = scatterHarness({
      bounds,
      waters: [lake],
      surfaceAt: (x, z) => {
        if (x >= 80) return null;
        return { height: 0, normal: [0, 1, 0], slope: 0, density: z < 80 ? 1 : 0 };
      },
    });
    const spec = recipe(bounds, exclusions, ["protected-cover"], 320);

    await scatterWorldTile(
      harness.scene as never,
      harness.assets as never,
      73,
      scatterTilesForBounds(bounds)[0]!,
      { fallowmarch: spec },
    );
    const placed = [...harness.placements.values()].flat();

    expect(placed.length).toBeGreaterThan(40);
    for (const placement of placed) {
      const [x, , z] = placement.position;
      expect(x, "coast/ocean rejection").toBeLessThan(80);
      expect(z, "dry-land density rejection").toBeLessThan(80);
      expect(Math.hypot(x - 22, z - 22), "lake rejection").toBeGreaterThanOrEqual(9.2);
      expect(Math.hypot(x - 42, z - 22), "road rejection").toBeGreaterThan(7);
      expect(Math.hypot(x - 62, z - 22), "gameplay exclusion rejection").toBeGreaterThan(7);
    }
  });

  it("retains every authored layer in partial stats and forces full residency for map capture", async () => {
    const bounds = { minX: 0, maxX: 192, minZ: 0, maxZ: 192 };
    const harness = scatterHarness({ bounds });
    const spec = recipe(bounds, new ExclusionZones(), ["ground-cover", "flowers"], 32);
    const controller = new ScatterStreamingController(
      harness.scene as never,
      harness.assets as never,
      808,
      { specs: { fallowmarch: spec }, nearRing: 0, yieldToMain: async () => undefined },
    );

    await controller.loadSpawn(20, 20);
    expect(controller.getResidency()).toEqual({
      resident: ["0:0"],
      pending: ["1:0", "0:1", "1:1"],
      total: 4,
      complete: false,
    });
    expect(controller.getStats()[0]?.byLayer).toEqual({
      "ground-cover": expect.any(Number),
      flowers: expect.any(Number),
    });

    await controller.forceFullResidency();
    expect(controller.getResidency()).toEqual({
      resident: ["0:0", "1:0", "0:1", "1:1"],
      pending: [],
      total: 4,
      complete: true,
    });

    const emptyStats = mergeScatterResults([], { fallowmarch: spec });
    expect(emptyStats[0]?.byLayer).toEqual({ "ground-cover": 0, flowers: 0 });
  });

  it("only generates nearby chunks, reuses visited chunks, and expands for travel", async () => {
    const bounds = { minX: 0, maxX: 960, minZ: 0, maxZ: 192 };
    const harness = scatterHarness({ bounds });
    const spec = recipe(bounds, new ExclusionZones(), ["ground-cover"], 20);
    const controller = new ScatterStreamingController(harness.scene as never, harness.assets as never, 808,
      { specs: { fallowmarch: spec }, yieldToMain: async () => undefined });
    await controller.streamNearby(48, 48, 20);
    expect(controller.getResidency().resident).toEqual(["0:0"]);
    const original = [...harness.placements.entries()];
    await controller.streamNearby(912, 48, 20);
    expect(controller.getResidency().resident).toEqual(["0:0", "9:0"]);
    await controller.streamNearby(48, 48, 20);
    expect([...harness.placements.entries()].slice(0, original.length)).toEqual(original);
    expect(controller.getResidency().complete).toBe(false);
  });
});
