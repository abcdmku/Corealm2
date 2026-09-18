import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { createCaveLabFixture } from '../game/src/featureLab/cave.js';
import { MaterialLibrary } from '../game/src/render/materials.js';
import { buildDungeon } from '../game/src/render/dungeon.js';
import { caveEnvelopeSampler, caveSourceCoordinates } from '../game/src/render/caveSourceDomain.js';

// Check the accepted envelope geometry and production cave assembly, not saved derivation reports.
it('keeps the accepted cave envelope welded, traversable and closed around its chambers', async () => {
  const root = 'art/rebuild/candidates/finish-cave-source/v7';
  const document = await new NodeIO().read(`${root}/models/cave/rock-face-01.glb`);
  expect(document.getRoot().listScenes()[0]!.getExtras().caveContinuousEnvelope).toBe(true);
  const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!, geometry = new THREE.BufferGeometry();
  for (const [semantic, name, size] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]] as const) geometry.setAttribute(name, new THREE.Float32BufferAttribute(primitive.getAttribute(semantic)!.getArray()!, size));
  geometry.setIndex(new THREE.BufferAttribute(primitive.getIndices()!.getArray()! as Uint16Array, 1));
  const p = geometry.getAttribute('position');
  const sourceSampler = caveEnvelopeSampler(geometry, 64, 56);
  for (let x = -44; x < -18; x += 2.1) for (let y = -14; y < -4; y += 1.3) {
    const a = caveSourceCoordinates(x / 1.3, y / 1.3, x, y, -36);
    const cycle = caveSourceCoordinates(x / 1.3 + 3 * 20, y / 1.3, x, y, -36);
    expect(sourceSampler(...a)).toBeCloseTo(sourceSampler(...cycle), 6);
    expect(sourceSampler(...a)).toBeGreaterThanOrEqual(0);
    expect(sourceSampler(...a)).toBeLessThanOrEqual(geometry.boundingBox!.max.z);
    const step = 0.001;
    const u = caveSourceCoordinates(x / 1.3 + step / 1.3, y / 1.3, x + step, y, -36);
    const v = caveSourceCoordinates(x / 1.3, y / 1.3 + step / 1.3, x, y + step, -36);
    const determinant = ((u[0] - a[0]) * (v[1] - a[1]) - (u[1] - a[1]) * (v[0] - a[0])) / step ** 2;
    expect(determinant).toBeGreaterThan(0.15);
  }
  for (let row = 0; row <= 56; row++) expect(p.getZ(row * 65)).toBe(p.getZ(row * 65 + 64));
  for (let column = 0; column <= 64; column++) expect(p.getZ(column)).toBe(p.getZ(56 * 65 + column));
  for (let i = 0; i < geometry.index!.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, geometry.index!.getX(i + j)));
    expect(b!.sub(a!).cross(c!.sub(a!)).z).toBeGreaterThan(1e-5);
  }
  const map = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map, normalMap: map, roughnessMap: map });
  const maps = { albedo: map, normal: map, roughness: map, meanLinearRgb: [0.2, 0.2, 0.2] as [number, number, number], tileMetres: 2.4 };
  const fixture = createCaveLabFixture({ scene: { root: new THREE.Group(), materials: new MaterialLibrary() },
    surfaceTextures: { bark: maps, leaf: maps, stone: maps }, rockSource: { geometry, material, continuousEnvelope: true, domainWarp: { columns: 64, rows: 56 }, provenance: 'CC0 Rock Face01 front-envelope' } });
  const facing = fixture.group.getObjectByName('dungeon-rock-facing') as THREE.Mesh, stats = facing.geometry.userData;
  expect(stats.continuousEnvelope).toBe(true);
  expect(stats.domainWarp).toBe(true);
  expect(stats.inputVertices - stats.weldedVertices).toBeGreaterThan(1000);
  expect(stats.renderedTriangles).toBeLessThan(650000);
  const normals = facing.geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i += 11) expect(new THREE.Vector3().fromBufferAttribute(normals, i).length()).toBeCloseTo(1, 4);
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  (facing.material as THREE.MeshStandardMaterial).onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  expect(shader.fragmentShader).toContain('caveTexture(map)');
  expect(shader.fragmentShader).not.toContain('caveSourceMap');
  const state = fixture.getState();
  for (const probe of Object.values(state.probes)) expect(probe!.headroom).toBeGreaterThanOrEqual(7);
  fixture.group.updateMatrixWorld(true);
  for (const chamber of fixture.spec.chambers) for (const rise of [0.3, 2, 4.5, 6.5]) for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12;
    const ray = new THREE.Raycaster(new THREE.Vector3(chamber.centre[0], chamber.floorY + rise, chamber.centre[1]), new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
    const hit = ray.intersectObject(fixture.group, true)[0];
    expect(hit).toBeDefined();
    expect(hit!.object === facing || fixture.walkable.includes(hit!.object as THREE.Mesh)).toBe(true);
  }
  const fallback = buildDungeon(fixture.spec, new MaterialLibrary());
  expect(Array.from(fixture.walkable[0]!.geometry.getAttribute('position').array)).toEqual(Array.from(fallback.walkable[0]!.geometry.getAttribute('position').array));
  fixture.dispose(); geometry.dispose(); material.dispose(); map.dispose();
}, 20000);

