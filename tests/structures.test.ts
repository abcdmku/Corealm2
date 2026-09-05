import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { describe, expect, it } from "vitest";
import { buildGravelmawMouthComposition } from "../game/src/render/compositions/gravelmawMouth.js";
import {
  BUILDING_KITS,
  COMPOSITION_IDS,
  KIT_IDS,
  PREFAB_IDS,
  buildComposition,
  buildPrefab,
  buildWallRun,
  compositionPartAssetIds,
  prefabCollision,
  prefabPartAssetIds,
  wallRunCollision,
  type PartPlacement,
} from "../game/src/render/buildings.js";
import {
  STRUCTURE_VARIANTS,
  selectedStructureVariantId,
  structureVariantCount,
} from "../game/src/render/structures/catalog.js";

interface ManifestRow { id: string }

const manifest = JSON.parse(
  readFileSync(new URL("../game/public/assets/manifest.json", import.meta.url), "utf8"),
) as { assets: ManifestRow[] };
const manifestIds = new Set(manifest.assets.map((asset) => asset.id));

// These footprints exercise the odd/even, compact, gate, forge, arcade, porch, market and well
// branches. Sequential seeds then enumerate every recipe compatible with each probe.
const FOOTPRINTS = [
  [6, 4], [6, 6], [12, 6], [5, 4], [4, 4], [8, 1], [3, 2], [8, 3],
  [8, 4], [6, 3], [6, 5], [4, 3], [9, 3], [2, 2], [10, 4], [16, 3],
] as const;

function placementProblems(owner: string, parts: readonly PartPlacement[]): string[] {
  const problems: string[] = [];
  const tags = new Set<string>();
  if (parts.length === 0) problems.push(`${owner}: emitted no parts`);
  for (const part of parts) {
    if (tags.has(part.tag)) problems.push(`${owner}: duplicate tag ${part.tag}`);
    tags.add(part.tag);
    if (!manifestIds.has(part.assetId)) problems.push(`${owner}: missing manifest asset ${part.assetId}`);
    if (![part.dx, part.dy, part.dz, part.rotationY, part.scale].every(Number.isFinite) || part.scale <= 0) {
      problems.push(`${owner}: invalid transform for ${part.tag}`);
    }
    if (part.scaleAxes?.some((axis) => !Number.isFinite(axis) || axis <= 0)) {
      problems.push(`${owner}: invalid axis scale for ${part.tag}`);
    }
  }
  return problems;
}

function collisionProblems(owner: string, boxes: readonly {
  tag: string; dx: number; dz: number; sizeX: number; sizeZ: number; height: number;
}[]): string[] {
  return boxes.flatMap((box) => (
    [box.dx, box.dz, box.sizeX, box.sizeZ, box.height].every(Number.isFinite)
      && box.sizeX > 0 && box.sizeZ > 0 && box.height > 0
      ? []
      : [`${owner}: invalid collision box ${box.tag}`]
  ));
}

