import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { AnimationLod } from '../game/src/render/animationLod.js';

const directory = process.env.FEY_ASSET_DIRECTORY ?? 'game/public/assets/models/character';

async function loadFey(variant: string) {
  const bytes = readFileSync(path.join(directory, `npc_fey_${variant}.glb`));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  // Geometry, skins and clips are production bytes. Texture decoding requires a browser.
  delete json.images; delete json.textures; delete json.materials;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + length).toString('base64')}`;
  (globalThis as any).ProgressEvent ??= class {
    constructor(public type: string, init: unknown) { Object.assign(this, init); }
  };
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}

describe('Fey native skin at world coordinates', () => {
  it('keeps Rime sampled palette vertices as small as the live rig', async () => {
    const gltf = await loadFey('frostbloom');
    const root = clone(gltf.scene), parent = new THREE.Group();
    const clip = gltf.animations.find(animation => animation.name === 'Idle_Loop')!;
    const lod = new AnimationLod(parent, root, root, [clip], material => material);
    const placement = new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(2304.5, -119.95, 136);
    const live = clone(root), liveMeshes: THREE.SkinnedMesh[] = [];
    live.traverse(object => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) liveMeshes.push(object as THREE.SkinnedMesh); });
    const mixer = new THREE.AnimationMixer(live);
    mixer.clipAction(clip).play();
    let maximumError = 0;
    for (const time of [0.15, 4.73, 9.9]) {
      lod.set(0, placement, { clip, time, blend: 1 });
      mixer.setTime(time); live.updateMatrixWorld(true);
      const exact = new THREE.Box3();
      for (const [part, child] of parent.children.entries()) {
        const mesh = child as THREE.InstancedMesh;
        const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
          fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} } as Parameters<THREE.Material['onBeforeCompile']>[0];
        (mesh.material as THREE.Material).onBeforeCompile(shader, {} as THREE.WebGLRenderer);
        const data = (shader.uniforms.lodPalette!.value as THREE.DataTexture).image.data as Float32Array;
        const bones = shader.uniforms.lodBoneCount!.value as number;
        const frames = mesh.geometry.getAttribute('lodFrames');
        const matrices = Array.from({ length: bones }, (_, bone) => {
          const first = new THREE.Matrix4().fromArray(data, (frames.getX(0) * bones + bone) * 16);
          const second = new THREE.Matrix4().fromArray(data, (frames.getY(0) * bones + bone) * 16);
          first.elements.forEach((value, index) => { first.elements[index] = value * (1 - frames.getZ(0)) + second.elements[index]! * frames.getZ(0); });
          return first;
        });
        const positions = mesh.geometry.getAttribute('position');
        const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
        const source = new THREE.Vector4(), point = new THREE.Vector4(), transformed = new THREE.Vector4();
        for (let vertex = 0; vertex < positions.count; vertex++) {
          source.set(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex), 1);
          point.set(0, 0, 0, 0);
          for (let influence = 0; influence < 4; influence++) {
            point.add(transformed.copy(source).applyMatrix4(matrices[indices.getComponent(vertex, influence)]!).multiplyScalar(weights.getComponent(vertex, influence)));
          }
          // Match GLSL: the palette's xyz becomes the instance-local position with w=1.
          const drawn = new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(placement);
          exact.expandByPoint(drawn);
          const expected = liveMeshes[part]!.getVertexPosition(vertex, new THREE.Vector3())
            .applyMatrix4(liveMeshes[part]!.matrixWorld).applyMatrix4(placement);
          maximumError = Math.max(maximumError, drawn.distanceTo(expected));
        }
      }
      const size = exact.getSize(new THREE.Vector3());
      expect(size.y).toBeLessThan(1.1);
      expect(Math.max(size.x, size.z)).toBeLessThan(1.2);
      const reported = lod.drawnBounds(0, new THREE.Box3())!;
      expect(reported.min.distanceTo(exact.min)).toBeLessThan(0.00001);
      expect(reported.max.distanceTo(exact.max)).toBeLessThan(0.00001);
      // Culling still covers the complete bone envelope; it must not be called the drawn body.
      expect(lod.bounds(0, new THREE.Box3())!.getSize(new THREE.Vector3()).y).toBeGreaterThan(1.5);
    }
    expect(maximumError).toBeLessThan(0.004);
    lod.dispose(); mixer.stopAllAction(); mixer.uncacheRoot(live);
  });

  it.each(['opaline', 'autumn', 'nightshade', 'frostbloom'])('%s retains its shape after world placement', async variant => {
    const gltf = await loadFey(variant);
    const root = clone(gltf.scene);
    const clip = gltf.animations.find(animation => animation.name === 'Idle_Loop')!;
    expect(clip.tracks).toHaveLength(519);
    const meshes: THREE.SkinnedMesh[] = [];
    root.traverse(object => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh); });
    expect(meshes.length).toBeGreaterThanOrEqual(14);
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    const offset = new THREE.Vector3(2087, -119.95, -103);
    let maximumError = 0;
    let maximumMotion = 0;
    const firstPose: THREE.Vector3[] = [];
    for (const time of [0, 1.19, 4.73, 9.9]) {
      mixer.setTime(time);
      // Match normal entity rotation and exercise nonuniform NPC build scale.
      root.rotation.y = Math.PI / 2;
      root.scale.set(1.03, 0.97, 1.01);
      const localPose: THREE.Vector3[] = [];
      for (const translated of [false, true]) {
        root.position.copy(translated ? offset : new THREE.Vector3());
        root.updateMatrixWorld(true);
        for (const mesh of meshes) mesh.skeleton.update();
        const bounds = new THREE.Box3();
        let vertex = 0;
        for (const mesh of meshes) {
          const count = mesh.geometry.getAttribute('position').count;
          for (let index = 0; index < count; index++) {
            const point = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
            if (translated) {
              point.sub(offset);
              maximumError = Math.max(maximumError, point.distanceTo(localPose[vertex]!));
            } else {
              localPose.push(point.clone());
              if (time === 0) firstPose.push(point.clone());
              else maximumMotion = Math.max(maximumMotion, point.distanceTo(firstPose[vertex]!));
            }
            bounds.expandByPoint(point);
            vertex++;
          }
        }
        expect(bounds.getSize(new THREE.Vector3()).toArray().every(size => size > 0 && size < 1.2)).toBe(true);
      }
    }
    expect(maximumError, 'translation must not stretch skinned vertices').toBeLessThan(0.002);
    expect(maximumMotion, 'native idle must deform the source vertices').toBeGreaterThan(0.01);
    mixer.stopAllAction(); mixer.uncacheRoot(root);
  });
});
