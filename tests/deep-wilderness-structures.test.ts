import { describe, expect, it } from 'vitest';
import manifest from '../game/public/assets/manifest.json';
import { lintParts } from '../tools/lib/structure-geometry.js';
import type { PartPlacement } from '../game/src/render/buildings.js';
import { structureCollisionFromCompositionParts } from '../game/src/world/regionBuilder.js';
import {
  DEEP_WILDERNESS_STRUCTURE_IDS, DEEP_WILDERNESS_STRUCTURES,
  buildDeepWildernessStructure, buildDeepWildernessStructureCollisionParts,
} from '../game/src/render/compositions/deepWildernessStructures.js';

const assets = new Map(manifest.assets.map(asset => [asset.id, asset]));
function bounds(part: PartPlacement) {
  const asset = assets.get(part.assetId)!;
  const sx = part.scale * (part.scaleAxes?.[0] ?? 1), sy = part.scale * (part.scaleAxes?.[1] ?? 1);
  const sz = part.scale * (part.scaleAxes?.[2] ?? 1), cos = Math.cos(part.rotationY), sin = Math.sin(part.rotationY);
  const corners = [asset.base.x, asset.base.x + asset.size.x].flatMap(x =>
    [asset.base.z, asset.base.z + asset.size.z].map(z => [
      part.dx + x * sx * cos + z * sz * sin, part.dz - x * sx * sin + z * sz * cos,
    ]));
  return { tag: part.tag, minX: Math.min(...corners.map(corner => corner[0]!)),
    maxX: Math.max(...corners.map(corner => corner[0]!)), minZ: Math.min(...corners.map(corner => corner[1]!)),
    maxZ: Math.max(...corners.map(corner => corner[1]!)), minY: part.dy + asset.base.y * sy,
    maxY: part.dy + (asset.base.y + asset.size.y) * sy };
}
function pointDistance(x: number, z: number, box: ReturnType<typeof bounds>): number {
  return Math.hypot(Math.max(0, box.minX - x, x - box.maxX), Math.max(0, box.minZ - z, z - box.maxZ));
}

describe('deep Wilderness structures', () => {
  for (const id of DEEP_WILDERNESS_STRUCTURE_IDS) {
    const definition = DEEP_WILDERNESS_STRUCTURES[id];
    const parts = buildDeepWildernessStructure(id);
    const solids = buildDeepWildernessStructureCollisionParts(id);
    it(`${id} has supported original kit assemblies within the shared footprint`, () => {
      expect(lintParts(parts)).toEqual([]);
      expect(new Set(parts.map(part => part.tag)).size).toBe(parts.length);
      expect(parts.filter(part => part.assetId === 'torch')).toHaveLength(definition.torches.length);
      expect(solids.length).toBeGreaterThan(30);
      expect(solids.length).toBeLessThan(120);
      expect(solids.every(part => part.assetId === 'kerb_straight')).toBe(true);
      const [width, depth] = definition.footprint;
      for (const box of parts.map(bounds)) {
        expect(Math.max(Math.abs(box.minX), Math.abs(box.maxX)), box.tag).toBeLessThanOrEqual(width / 2 + .001);
        expect(Math.max(Math.abs(box.minZ), Math.abs(box.maxZ)), box.tag).toBeLessThanOrEqual(depth / 2 + .001);
      }
      expect(Math.max(...parts.map(part => bounds(part).maxY))).toBeGreaterThan(10);
    });

    it(`${id} preserves a ten-metre route and full encounter circles through actual geometry`, () => {
      const obstacles = [...parts, ...solids].map(bounds).filter(box => box.minY < 3 && box.maxY > .45);
      for (const box of obstacles) {
        expect(box.minX >= definition.clearWidth / 2 || box.maxX <= -definition.clearWidth / 2,
          `${box.tag} closes the axial lane`).toBe(true);
        for (const court of [...definition.courts, definition.keeper]) {
          expect(pointDistance(court.centre[0], court.centre[1], box), `${box.tag} enters an encounter circle`)
            .toBeGreaterThanOrEqual(court.radius - .001);
        }
      }
    });

    it(`${id} gives fifteen separated resident sockets and grounded inspection stops`, () => {
      for (const court of definition.courts) {
        expect(court.residentSockets).toHaveLength(15);
        for (const [index, socket] of court.residentSockets.entries()) {
          expect(Math.hypot(socket[0] - court.centre[0], socket[1] - court.centre[1]) + court.maxBodyRadius)
            .toBeLessThan(court.radius);
          for (const other of court.residentSockets.slice(index + 1)) {
            expect(Math.hypot(socket[0] - other[0], socket[1] - other[1])).toBeGreaterThan(court.maxBodyRadius * 2);
          }
        }
      }
      for (const stop of definition.inspectionStops) for (const part of solids) {
        expect(pointDistance(stop[0], stop[1], bounds(part))).toBeGreaterThan(1.2);
      }
    });

    it(`${id} retains its merged collision and open gate through production assembly and rotation`, () => {
      for (const rotationY of [0, .7, Math.PI]) {
        const assembled = structureCollisionFromCompositionParts(id, parts,
          { origin: [120, 9, 800], rotationY, ownerId: 'deep-structure-test' }, {
            assetSize: assetId => assets.get(assetId)?.size ?? null,
            assetCenterXZ: assetId => {
              const asset = assets.get(assetId);
              return asset ? { x: asset.base.x + asset.size.x / 2, z: asset.base.z + asset.size.z / 2 } : null;
            },
          });
        expect(assembled).toHaveLength(solids.length);
        for (let localZ = definition.clearThrough[1][1]; localZ <= definition.clearThrough[0][1]; localZ += 2) {
          const x = 120 + localZ * Math.sin(rotationY), z = 800 + localZ * Math.cos(rotationY);
          for (const solid of assembled) {
            expect(solid.kind).toBe('box');
            if (solid.kind !== 'box') continue;
            const dx = x - solid.position[0], dz = z - solid.position[2];
            const localX = dx * Math.cos(solid.rotationY) - dz * Math.sin(solid.rotationY);
            const localDepth = dx * Math.sin(solid.rotationY) + dz * Math.cos(solid.rotationY);
            const gap = Math.hypot(Math.max(0, Math.abs(localX) - solid.size[0] / 2),
              Math.max(0, Math.abs(localDepth) - solid.size[2] / 2));
            expect(gap, solid.id).toBeGreaterThan(definition.clearWidth / 2 - .02);
          }
        }
      }
    });
  }
});
