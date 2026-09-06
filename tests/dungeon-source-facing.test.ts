import { NodeIO } from '@gltf-transform/core';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { createCaveLabFixture } from '../game/src/featureLab/cave.js';
import { buildDungeon, dungeonSolids, type CaveRockSource } from '../game/src/render/dungeon.js';
import { MaterialLibrary } from '../game/src/render/materials.js';

/**
 * Shell obligations the scanned facing has to keep whatever the candidate looks like: it stays out of
 * the walking footprint, it covers every horizontal ray at standing and reach heights, it still leaves
 * the authored clearance under a lowered roof, and it does not move the walkable floor.
 *
 * These assertions were written against V5's clipped-collar geometry. V5 was rejected for normal
 * discontinuities and its candidate directory was deleted on acceptance, so they now run against the
 * accepted V7 envelope; the V5-only collar and border-matching assertions went with it.
 */
it('fits the accepted licensed scan outside the walking footprint with covered roof and bounded panel count', async () => {
  const document = await new NodeIO().read('art/rebuild/candidates/finish-cave-source/v7/models/cave/rock-face-01.glb');
  const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const extras = document.getRoot().listScenes()[0]!.getExtras() as { caveContinuousEnvelope?: boolean; caveDomainWarp?: { columns: number; rows: number } };
  const geometry = new THREE.BufferGeometry();
  for (const [semantic, attribute, size] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]] as const) {
    geometry.setAttribute(attribute, new THREE.Float32BufferAttribute(primitive.getAttribute(semantic)!.getArray()!, size));
  }
  geometry.setIndex(new THREE.BufferAttribute(primitive.getIndices()!.getArray()! as Uint16Array, 1));
  expect(geometry.index!.count / 3).toBe(7168);
  const textures = [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()];
  const material = new THREE.MeshStandardMaterial({ map: textures[0], normalMap: textures[1], roughnessMap: textures[2] });
  const rockSource: CaveRockSource = { geometry, material, provenance: 'Poly Haven Rock Face 01, Dario Barresi, CC0-1.0',
    continuousEnvelope: extras.caveContinuousEnvelope === true, domainWarp: extras.caveDomainWarp };
  const maps = { albedo: textures[0]!, normal: textures[1]!, roughness: textures[2]!, tileMetres: 2.5,
    meanLinearRgb: [0.22, 0.18, 0.13] as [number, number, number] };
  // No wall-clock assertion here. A hung or quadratic fixture is already caught by the test
  // timeout, and a second, tighter threshold inside the test only measured how many other asset
  // builders happened to be running — it failed at 5377 ms against 5 s, then again at 20.3 s.
  const fixture = createCaveLabFixture({ scene: { root: new THREE.Group(), materials: new MaterialLibrary() },
    surfaceTextures: { bark: maps, leaf: maps, stone: maps }, rockSource });
  fixture.group.updateMatrixWorld(true);
  const state = fixture.getState(), facing = fixture.group.getObjectByName('dungeon-rock-facing') as THREE.Mesh;
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  (facing.material as THREE.MeshStandardMaterial).onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  // Continuous world stone owns the colour, so no source atlas sample can reintroduce a join.
  expect(shader.fragmentShader).toContain('caveTexture(map)');
  expect(shader.fragmentShader).not.toContain('caveSourceMap');
  expect((facing.material as THREE.MeshStandardMaterial).map).toBe(maps.albedo);
  expect(state.sourceFacing).not.toBeNull();
  expect(state.sourceFacing!.wallPanels).toBeGreaterThan(4);
  expect(state.sourceFacing!.wallPanels + state.sourceFacing!.roofPanels).toBeLessThan(120);
  expect(state.sourceFacing!.renderedTriangles).toBeLessThan(650000);
  expect(state.sourceFacing!.renderedTriangles).toBeGreaterThan(50000);
  expect(state.textured).toBe(true);
  for (const probe of Object.values(state.probes)) expect(probe!.headroom).toBeGreaterThanOrEqual(7);
  const positions = facing.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 7) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    expect([x, y, z].every(Number.isFinite)).toBe(true);
    for (const chamber of fixture.spec.chambers) {
      if (y < chamber.floorY - 0.3 || y > chamber.floorY + 3.4) continue;
      expect(Math.hypot(x - chamber.centre[0], z - chamber.centre[1])).toBeGreaterThan(chamber.radius + 0.08);
    }
  }
  for (const chamber of fixture.spec.chambers) for (const rise of [0.3, 2, 4.5, 6.5]) {
    let sourceWallHits = 0, rockRays = 0;
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12;
      const ray = new THREE.Raycaster(new THREE.Vector3(...[chamber.centre[0], chamber.floorY + rise, chamber.centre[1]]),
        new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
      const hit = ray.intersectObject(fixture.group, true)[0];
      expect(hit).toBeDefined();
      // A low horizontal ray from the lower chamber may meet the authored uphill floor first.
      if (fixture.walkable.includes(hit!.object as THREE.Mesh)) continue;
      rockRays++;
      if (hit!.object === facing) sourceWallHits++;
    }
    expect(rockRays).toBeGreaterThan(5);
    expect(sourceWallHits, `continuous source coverage at ${chamber.id} +${rise}m`).toBe(rockRays);
  }
  const fallback = buildDungeon(fixture.spec, new MaterialLibrary());
  await mkdir('test-results/finish-cave-source-v7', { recursive: true });
  await writeFile('test-results/finish-cave-source-v7/shell.json', JSON.stringify({ sourceFacing: state.sourceFacing,
    fallbackTriangles: fallback.triangles, sourceTotal: state.triangles, probes: state.probes }, null, 2));
  expect(Array.from(fixture.walkable[0]!.geometry.getAttribute('position').array))
    .toEqual(Array.from(fallback.walkable[0]!.geometry.getAttribute('position').array));
  const cappedSpec = { ...fixture.spec, wallHeight: 4 };
  const capped = buildDungeon(cappedSpec, new MaterialLibrary(), { rockSource });
  capped.group.updateMatrixWorld(true);
  for (const chamber of cappedSpec.chambers) {
    const ray = new THREE.Raycaster(new THREE.Vector3(chamber.centre[0], chamber.floorY + 0.1, chamber.centre[1]), new THREE.Vector3(0, 1, 0));
    const hit = ray.intersectObjects(capped.blockers)[0];
    ray.ray.direction.set(0, -1, 0);
    const floorHit = ray.intersectObjects(capped.walkable)[0];
    expect(hit!.point.y - floorHit!.point.y).toBeGreaterThanOrEqual(3.99);
  }
  const sourceCeilings = dungeonSolids(fixture.spec, { rockSource }).filter(solid => solid.id.startsWith('dungeon-source-ceiling'));
  expect(sourceCeilings.length).toBeGreaterThan(10);
  expect(sourceCeilings.every(solid => solid.position[1] >= fixture.spec.chambers[0]!.floorY + 4)).toBe(true);
  for (const built of [fallback, capped]) built.group.traverse(object => {
    if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); }
  });
  fixture.dispose(); geometry.dispose(); material.dispose(); textures.forEach(texture => texture.dispose());
});
