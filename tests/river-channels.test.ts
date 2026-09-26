import { describe, expect, it, vi } from 'vitest';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import * as THREE from 'three';
import { carveRiverTerrain, riverSections, riverSurfaceHeight, riverWaterBodies, sampleRiverChannel, type RiverChannel } from '../game/src/world/riverChannels.js';
import { dryNavigationMeshes } from '../game/src/world/waterNavigation.js';
import { createRiverSurface } from '../game/src/render/riverSurface.js';
import type { MaterialLibrary } from '../game/src/render/materials.js';
import { sampleLavaChannel } from '../game/src/content/wildernessLava.js';
import { CROWNWARD_RIVER_CHANNELS } from '../game/src/content/crownwardRiver.js';
import { WORLD_SITES } from '../game/src/content/worldSites.js';
import { RESOURCE_PLACEMENTS } from '../game/src/content/worldData.js';

const river: RiverChannel = { id: 'test-river', points: [[0, 0], [20, 0], [40, 0]], bedHeights: [3, 1, -1],
  halfWidth: 5, depth: 2, bankWidth: 8, seed: 47, openEnds: [true, true], naturalBanks: true };

describe('continuous freshwater channels', () => {
  it('ends Pearlwater below the eastern mountains without moving authored fisheries', () => {
    const channel = CROWNWARD_RIVER_CHANNELS.find(row => row.id === 'pearlwater')!;
    expect(carveRiverTerrain(150, 860, 175, [channel])).toBe(150);
    expect(carveRiverTerrain(30, 716, 180, [channel])).toBeLessThan(0);
    expect(carveRiverTerrain(50, 770, 180, [channel])).toBe(50);
    for (let index = 1; index <= 3; index++) {
      const id = `pearlwater_salmon_${index}`;
      expect(WORLD_SITES.find(site => site.id === id)!.centre)
        .toEqual(RESOURCE_PLACEMENTS.find(cluster => cluster.id === `${id}_spots`)!.centre);
    }
  });
  it('loads approaching channels once and retains the exact full-scene geometry', () => {
    const source=new MeshStandardNodeMaterial(), materials={createWaterVariant:()=>source.clone()} as unknown as MaterialLibrary;
    const channels=[river,{...river,id:'far',points:river.points.map(([x,z])=>[x+400,z] as [number,number])}];
    const full=createRiverSurface(channels,materials);
    const streamed=createRiverSurface(channels,materials,undefined,{stream:true});
    expect(streamed.group.children).toHaveLength(0);
    streamed.prepareArea(20,0,60); streamed.prepareArea(20,0,60);
    expect(streamed.group.children.map(o=>o.name)).toEqual(['river-water:test-river']);
    streamed.prepareArea(420,0,60);
    for(const [i,object] of streamed.group.children.entries()) {
      const actual=(object as THREE.Mesh).geometry,expected=(full.group.children[i] as THREE.Mesh).geometry;
      expect(actual.index!.array).toEqual(expected.index!.array);
      for(const name of Object.keys(expected.attributes)) expect(actual.getAttribute(name).array).toEqual(expected.getAttribute(name).array);
    }
    full.dispose();streamed.dispose();source.dispose();
  });
  it('ends the water at the rendered ground, including shores displaced from the authored contour', () => {
    const pool: RiverChannel = { ...river, id: 'grounded-pool', points: [[0, 0], [20, 0], [40, 0]], bedHeights: [1, 1, 1] };
    // A sloping rendered bank crosses the water inside the authored channel.
    const ground = (_x: number, z: number) => 1 + Math.abs(z) * .8;
    const source = new MeshStandardNodeMaterial();
    const built = createRiverSurface([pool], { createWaterVariant: () => source.clone() } as unknown as MaterialLibrary, ground);
    const mesh = built.group.children[0] as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position');
    const depths = mesh.geometry.getAttribute('aWaterDepth');
    let shoreVertices = 0;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i), y = positions.getY(i);
      expect(ground(x, z)).toBeLessThanOrEqual(y + .0001);
      if (x > 10 && x < 30 && depths.getX(i) < .0001) {
        expect(ground(x, z)).toBeCloseTo(y, 4);
        shoreVertices++;
      }
    }
    expect(shoreVertices).toBeGreaterThan(20);
    expect((mesh.material as THREE.MeshStandardMaterial).opacity).toBe(1);
    built.dispose(); source.dispose();
  });
  it('uses the same indented Crownmere shoreline for terrain, visible water and shore vegetation', () => {
    const lake = CROWNWARD_RIVER_CHANNELS[0]!;
    const body = riverWaterBodies([lake])[0]!;
    expect(body.id).toBe('lake:crownmere');
    expect(body.contour).toHaveLength(192);
    const source = new MeshStandardNodeMaterial();
    const built = createRiverSurface(CROWNWARD_RIVER_CHANNELS, { createWaterVariant: () => source.clone() } as unknown as MaterialLibrary);
    built.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (const [x, z] of body.contour) {
      expect(sampleRiverChannel(lake, x, z).signedDistance).toBeCloseTo(0, 6);
      const insetX = body.centre[0] + (x - body.centre[0]) * .97;
      const insetZ = body.centre[1] + (z - body.centre[1]) * .97;
      ray.set(new THREE.Vector3(insetX, 30, insetZ), new THREE.Vector3(0, -1, 0));
      expect(ray.intersectObject(built.group, true).length).toBeGreaterThan(0);
      expect(carveRiverTerrain(15, insetX, insetZ, CROWNWARD_RIVER_CHANNELS)).toBeLessThan(body.level);
    }
    // Concave stretches distinguish coves from an oval with small noisy edges.
    const turns = body.contour.map((b, i, points) => {
      const a = points[(i + points.length - 1) % points.length]!, c = points[(i + 1) % points.length]!;
      return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    });
    expect(turns.some(turn => turn < 0)).toBe(true);
    for (const row of riverSections(CROWNWARD_RIVER_CHANNELS[1]!, 1)) {
      if (riverSurfaceHeight(CROWNWARD_RIVER_CHANNELS[1]!, row.progress) <= -5.225) continue;
      ray.set(new THREE.Vector3(row.x, 30, row.z), new THREE.Vector3(0, -1, 0));
      expect(ray.intersectObject(built.group, true).length).toBeGreaterThan(0);
    }
    built.dispose(); source.dispose();
  });
  it('grades Crownmere and Pearlwater into broader banks without moving their waterlines', () => {
    for (const [index, channel] of CROWNWARD_RIVER_CHANNELS.entries()) {
      const old = { ...channel, bankWidth: index === 0 ? 10 : 4 };
      const row = riverSections(channel).find(row => row.progress >= .4)!;
      const maxGrade = (shape: RiverChannel) => {
        let grade = 0;
        for (let offset = 0; offset < 36; offset += .25) {
          const height = (extra: number) => carveRiverTerrain(8,
            row.x - row.tz * (row.rightHalfWidth + offset + extra),
            row.z + row.tx * (row.rightHalfWidth + offset + extra), [shape]);
          grade = Math.max(grade, Math.abs(height(.25) - height(0)) / .25);
        }
        return grade;
      };
      expect(maxGrade(channel)).toBeLessThan(maxGrade(old) * .6);
      expect(riverSurfaceHeight(channel, .4)).toBe(riverSurfaceHeight(old, .4));
    }
  });
  it('uses independent ripple settings and the absolute environment clock without acceleration', () => {
    const createWaterVariant = vi.fn((_region: string, overrides: NonNullable<Parameters<MaterialLibrary['createWaterVariant']>[1]>) =>
      new MeshStandardNodeMaterial());
    const built = createRiverSurface([river], { createWaterVariant } as unknown as MaterialLibrary);
    expect(createWaterVariant).toHaveBeenCalledTimes(1);
    const [region, options] = createWaterVariant.mock.calls[0]!;
    expect(region).toBe('crownward');
    expect(options.waveScrollA!.toArray()).toEqual([-.003, .0005]);
    expect(options.waveScrollB!.toArray()).toEqual([-.005, -.001]);
    expect(options.edgeFade).toBe(.045);
    built.update(100);
    built.update(100.016);
    expect(options.time!.value).toBe(100.016);
    built.update(100.016);
    expect(options.time!.value).toBe(100.016);
    const material = (built.group.children[0] as THREE.Mesh).material as MeshStandardNodeMaterial;
    expect(material.isMeshStandardNodeMaterial).toBe(true);
    built.dispose();
  });
  it('renders the exact broad lake footprint and every metre of its outlet without a capsule/ribbon gap', () => {
    const lake: RiverChannel = { id: 'coverage-lake', kind: 'pool', points: [[435,235],[460,228],[485,220],[505,210]],
      widths: [22,38,34,14], halfWidth: 36, bedHeights: [-1,-1,-1,-1], depth: 2, bankWidth: 10, seed: 40401, naturalBanks: true };
    const outlet: RiverChannel = { id: 'coverage-outlet', points: [[495,214],[515,200],[535,195],[555,195]],
      widths: [9,6,4,4], halfWidth: 5, bedHeights: [-1,-1,-1.05,-1.1], depth: 2, bankWidth: 4,
      seed: 40402, openEnds: [true,true], naturalBanks: true };
    const source = new MeshStandardNodeMaterial();
    const built = createRiverSurface([lake, outlet], { createWaterVariant: () => source.clone() } as unknown as MaterialLibrary);
    built.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const missing: string[] = [];
    for (const row of riverSections(outlet, .5)) {
      ray.set(new THREE.Vector3(row.x, 20, row.z), new THREE.Vector3(0,-1,0));
      if (!ray.intersectObject(built.group, true).length) missing.push(`outlet:${row.x},${row.z}`);
    }
    for (let x = 420; x <= 530; x += 3) for (let z = 195; z <= 260; z += 3) {
      if (sampleLavaChannel(lake, x, z).signedDistance > -1) continue;
      ray.set(new THREE.Vector3(x, 20, z), new THREE.Vector3(0,-1,0));
      if (!ray.intersectObject(built.group, true).length) missing.push(`lake:${x},${z}`);
    }
    built.dispose(); source.dispose();
    expect(missing).toEqual([]);
  });
  it('cuts a submerged bed and returns continuously to untouched banks', () => {
    expect(carveRiverTerrain(10, 20, 0, [river])).toBeCloseTo(1, 5);
    expect(riverSurfaceHeight(river, .5)).toBe(3);
    expect(carveRiverTerrain(10, 20, 100, [river])).toBe(10);
    const section = riverSections(river).find(row => Math.abs(row.progress - .5) < .02)!;
    const shore = carveRiverTerrain(10, section.x, section.z + section.rightHalfWidth, [river]);
    expect(shore).toBeCloseTo(riverSurfaceHeight(river, section.progress), 1);
  });
  it('uses local descending water levels, not an upstream-height exclusion over the whole river', () => {
    const bodies = riverWaterBodies([river]);
    expect(bodies.length).toBeGreaterThan(25);
    expect(bodies.every(body => body.closed && body.contour.length >= 8 && body.depth >= 2)).toBe(true);
    // Each conservative mask includes its adjacent 1.2m sample on this 0.1 slope.
    expect(bodies.at(-1)!.level).toBeLessThan(bodies[0]!.level - 3.85);
    expect(bodies.at(-1)!.level).toBeLessThan(1.15);
  });
  it('keeps a connected pool flat and matches the river inlet elevation', () => {
    const pool: RiverChannel = { ...river, id: 'pool', kind: 'pool', points: [[-20, 0], [-10, 0], [0, 0]], bedHeights: [3, 3, 3], halfWidth: 12 };
    expect(riverSections(pool).every(row => riverSurfaceHeight(pool, row.progress) === 5)).toBe(true);
    expect(riverSurfaceHeight(pool, 1)).toBe(riverSurfaceHeight(river, 0));
    expect(carveRiverTerrain(10, 0, 0, [pool, river])).toBeCloseTo(carveRiverTerrain(10, 0, 0, [river, pool]), 6);
  });
  it('removes a submerged crossing while retaining an elevated bridge deck', () => {
    const material = new THREE.MeshBasicMaterial();
    const surface = (y: number) => {
      const geometry = new THREE.PlaneGeometry(2, 4);
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(20, y, 0);
      return mesh;
    };
    const underwater = surface(1), bridge = surface(4);
    const result = dryNavigationMeshes([underwater, bridge], riverWaterBodies([river]));
    expect(result.sourceTriangles).toBe(4);
    expect(result.excludedTriangles).toBe(2);
    expect(result.meshes.reduce((sum, mesh) => sum + mesh.geometry.getIndex()!.count, 0)).toBe(6);
    for (const mesh of [...result.meshes, underwater, bridge]) mesh.geometry.dispose();
    material.dispose();
  });
});