describe("isolated structure constructors", () => {
  it("builds every registered prefab recipe with valid assets and collision", () => {
    const visited = new Set<string>();
    const problems: string[] = [];

    for (const prefab of PREFAB_IDS) {
      for (const footprint of FOOTPRINTS) {
        problems.push(...collisionProblems(
          `${prefab}[${footprint.join("x")}]`,
          prefabCollision(prefab, footprint),
        ));
        for (const kitId of KIT_IDS) {
          const kit = BUILDING_KITS[kitId];
          const count = structureVariantCount(prefab, footprint, kit);
          const seeds = count === 0 ? [0] : Array.from({ length: count }, (_, index) => index);
          for (const seed of seeds) {
            const variant = selectedStructureVariantId(prefab, footprint, seed, kit);
            if (variant) visited.add(variant);
            problems.push(...placementProblems(
              `${prefab}[${footprint.join("x")}] kit=${kitId} seed=${seed}`,
              buildPrefab(prefab, footprint, seed, kitId),
            ));
          }
        }
      }
    }

    expect(problems).toEqual([]);
    expect([...visited].sort()).toEqual(STRUCTURE_VARIANTS.map((variant) => variant.id).sort());
  });

  it("builds every composition and wall-run branch without loading the game", () => {
    const problems: string[] = [];
    for (const id of COMPOSITION_IDS) {
      for (const kit of KIT_IDS) {
        for (const seed of [0, 1, 7, 29, 977]) {
          problems.push(...placementProblems(
            `composition=${id} kit=${kit} seed=${seed}`,
            buildComposition(id, seed, kit),
          ));
        }
      }
    }

    const runs = [
      { length: 52, openings: [] },
      { length: 52, openings: [{ at: 26, width: 8 }] },
      { length: 34, openings: [{ at: 8, width: 4 }, { at: 26, width: 6 }] },
      { length: 6, openings: [{ at: 3, width: 8 }] },
    ] as const;
    for (const kitId of KIT_IDS) {
      const kit = BUILDING_KITS[kitId];
      for (const run of runs) {
        problems.push(...collisionProblems(
          `wall length=${run.length} kit=${kitId}`,
          wallRunCollision(run.length, run.openings),
        ));
        for (const seed of [0, 1, 2, 7, 29, 977]) {
          problems.push(...placementProblems(
            `wall length=${run.length} kit=${kitId} seed=${seed}`,
            buildWallRun(run.length, run.openings, kit, seed),
          ));
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps every declared structure asset in the real manifest", () => {
    const missing = [...prefabPartAssetIds(), ...compositionPartAssetIds()]
      .filter((assetId) => !manifestIds.has(assetId));
    expect(missing).toEqual([]);
  });

  it("keeps the Marchfield farm yard decorative and gives the chicken pen its own gate", () => {
    const parts = buildComposition("farm_yard", 1337, "plaster");
    const tags = parts.map((part) => part.tag);
    const assets = parts.map((part) => part.assetId);

    expect(tags.some((tag) => tag.startsWith("barn_"))).toBe(true);
    expect(tags.some((tag) => /^fence\d+$/.test(tag))).toBe(true);
    expect(tags.filter((tag) => tag.startsWith("fence_hen_"))).toHaveLength(12);
    expect(tags.filter((tag) => tag.startsWith("post_hen_gate_"))).toHaveLength(2);
    expect(parts.filter((part) => part.tag.startsWith("fence_hen_west_"))
      .map((part) => part.dz)).toEqual([-2, 4]);
    expect(assets).not.toContain("floor_brick");
    expect(assets.some((assetId) => assetId.startsWith("crop_"))).toBe(false);
  });

  it("keeps native Gravelmaw mouth rocks grounded and clear across all variants", async () => {
    const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
    const measured = new Map<string, { min: number[]; max: number[] }>();
    for (const id of ["corealm_rock_strata_1", "corealm_rock_strata_2"]) {
      const entry = manifest.assets.find(asset => asset.id === id) as { id: string; file: string } | undefined;
      expect(entry, `native geology asset ${id}`).toBeDefined();
      const bytes = readFileSync(new URL(`../game/public/assets/${entry!.file}`, import.meta.url));
      const document = await io.readBinary(new Uint8Array(bytes));
      const bounds = getBounds(document.getRoot().listScenes()[0]!);
      expect([...bounds.min, ...bounds.max].every(Number.isFinite)).toBe(true);
      measured.set(id, { min: [...bounds.min], max: [...bounds.max] });
    }
    // Transform the actual GLB bounds, including its pivot, rather than treating authored
    // placement coordinates as geometric centres. No rounded manifest dimensions are used.
    const worldBounds = (part: PartPlacement) => {
      const source = measured.get(part.assetId)!;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      const c = Math.cos(part.rotationY); const s = Math.sin(part.rotationY);
      for (const x of [source.min[0]!, source.max[0]!]) {
        for (const y of [source.min[1]!, source.max[1]!]) {
          for (const z of [source.min[2]!, source.max[2]!]) {
            const point = [
              part.dx + part.scale * (c * x + s * z),
              part.dy + part.scale * y,
              part.dz + part.scale * (-s * x + c * z),
            ];
            for (let axis = 0; axis < 3; axis++) {
              min[axis] = Math.min(min[axis]!, point[axis]!);
              max[axis] = Math.max(max[axis]!, point[axis]!);
            }
          }
        }
      }
      return { min, max };
    };
    const expectedTags = [
      "masonry_l", "masonry_r", "threshold", "approach_stone", "brazier_l", "brazier_r",
      "jaw_l", "jaw_r", "shoulder_l", "shoulder_r", "rear_l", "rear_r", "lip_l", "lip_r",
    ].sort();
    const thresholds = [[2.2, 0.58], [2.24, 0.62], [2.18, 0.56], [2.26, 0.6]] as const;
    const paths = [2.55, 2.48, 2.62, 2.52] as const;
    const variants = new Set<string>();
    for (let seed = 0; seed < 4; seed++) for (const kitId of KIT_IDS) {
      const kit = BUILDING_KITS[kitId];
      const parts = buildGravelmawMouthComposition(seed, kit);
      const label = `mouth variant ${seed}, kit ${kitId}`;
      expect(parts.map(part => part.tag).sort(), label).toEqual(expectedTags);
      expect(parts.some(part => part.tag.startsWith("crown_")), label).toBe(false);
      const byTag = new Map(parts.map(part => [part.tag, part]));
      for (const side of [-1, 1]) {
        expect(byTag.get(`masonry_${side < 0 ? "l" : "r"}`), label).toEqual({
          tag: `masonry_${side < 0 ? "l" : "r"}`, assetId: kit.gatePier,
          dx: side * 3.12, dy: -0.04, dz: 0.14, rotationY: 0, scale: 1.04,
        });
      }
      expect(byTag.get("threshold"), label).toEqual({
        tag: "threshold", assetId: "kerb_straight", dx: 0, dy: -0.035,
        dz: thresholds[seed]![1], rotationY: 0, scale: thresholds[seed]![0],
      });
      expect(byTag.get("approach_stone"), label).toMatchObject({
        assetId: "floor_brick", dx: 0, dz: paths[seed], rotationY: 0, scale: 2.2,
      });
      expect(byTag.get("approach_stone")!.dy).toBeCloseTo(-0.01, 10);
      const rocks = parts.filter(part => /^(jaw|shoulder|rear|lip)_[lr]$/.test(part.tag));
      expect(rocks, label).toHaveLength(8);
      variants.add(JSON.stringify(rocks));
      for (const rock of rocks) {
        expect(rock.assetId, `${label}, ${rock.tag}`).toBe(rock.tag.startsWith("jaw_")
          ? "corealm_rock_strata_1" : "corealm_rock_strata_2");
        expect(rock.scaleAxes, `${label}, uniform scale for ${rock.tag}`).toBeUndefined();
        expect(rock.scale).toBeGreaterThan(0);
        const box = worldBounds(rock);
        expect([...box.min, ...box.max].every(Number.isFinite)).toBe(true);
        if (rock.tag.endsWith("_l")) expect(box.max[0]!, `${label}, ${rock.tag} clear walk channel`).toBeLessThanOrEqual(-1.7);
        else expect(box.min[0]!, `${label}, ${rock.tag} clear walk channel`).toBeGreaterThanOrEqual(1.7);
        if (!rock.tag.startsWith("shoulder_")) {
          expect(box.min[1]!, `${label}, buried foot of ${rock.tag}`).toBeLessThan(0);
          expect(box.max[1]!, `${label}, exposed stone of ${rock.tag}`).toBeGreaterThan(0);
        }
        if (rock.tag.startsWith("lip_")) expect(box.max[2]!, `${label}, terrace lip ${rock.tag}`).toBeLessThanOrEqual(6);
      }
      for (const side of ["l", "r"]) {
        const jaw = worldBounds(byTag.get(`jaw_${side}`)!);
        const shoulder = worldBounds(byTag.get(`shoulder_${side}`)!);
        for (let axis = 0; axis < 3; axis++) {
          const overlap = Math.min(jaw.max[axis]!, shoulder.max[axis]!) - Math.max(jaw.min[axis]!, shoulder.min[axis]!);
          expect(overlap, `${label}, ${side} jaw supports shoulder on axis ${axis}`).toBeGreaterThan(0);
        }
      }
    }
    expect(variants.size).toBe(4);
  });
});
