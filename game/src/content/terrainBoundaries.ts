import type { WorldTerrain } from './schema/worldTerrain.js';

export interface BoundaryRect { minX: number; maxX: number; minZ: number; maxZ: number }
interface Region { id: string; bounds: { min: readonly [number, number]; max: readonly [number, number] } }
export interface BoundaryBand { kind: 'coast' | 'mountain'; edge: string; bounds: BoundaryRect; width: number }
export const coreRegionBounds = (region: Region): BoundaryRect => ({ minX: region.bounds.min[0], maxX: region.bounds.max[0], minZ: region.bounds.min[1], maxZ: region.bounds.max[1] });

export function terrainCoreBounds(regions: readonly Region[], terrain: WorldTerrain): BoundaryRect {
  const members = regions.filter(region => terrain.regionIds.includes(region.id));
  if (!members.length) throw new Error(`Terrain ${terrain.id} has no regions`);
  return { minX: Math.min(...members.map(r => r.bounds.min[0])), maxX: Math.max(...members.map(r => r.bounds.max[0])), minZ: Math.min(...members.map(r => r.bounds.min[1])), maxZ: Math.max(...members.map(r => r.bounds.max[1])) };
}

/** Maximum authored land envelope, not a promise that every point is dry or navigable. */
export function regionBoundaryGeometry(region: Region, regions: readonly Region[], terrains: readonly WorldTerrain[]): { full: BoundaryRect; core: BoundaryRect; bands: BoundaryBand[] } {
  const core = coreRegionBounds(region), full = { ...core }, bands: BoundaryBand[] = [];
  const terrain = terrains.find(row => row.regionIds.includes(region.id));
  if (!terrain) return { core, full, bands };
  const world = terrainCoreBounds(regions, terrain), width = terrain.coast.shoreline[1];
  if (core.minX === world.minX) full.minX -= width;
  if (core.maxX === world.maxX) full.maxX += width;
  if (core.minZ === world.minZ) full.minZ -= width;
  if (core.maxZ === world.maxZ) full.maxZ += width;
  if (full.minX < core.minX) bands.push({ kind: 'coast', edge: 'west', width, bounds: { ...full, maxX: core.minX } });
  if (full.maxX > core.maxX) bands.push({ kind: 'coast', edge: 'east', width, bounds: { ...full, minX: core.maxX } });
  if (full.minZ < core.minZ) bands.push({ kind: 'coast', edge: 'south', width, bounds: { ...full, maxZ: core.minZ } });
  if (full.maxZ > core.maxZ) bands.push({ kind: 'coast', edge: 'north', width, bounds: { ...full, minZ: core.maxZ } });
  for (const mountain of terrain.mountains.filter(row => row.regionId === region.id)) {
    const bounds = { ...core, minX: mountain.startX, maxX: mountain.startX + mountain.width };
    bands.push({ kind: 'mountain', edge: mountain.edge, width: mountain.width, bounds });
    // The profile width controls the rise, not a cliff cutoff. Its massifs can remain dry
    // through the sampled collar beyond the ordinary shore reach.
    full.maxX = Math.max(full.maxX, bounds.maxX, world.maxX + terrain.coast.collar);
  }
  return { core, full, bands };
}
