import { arr, lit, num, obj, ref, str, tuple, type Infer } from './core.js';

/** Terrain boundaries are authored content, shared by the game and the map editor. */
export const WorldTerrainSchema = obj({
  id: str(),
  regionIds: arr(ref('region', { role: 'Terrain for' }), {}, { role: 'Terrain for' }),
  coast: obj({
    seed: num({ integer: true }),
    collar: num({ min: 1 }, { label: 'Terrain collar', unit: 'm' }),
    shoreline: tuple([num({ min: 0 }, { label: 'Minimum coast width', unit: 'm' }), num({ min: 1 }, { label: 'Maximum coast width', unit: 'm' })] as const),
    seaLevel: num({}, { unit: 'm' }),
    floorDepth: num({ min: 0 }, { unit: 'm' }),
    gridStep: num({ min: 0.25 }, { unit: 'm' }),
    oceanSize: num({ min: 1 }, { unit: 'm' }),
  }),
  mountains: arr(obj({
    regionId: ref('region', { role: 'Mountain boundary in' }),
    kind: lit('mountain'), edge: lit('east'),
    startX: num({}, { label: 'Mountain start X', unit: 'm' }),
    width: num({ min: 1 }, { label: 'Mountain width', unit: 'm' }),
    seed: num({ integer: true }),
    massifs: arr(obj({ x: num(), z: num(), radiusX: num({ min: 1 }), radiusZ: num({ min: 1 }), height: num({ min: 0 }), variant: num({ integer: true, min: 0, max: 2 }), rotation: num() })),
  }), {}, { role: 'Mountain boundary in' }),
});
export type WorldTerrain = Infer<typeof WorldTerrainSchema>;
