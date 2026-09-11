import { describe, expect, it } from 'vitest';
import manifest from '../game/public/assets/manifest.json';
import { lintParts } from '../tools/lib/structure-geometry.js';
import { structureCollisionFromCompositionParts } from '../game/src/world/regionBuilder.js';
import {
  WILDERNESS_RUIN_IDS, WILDERNESS_RUINS, buildWildernessRuin, buildWildernessRuinCollisionParts,
} from '../game/src/render/compositions/wildernessRuins.js';

const assets = new Map(manifest.assets.map(asset => [asset.id, asset]));

describe('Wilderness ruins', () => {
  for (const id of WILDERNESS_RUIN_IDS) {
    it(`${id} has supported masonry and real, mounted props`, () => {
      const parts = buildWildernessRuin(id);
      expect(lintParts(parts)).toEqual([]);
      expect(new Set(parts.map(part => part.tag)).size).toBe(parts.length);
      const torches = parts.filter(part => part.assetId === 'torch');
      expect(torches).toHaveLength(WILDERNESS_RUINS[id].torches.length);
      const collision = buildWildernessRuinCollisionParts(id);
      expect(collision.length).toBeGreaterThanOrEqual(5);
      expect(collision.length).toBeLessThan(70);
      expect(collision.some(part => part.tag.startsWith('stair_') || part.assetId.startsWith('rubble_'))).toBe(false);
      const highestWall = Math.max(...collision.filter(part => part.assetId === 'kerb_straight')
        .map(part => .134 * part.scale * (part.scaleAxes?.[1] ?? 1)));
      expect(highestWall).toBeGreaterThanOrEqual(id === 'wilderness_shattered_aqueduct' ? 4 : 3);
    });

    it(`${id} keeps the production navigation corridor open after world rotation`, () => {
      for (const rotationY of [0, .7, Math.PI]) {
        const solids = structureCollisionFromCompositionParts(id, buildWildernessRuin(id), {
          origin: [120, 9, 600], rotationY, ownerId: 'ruin-test',
        }, {
          assetSize: assetId => {
            const asset = assets.get(assetId) as {size?: {x:number;y:number;z:number}} | undefined;
            return asset?.size ?? null;
          },
          assetCenterXZ: assetId => {
            const asset = assets.get(assetId) as {size?: {x:number;z:number};base?: {x:number;z:number}} | undefined;
            return asset?.base && asset.size ? { x: asset.base.x + asset.size.x / 2,
              z: asset.base.z + asset.size.z / 2 } : null;
          },
        });
        expect(solids.length).toBeGreaterThanOrEqual(5);
        expect(solids.length).toBeLessThan(70);
        for (let localZ = -8; localZ <= 8; localZ += .5) {
          const worldX = 120 + localZ * Math.sin(rotationY);
          const worldZ = 600 + localZ * Math.cos(rotationY);
          for (const solid of solids) {
            if (solid.kind !== 'box') continue;
            const dx = worldX - solid.position[0], dz = worldZ - solid.position[2];
            const x = dx * Math.cos(solid.rotationY) - dz * Math.sin(solid.rotationY);
            const z = dx * Math.sin(solid.rotationY) + dz * Math.cos(solid.rotationY);
            const gapX = Math.max(0, Math.abs(x) - solid.size[0] / 2);
            const gapZ = Math.max(0, Math.abs(z) - solid.size[2] / 2);
            expect(Math.hypot(gapX, gapZ), solid.id).toBeGreaterThan(1.2);
          }
        }
      }
    });

    it(`${id} leaves the central walking route open and stays inside its scatter exclusion`, () => {
      const [width, depth] = WILDERNESS_RUINS[id].footprint;
      const parts = buildWildernessRuin(id);
      for (const part of parts) {
        const asset = assets.get(part.assetId) as {size: {x:number;y:number;z:number};base:{x:number;y:number;z:number}};
        const sx = part.scale * (part.scaleAxes?.[0] ?? 1);
        const sy = part.scale * (part.scaleAxes?.[1] ?? 1);
        const sz = part.scale * (part.scaleAxes?.[2] ?? 1);
        const cos = Math.cos(part.rotationY), sin = Math.sin(part.rotationY);
        const corners = [asset.base.x, asset.base.x + asset.size.x].flatMap(x =>
          [asset.base.z, asset.base.z + asset.size.z].map(z => [
            part.dx + x * sx * cos + z * sz * sin,
            part.dz - x * sx * sin + z * sz * cos,
          ]));
        const minX = Math.min(...corners.map(v => v[0]!));
        const maxX = Math.max(...corners.map(v => v[0]!));
        expect(Math.max(...corners.map(v => Math.abs(v[0]!))), part.tag).toBeLessThanOrEqual(width / 2);
        expect(Math.max(...corners.map(v => Math.abs(v[1]!))), part.tag).toBeLessThanOrEqual(depth / 2);
        const baseY = part.dy + asset.base.y * sy;
        const topY = baseY + asset.size.y * sy;
        if (baseY < 2.5 && topY > .45) {
          // Includes visual rubble and props, even when the production collider treats them as dressing.
          expect(minX >= 1.6 || maxX <= -1.6, `${id}:${part.tag} intrudes into the 3.2 m lane`).toBe(true);
        }
      }
    });
  }
});
