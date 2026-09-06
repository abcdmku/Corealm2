import { NodeIO } from '@gltf-transform/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { createCaveLabFixture } from '../game/src/featureLab/cave.js';
import { buildDungeon, dungeonSolids, type CaveRockSource } from '../game/src/render/dungeon.js';
import { MaterialLibrary } from '../game/src/render/materials.js';

it('fits the real licensed scan outside the walking footprint with covered roof and bounded panel count', async () => {
  const document = await new NodeIO().read('art/rebuild/candidates/finish-cave-source/v5/models/cave/rock-face-01.glb');
  const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const geometry = new THREE.BufferGeometry();
  for (const [semantic, attribute, size] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]] as const) {
    geometry.setAttribute(attribute, new THREE.Float32BufferAttribute(primitive.getAttribute(semantic)!.getArray()!, size));
  }
  geometry.setIndex(new THREE.BufferAttribute(primitive.getIndices()!.getArray()! as Uint16Array, 1));
  expect(geometry.index!.count / 3).toBe(5210);
  const provenance = JSON.parse(await readFile('art/rebuild/candidates/finish-cave-source/v5/provenance.json', 'utf8'));
  const sourceUv = geometry.getAttribute('uv'), sourcePosition = geometry.getAttribute('position');
  let maxUvSpan = 0;
  for (let i = 0; i < geometry.index!.count; i += 3) for (let corner = 0; corner < 3; corner++) {
    const a = geometry.index!.getX(i + corner), b = geometry.index!.getX(i + (corner + 1) % 3);
    maxUvSpan = Math.max(maxUvSpan, Math.hypot(sourceUv.getX(a) - sourceUv.getX(b), sourceUv.getY(a) - sourceUv.getY(b)));
  }
  // Clipping inside one original triangle cannot exceed the original source's longest UV edge.
  expect(maxUvSpan).toBeLessThanOrEqual(0.062759);
  const boundaryDepths: number[] = [];
  for (let i = 0; i < sourcePosition.count; i++) {
    if (Math.abs(Math.abs(sourcePosition.getX(i)) - 1.5) < 1e-5
      || Math.abs(sourcePosition.getY(i)) < 1e-5 || Math.abs(sourcePosition.getY(i) - 2.6) < 1e-5) boundaryDepths.push(sourcePosition.getZ(i));
  }
  expect(boundaryDepths.length).toBeGreaterThan(100);
  expect(Math.max(...boundaryDepths) - Math.min(...boundaryDepths)).toBeLessThan(1e-6);
  for (let triangle = provenance.interiorTriangles; triangle < geometry.index!.count / 3; triangle++) {
    const [a, b, c] = [0, 1, 2].map(corner => new THREE.Vector3().fromBufferAttribute(sourcePosition, geometry.index!.getX(triangle * 3 + corner)));
    const cross = b!.sub(a!).cross(c!.sub(a!));
    expect(cross.length()).toBeGreaterThan(1e-10);
    expect(cross.z).toBeGreaterThan(0);
  }
  const textures = [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()];
  const material = new THREE.MeshStandardMaterial({ map: textures[0], normalMap: textures[1], roughnessMap: textures[2] });
  const rockSource: CaveRockSource = { geometry, material, provenance: 'Poly Haven Rock Face 01, Dario Barresi, CC0-1.0' };
  const maps = { albedo: textures[0]!, normal: textures[1]!, roughness: textures[2]!, tileMetres: 2.5,
    meanLinearRgb: [0.22, 0.18, 0.13] as [number, number, number] };
  const start = performance.now();
  const fixture = createCaveLabFixture({ scene: { root: new THREE.Group(), materials: new MaterialLibrary() },
    surfaceTextures: { bark: maps, leaf: maps, stone: maps }, rockSource });
  expect(performance.now() - start).toBeLessThan(5000);
  fixture.group.updateMatrixWorld(true);
  const state = fixture.getState(), facing = fixture.group.getObjectByName('dungeon-rock-facing') as THREE.Mesh;
  const blend = facing.geometry.getAttribute('caveSourceBlend');
  expect(facing.geometry.userData.roofMatchedBorderSamples).toBeGreaterThan(1000);
  expect(facing.geometry.userData.roofBorderPositionGap).toBe(0);
  expect(facing.geometry.userData.roofBorderNormalDegrees).toBe(0);
  const leftBorder = new Map<number, number>();
  for (let i = 0; i < sourcePosition.count; i++) if (Math.abs(sourcePosition.getX(i) + 1.5) < 1e-5) leftBorder.set(Math.round(sourcePosition.getY(i) * 1e5), i);
  const worldPosition = facing.geometry.getAttribute('position'), worldNormal = facing.geometry.getAttribute('normal');
  const columns = state.sourceFacing!.wallPanels / 3;
  for (let panel = 0; panel < state.sourceFacing!.wallPanels; panel++) for (let i = 0; i < sourcePosition.count; i++) {
    if (Math.abs(sourcePosition.getX(i) - 1.5) > 1e-5) continue;
    const opposite = leftBorder.get(Math.round(sourcePosition.getY(i) * 1e5))!;
    const next = Math.floor(panel / columns) * columns + (panel + 1) % columns;
    const a = panel * sourcePosition.count + i, b = next * sourcePosition.count + opposite;
    expect(new THREE.Vector3().fromBufferAttribute(worldPosition, a).distanceTo(new THREE.Vector3().fromBufferAttribute(worldPosition, b))).toBe(0);
    expect(new THREE.Vector3().fromBufferAttribute(worldNormal, a).angleTo(new THREE.Vector3().fromBufferAttribute(worldNormal, b))).toBeLessThan(1e-6);
  }
  let seamSamples = 0, maximumSourceColourJump = 0;
  for (let panel = 0; panel < state.sourceFacing!.wallPanels; panel++) for (let i = 0; i < sourcePosition.count; i++) {
    const edgeDistance = Math.min(sourcePosition.getX(i) + 1.5, 1.5 - sourcePosition.getX(i),
      sourcePosition.getY(i), 2.6 - sourcePosition.getY(i));
    if (edgeDistance > 1e-5) continue;
    const weight = blend.getX(panel * sourcePosition.count + i);
    // Even unrelated atlas colours cannot affect the join: source contribution is exactly zero.
    maximumSourceColourJump = Math.max(maximumSourceColourJump, Math.abs(0.70 * 0.35 * weight - 1.30 * 0.35 * weight));
    seamSamples++;
  }
  expect(seamSamples).toBeGreaterThan(1000);
  expect(maximumSourceColourJump).toBe(0);
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  (facing.material as THREE.MeshStandardMaterial).onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  expect(shader.fragmentShader).toContain('caveTexture(map)');
  expect(shader.fragmentShader).toContain('vCaveSourceBlend * 0.35');
  expect((facing.material as THREE.MeshStandardMaterial).map).toBe(maps.albedo);
  expect(state.sourceFacing).not.toBeNull();
  console.log('source-facing CPU metrics', state.sourceFacing);
  expect(state.sourceFacing!.wallPanels).toBeGreaterThan(4);
  expect(state.sourceFacing!.wallPanels + state.sourceFacing!.roofPanels).toBeLessThan(120);
  expect(state.sourceFacing!.renderedTriangles).toBeLessThan(475000);
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
  await mkdir('test-results/finish-cave-source-v5', { recursive: true });
  await writeFile('test-results/finish-cave-source-v5/cpu.json', JSON.stringify({ sourceFacing: state.sourceFacing,
    fallbackTriangles: fallback.triangles, sourceTotal: state.triangles, probes: state.probes,
    seamSamples, maximumSourceColourJump }, null, 2));
  console.log('triangle comparison', { fallback: fallback.triangles, sourceTotal: state.triangles });
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
}, 10000);






