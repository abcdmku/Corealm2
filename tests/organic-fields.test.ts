import { describe, expect, it } from "vitest";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { REGIONS } from "../game/src/content/regions.js";
import { resourceDef } from "../game/src/content/resources.js";
import {
  organicDistance,
  organicRadiusScale,
  sampleOrganicBiomeWeights,
  sampleOrganicCoast,
  sampleOrganicContour,
  seedFromText,
  type OrganicBiomeSpec,
  type OrganicShapeSpec,
} from "../game/src/world/organicFields.js";
import { waterBasinForCluster } from "../game/src/world/waterBodies.js";

const SHAPE: OrganicShapeSpec = {
  seed: seedFromText("test-pool"),
  irregularity: 0.3,
  lobes: 5,
  aspectRatio: 0.76,
  rotation: 0.61,
};

describe("organic world fields", () => {
  it("keeps elongated asymmetric contours deterministic, bounded, and invertible", () => {
    expect(seedFromText("blackwater_spots")).toBe(seedFromText("blackwater_spots"));
    expect(seedFromText("blackwater_spots")).not.toBe(seedFromText("cairn_tarn_spots"));

    const scales: number[] = [];
    for (let step = 0; step < 128; step += 1) {
      const angle = step / 128 * Math.PI * 2;
      const scale = organicRadiusScale(angle, SHAPE);
      scales.push(scale);
      expect(scale).toBeGreaterThanOrEqual((SHAPE.aspectRatio ?? 1) * (1 - SHAPE.irregularity));
      expect(scale).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.2);
    const oppositeDifference = Math.max(...scales.slice(0, 64).map((scale, index) => (
      Math.abs(scale - scales[index + 64]!)
    )));
    expect(oppositeDifference).toBeGreaterThan(0.05);

    const contour = sampleOrganicContour(10, -4, 20, SHAPE, 40);
    expect(contour).toHaveLength(40);
    expect(contour).toEqual(sampleOrganicContour(10, -4, 20, SHAPE, 40));
    for (const [x, z] of contour) {
      expect(Math.hypot(x - 10, z + 4)).toBeLessThanOrEqual(20);
      expect(organicDistance(x - 10, z + 4, SHAPE)).toBeCloseTo(20, 8);
    }

    const cosine = Math.cos(SHAPE.rotation ?? 0);
    const sine = Math.sin(SHAPE.rotation ?? 0);
    const major = contour.map(([x, z]) => (x - 10) * cosine + (z + 4) * sine);
    const minor = contour.map(([x, z]) => -(x - 10) * sine + (z + 4) * cosine);
    const majorWidth = Math.max(...major) - Math.min(...major);
    const minorWidth = Math.max(...minor) - Math.min(...minor);
    expect(minorWidth / majorWidth).toBeLessThan(0.9);
  });

  it("gives each authored lake one bounded silhouette while preserving its fishing floor", () => {
    const clusters = REGIONS.flatMap((region) => region.clusters)
      .filter((cluster) => !cluster.waterBodyId && resourceDef(cluster.resourceId).archetype === "fishing_spot");
    const basins = clusters.map(waterBasinForCluster);

    expect(clusters.map((cluster) => cluster.id)).toEqual([
      "redsill_spots",
      "blackwater_spots",
      "cairn_tarn_spots",
      "far_tarn_spots",
      "ashfin_spring_spots",
    ]);
    expect(new Set(basins.map((basin) => (
      `${basin.shape.aspectRatio}:${basin.shape.irregularity}:${basin.shape.lobes}`
    ))).size).toBe(basins.length);
    expect(new Set(basins.map((basin) => basin.shape.rotation)).size).toBe(basins.length);

    basins.forEach((basin, index) => {
      const cluster = clusters[index]!;
      const minimumScale = (basin.shape.aspectRatio ?? 1) * (1 - basin.shape.irregularity);
      expect(basin.floorRadius * minimumScale).toBeGreaterThan(cluster.radius);
      expect(basin.floorRadius).toBeLessThan(basin.shoreRadius);
      expect(basin.shoreRadius).toBeLessThan(basin.crestRadius);
      expect(basin.crestRadius).toBeLessThan(basin.outerRadius);

      const outer = sampleOrganicContour(basin.x, basin.z, basin.outerRadius, basin.shape, 96);
      for (const [x, z] of outer) {
        expect(Math.hypot(x - basin.x, z - basin.z)).toBeLessThanOrEqual(basin.outerRadius);
        expect(organicDistance(x - basin.x, z - basin.z, basin.shape)).toBeCloseTo(
          basin.outerRadius,
          8,
        );
      }

      const rotation = basin.shape.rotation ?? 0;
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      const major = outer.map(([x, z]) => (x - basin.x) * cosine + (z - basin.z) * sine);
      const minor = outer.map(([x, z]) => -(x - basin.x) * sine + (z - basin.z) * cosine);
      const majorWidth = Math.max(...major) - Math.min(...major);
      const minorWidth = Math.max(...minor) - Math.min(...minor);
      expect(minorWidth / majorWidth).toBeLessThan(0.9);

      const scales = Array.from({ length: 96 }, (_, step) => (
        organicRadiusScale(step / 96 * Math.PI * 2, basin.shape)
      ));
      const oppositeDifference = Math.max(...scales.slice(0, 48).map((scale, step) => (
        Math.abs(scale - scales[step + 48]!)
      )));
      expect(oppositeDifference).toBeGreaterThan(0.045);
    });
  });

  it("keeps climate fields deterministic, finite, normalized, and seed-sensitive", () => {
    const biomeSpec: OrganicBiomeSpec<"north" | "east" | "west"> = {
      warp: { seed: seedFromText("test-biome-warp"), scale: 48, strength: 6 },
      climate: { seed: seedFromText("test-biome-climate"), scales: [72, 28], strength: 1.2 },
      edgeScale: 36,
      edgeStrength: 0.35,
      temperature: 0.48,
      fields: [
        {
          id: "north",
          seed: seedFromText("test-biome:north"),
          climateTarget: [0.35, -0.25],
          climateTolerance: [0.72, 0.68],
          anchors: [{ id: "north-intent", centre: [0, 24], radius: 28 }],
        },
        {
          id: "east",
          seed: seedFromText("test-biome:east"),
          climateTarget: [-0.2, 0.4],
          climateTolerance: [0.7, 0.7],
          anchors: [{ id: "east-intent", centre: [24, 0], radius: 28 }],
        },
        {
          id: "west",
          seed: seedFromText("test-biome:west"),
          climateTarget: [-0.45, -0.15],
          climateTolerance: [0.68, 0.72],
          anchors: [{ id: "west-intent", centre: [-24, 0], radius: 28 }],
        },
      ],
    };
    const points = Array.from({ length: 25 }, (_, index) => {
      const x = (index % 5 - 2) * 18;
      const z = (Math.floor(index / 5) - 2) * 18;
      return [x, z] as const;
    });
    const first = points.map(([x, z]) => sampleOrganicBiomeWeights(x, z, biomeSpec));
    expect(points.map(([x, z]) => sampleOrganicBiomeWeights(x, z, biomeSpec))).toEqual(first);
    for (const weights of first) {
      expect(weights).toHaveLength(biomeSpec.fields.length);
      expect(weights.every(({ weight }) => Number.isFinite(weight) && weight >= 0 && weight <= 1)).toBe(true);
      expect(weights.reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(1, 10);
    }
    const changedClimate = {
      ...biomeSpec,
      climate: { ...biomeSpec.climate, seed: seedFromText("test-biome-climate:changed") },
    };
    const changed = points.map(([x, z]) => sampleOrganicBiomeWeights(x, z, changedClimate));
    expect(changed.some((weights, pointIndex) => weights.some((sample, fieldIndex) => (
      Math.abs(sample.weight - first[pointIndex]![fieldIndex]!.weight) > 1e-9
    )))).toBe(true);
  });

  it("holds every Corealm biome intent and stays continuous at its centre", () => {
    const spec = buildWorldTerrainSpec();
    expect(spec.biomes).toBeDefined();
    for (const field of spec.biomes!.fields) {
      for (const anchor of field.anchors) {
        const [x, z] = anchor.centre;
        const centre = sampleOrganicBiomeWeights(x, z, spec.biomes!);
        const own = centre.find((sample) => sample.id === field.id);
        expect(own?.weight).toBeGreaterThan(0.999);
        const influenceRadius = Math.abs(anchor.radius);
        const holdRadius = Math.min(
          Math.abs(anchor.holdRadius ?? influenceRadius * 0.2),
          Math.max(0.001, influenceRadius - 0.001),
        );
        const corePoints = [
          [x, z],
          [x + holdRadius * 0.9, z],
          [x - holdRadius * 0.9, z],
          [x, z + holdRadius * 0.9],
          [x, z - holdRadius * 0.9],
        ] as const;
        for (const [coreX, coreZ] of corePoints) {
          const core = sampleOrganicBiomeWeights(coreX, coreZ, spec.biomes!);
          const coreOwn = core.find((sample) => sample.id === field.id);
          expect(coreOwn?.weight).toBeGreaterThan(0.999);
          expect(core.every(({ weight }) => Number.isFinite(weight))).toBe(true);
          expect(core.reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(1, 10);
        }
        const justOutside = sampleOrganicBiomeWeights(x + holdRadius + 0.01, z, spec.biomes!);
        const outsideOwn = justOutside.find((sample) => sample.id === field.id);
        expect(outsideOwn).toBeDefined();
        expect(justOutside.every(({ weight }) => Number.isFinite(weight))).toBe(true);
        expect(justOutside.reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(1, 10);
        expect(Math.abs(outsideOwn!.weight - own!.weight)).toBeLessThan(0.02);
      }
    }
  });

  it("keeps the coast deterministic", () => {
    const bounds = { minX: -360, maxX: 340, minZ: -200, maxZ: 200 } as const;
    const coastSpec = {
      seed: seedFromText("corealm:coast"),
      shoreline: [18, 190] as const,
    };
    const points = [
      [-360, -200],
      [340, 0],
      [-10, 200],
      [-360, 100],
      [410, 80],
    ] as const;
    const first = points.map(([x, z]) => sampleOrganicCoast(x, z, bounds, coastSpec));
    expect(points.map(([x, z]) => sampleOrganicCoast(x, z, bounds, coastSpec))).toEqual(first);
  });

  it("keeps the playable rectangle dry", () => {
    const bounds = { minX: -360, maxX: 340, minZ: -200, maxZ: 200 } as const;
    const coastSpec = {
      seed: seedFromText("corealm:coast"),
      shoreline: [18, 190] as const,
    };
    const points = [
      [bounds.minX, bounds.minZ],
      [bounds.maxX, bounds.minZ],
      [bounds.maxX, bounds.maxZ],
      [bounds.minX, bounds.maxZ],
      [0, 0],
    ] as const;
    for (const [x, z] of points) {
      expect(sampleOrganicCoast(x, z, bounds, coastSpec).land).toBe(true);
    }
  });

  it("turns points beyond the maximum reach into water", () => {
    const bounds = { minX: -360, maxX: 340, minZ: -200, maxZ: 200 } as const;
    const coastSpec = {
      seed: seedFromText("corealm:coast"),
      shoreline: [18, 190] as const,
    };
    const beyond = Math.max(...coastSpec.shoreline) + 1;
    const points = [
      [bounds.maxX + beyond, 0],
      [bounds.minX - beyond, 0],
      [0, bounds.maxZ + beyond],
      [0, bounds.minZ - beyond],
    ] as const;
    for (const [x, z] of points) {
      const sample = sampleOrganicCoast(x, z, bounds, coastSpec);
      expect(sample.land).toBe(false);
      expect(sample.remaining).toBe(0);
    }
  });

  it("has coarse asymmetric reach diversity around the rectangle", () => {
    const bounds = { minX: -360, maxX: 340, minZ: -200, maxZ: 200 } as const;
    const coastSpec = {
      seed: seedFromText("corealm:coast"),
      shoreline: [18, 190] as const,
    };
    const edgePoints = [
      [-185, -200], [165, -200],
      [340, -100], [340, 100],
      [165, 200], [-185, 200],
      [-360, 100], [-360, -100],
    ] as const;
    const reaches = edgePoints.map(([x, z]) => sampleOrganicCoast(x, z, bounds, coastSpec).remaining);
    expect(
      Math.max(...reaches) - Math.min(...reaches) > 40
        && Math.abs(reaches[0]! - reaches[4]!) > 5,
    ).toBe(true);
  });
});
