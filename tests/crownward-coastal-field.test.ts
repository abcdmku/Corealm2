import { describe, expect, it } from 'vitest';
import { buildWorldTerrainSpec } from '../game/src/app/worldSpec.js';
import {
  sampleOrganicBiomeWeights,
  sampleOrganicCoast,
} from '../game/src/world/organicFields.js';

const terrain = buildWorldTerrainSpec();
const biomes = terrain.biomes!;
const coast = terrain.coast!;
const bounds = terrain.bounds;

function winnerAt(x: number, z: number) {
  return sampleOrganicBiomeWeights(x, z, biomes).reduce((winner, sample) =>
    sample.weight > winner.weight ? sample : winner);
}

function biomeWeightAt(id: string, x: number, z: number): number {
  return sampleOrganicBiomeWeights(x, z, biomes).find((sample) => sample.id === id)!.weight;
}

function expectBiome(id: string, x: number, z: number): void {
  const winner = winnerAt(x, z);
  expect(winner.id, `${x},${z}: ${winner.id} wins with ${winner.weight.toFixed(3)}`).toBe(id);
}

describe('Crownward and Wilderness visual fields', () => {
  it('keeps Crownward unbroken from its broad interior to the dry eastern coast', () => {
    for (let z = -180; z <= 400; z += 20) {
      const dryCoast: number[] = [];
      for (let x = 400; x <= bounds.maxX + coast.collar; x += 5) {
        if (!sampleOrganicCoast(x, z, bounds, coast).land) continue;
        dryCoast.push(x);
        expectBiome('crownward', x, z);
      }
      expect(dryCoast.at(-1), `no eastern Crownward coast at z=${z}`).toBeGreaterThan(bounds.maxX);
    }
  });

  it('carries Crownward from its southern interior onto the dry southern coast', () => {
    for (let x = 400; x <= 680; x += 20) {
      const dryCoast: number[] = [];
      for (let z = -150; z >= bounds.minZ - coast.collar; z -= 5) {
        if (!sampleOrganicCoast(x, z, bounds, coast).land) continue;
        dryCoast.push(z);
        expectBiome('crownward', x, z);
      }
      expect(dryCoast.at(-1), `no southern Crownward coast at x=${x}`).toBeLessThan(bounds.minZ);
    }
  });

  it('hands Crownward to the northern biomes over a gradual band', () => {
    // These eastern transects cross open ground beyond the northern intent cores. Measuring several
    // longitudes rejects both an abrupt wall and a result that only looks gradual beside one anchor.
    for (const x of [450, 650, 700]) {
      const samples = Array.from({ length: 301 }, (_, offset) => {
        const z = 300 + offset;
        return { z, weight: biomeWeightAt('crownward', x, z) };
      });
      const crownwardSide = samples.filter((sample) => sample.weight >= 0.9).at(-1);
      const northernSide = samples.find((sample) =>
        sample.z > (crownwardSide?.z ?? 300) && sample.weight <= 0.1);
      expect(crownwardSide, `Crownward never reaches 90% at x=${x}`).toBeDefined();
      expect(northernSide, `Crownward never falls to 10% at x=${x}`).toBeDefined();
      const width = northernSide!.z - crownwardSide!.z;
      expect(width, `90%-to-10% handoff at x=${x}`).toBeGreaterThanOrEqual(75);
      expect(width, `90%-to-10% handoff at x=${x}`).toBeLessThanOrEqual(200);
    }
  });

  it('makes Wilderness the dominant biome across the expanded northern width', () => {
    for (let z = 560; z <= bounds.maxZ; z += 20) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 5) {
        expectBiome('wilderness', x, z);
      }
    }
  });

  it('transitions directly from Crownward to Wilderness without a third biome strip', () => {
    for (let x = 400; x <= 850; x += 10) for (let z = 400; z <= 650; z += 5) {
      expect(['crownward', 'wilderness'], `${x},${z}`).toContain(winnerAt(x, z).id);
    }
  });
});
