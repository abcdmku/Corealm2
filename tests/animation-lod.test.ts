import { MeshStandardNodeMaterial, type MeshBasicNodeMaterial } from "three/webgpu";
import { vec3 } from "three/tsl";
import * as THREE from "three";
import { clone as cloneRigged } from "three/examples/jsm/utils/SkeletonUtils.js";
import { describe, expect, it, vi } from "vitest";
import { AnimationLod, sampledAnimationPalette, unionTransformedBounds, type LodPose } from "../game/src/render/animationLod.js";
import { conformTerrainRig } from '../game/src/render/terrainRig.js';
import { crowdGeometryReady, simplifyCrowdGeometry } from '../game/src/render/crowdGeometry.js';

function attributeValues(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number[] {
  return Array.from({ length: attribute.count }, (_, vertex) =>
    Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(vertex, component))).flat();
}

it.each([false, true])('uses one decoded Float32 layout for full-detail and simplification fallback parts (crowd=%s)', simplify => {
  const { root, mesh, head, walk, geometry } = actor();
  const positions = new THREE.InterleavedBuffer(new Float32Array([
    99, 0, 0, 0, 11, 99, 2, 5, 0, 11, 99, 0, 8, 1, 11,
  ]), 5);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(positions, 3, 1));
  geometry.setAttribute('skinIndex', new THREE.Uint8BufferAttribute([1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0], 4));
  geometry.setAttribute('normal', new THREE.Int16BufferAttribute([0, 0, 32767, 0, 0, 32767, 0, 0, 32767], 3, true));
  geometry.setAttribute('uv', new THREE.Uint16BufferAttribute([0, 65535, 32768, 16384, 65535, 0], 2, true));
  const colors = new THREE.InterleavedBuffer(new Uint8Array([
    77, 0, 128, 255, 64, 99, 77, 255, 127, 0, 255, 99, 77, 64, 32, 16, 128, 99,
  ]), 6);
  geometry.setAttribute('color', new THREE.InterleavedBufferAttribute(colors, 4, 1, true));
  geometry.setAttribute('tangent', new THREE.Int16BufferAttribute([32767, 0, 0, -32767, 32767, 0, 0, 32767, 32767, 0, 0, -32767], 4, true));
  geometry.setIndex([0, 1, 2]);
  mesh.material.name = 'canonical-body';
  const rigidGeometry = new THREE.BufferGeometry();
  rigidGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 2, 0], 3));
  const rigid = new THREE.Mesh(rigidGeometry, new THREE.MeshStandardMaterial({ name: 'canonical-rigid' }));
  head.add(rigid);
  const sources = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, {
    attribute, values: Array.from(attribute.array), constructor: attribute.array.constructor,
  }]));
  const sourceIndex = geometry.index!, sourceIndexArray = sourceIndex.array, sourceIndexValues = Array.from(sourceIndexArray);
  const parent = new THREE.Group(), lod = new AnimationLod(parent, root, root, [walk], material => material, false, true, simplify);
  try {
    const sampled = parent.children.find(part => part.name === 'animation-lod:canonical-body') as THREE.InstancedMesh;
    const attachment = parent.children.find(part => part.name === 'animation-lod:canonical-rigid') as THREE.InstancedMesh;
    expect(Array.from(sampled.geometry.index!.array)).toEqual([0, 1, 2]);
    expect(sampled.geometry.drawRange).toEqual({ start: 0, count: 3 });
    for (const [name, source] of Object.entries(geometry.attributes)) {
      const attribute = sampled.geometry.getAttribute(name) as THREE.InterleavedBufferAttribute;
      expect(attribute.isInterleavedBufferAttribute).toBe(true);
      expect(attribute.array).toBeInstanceOf(Float32Array);
      expect(attribute.normalized).toBe(false);
      expect(attribute.itemSize).toBe(source.itemSize);
      expect(attribute.count).toBe(source.count);
      const original = sources[name]!;
      expect(original.attribute.array).toBe(source.array);
      expect(original.attribute.array.constructor).toBe(original.constructor);
      expect(Array.from(source.array)).toEqual(original.values);
      for (let vertex = 0; vertex < source.count; vertex++) for (let component = 0; component < source.itemSize; component++) {
        expect(attribute.getComponent(vertex, component)).toBe(Math.fround(
          name === 'skinIndex' ? (source.getComponent(vertex, component) === 1 ? 0 : 1) : source.getComponent(vertex, component)));
      }
    }
    const vertexBuffers = new Set(Object.entries(sampled.geometry.attributes)
      .filter(([name]) => !name.startsWith('lod')).map(([, attribute]) =>
        (attribute as THREE.InterleavedBufferAttribute).data ?? attribute));
    expect(vertexBuffers.size).toBe(1);
    expect((sampled.geometry.getAttribute('lodFrames') as THREE.InstancedBufferAttribute).isInstancedBufferAttribute).toBe(true);
    expect(geometry.index).toBe(sourceIndex);
    expect(geometry.index!.array).toBe(sourceIndexArray);
    expect(Array.from(geometry.index!.array)).toEqual(sourceIndexValues);
    expect(attachment.geometry.getAttribute('skinIndex').array).toBeInstanceOf(Float32Array);
    expect(attachment.geometry.getAttribute('skinIndex').normalized).toBe(false);
    expect(attributeValues(attachment.geometry.getAttribute('skinIndex'))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(attachment.geometry.getAttribute('skinWeight').array).toBeInstanceOf(Float32Array);
    expect(attributeValues(attachment.geometry.getAttribute('skinWeight'))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    expect(attachment.geometry.index).toBeNull();
    expect(attachment.geometry.drawRange.count).toBe(3);
    expect(rigidGeometry.hasAttribute('skinIndex')).toBe(false);
    lod.set(0, new THREE.Matrix4(), { clip: walk, time: .4, blend: 1 });
    expect(lod.triangles).toBe(2);
    for (let vertex = 0; vertex < 3; vertex++) {
      expect(paletteVertex(sampled, 0, vertex).distanceTo(referenceVertex(root, walk, .4, vertex))).toBeLessThan(2e-6);
    }
  } finally { lod.dispose(); rigidGeometry.dispose(); rigid.material.dispose(); }
});

it('preserves the simplifier topology and surviving attribute values in the canonical sampled layout', async () => {
  await crowdGeometryReady;
  const { root, mesh, walk } = actor(), geometry = new THREE.PlaneGeometry(1, 1, 12, 12);
  const vertices = geometry.getAttribute('position').count;
  const weights = new Uint8Array(vertices * 4), colors = new Uint8Array(vertices * 4);
  for (let vertex = 0; vertex < vertices; vertex++) {
    weights[vertex * 4] = 255;
    colors.set([vertex % 256, 128, 255, 64], vertex * 4);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(new Uint8Array(vertices * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Uint8BufferAttribute(weights, 4, true));
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute(colors, 4, true));
  const skinIndices = geometry.getAttribute('skinIndex');
  for (let vertex = 0; vertex < vertices; vertex++) skinIndices.setX(vertex, vertex % 2 === 0 ? 1 : 0);
  mesh.geometry = geometry;
  const sourceAttributes = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, {
    attribute, values: Array.from(attribute.array), constructor: attribute.array.constructor,
  }]));
  const sourceIndex = geometry.index!, sourceIndexArray = sourceIndex.array, sourceIndices = Array.from(sourceIndexArray);
  const expected = simplifyCrowdGeometry(geometry, 0, geometry.index!.count);
  const parent = new THREE.Group(), lod = new AnimationLod(parent, root, root, [walk], material => material, false, true, true);
  try {
    const sampled = (parent.children[0] as THREE.InstancedMesh).geometry;
    expect(sampled.index!.count).toBeLessThan(geometry.index!.count);
    expect(Array.from(sampled.index!.array)).toEqual(Array.from(expected.index!.array));
    expect(sampled.drawRange).toEqual(expected.drawRange);
    for (const [name, attribute] of Object.entries(expected.attributes)) {
      const actual = sampled.getAttribute(name), original = sourceAttributes[name];
      expect(actual.array).toBeInstanceOf(Float32Array);
      expect(actual.normalized).toBe(false);
      expect(actual.itemSize).toBe(attribute.itemSize);
      expect(actual.count).toBe(attribute.count);
      for (let vertex = 0; vertex < attribute.count; vertex++) for (let component = 0; component < attribute.itemSize; component++) {
        const value = attribute.getComponent(vertex, component);
        expect(actual.getComponent(vertex, component)).toBe(Math.fround(
          name === 'skinIndex' ? (value === 1 ? 0 : 1) : value));
      }
      expect(original).toBeDefined();
    }
    for (const [name, snapshot] of Object.entries(sourceAttributes)) {
      const current = geometry.getAttribute(name);
      expect(current.array).toBe(snapshot.attribute.array);
      expect(current.array.constructor).toBe(snapshot.constructor);
      expect(Array.from(current.array)).toEqual(snapshot.values);
    }
    expect(geometry.index).toBe(sourceIndex);
    expect(geometry.index!.array).toBe(sourceIndexArray);
    expect(Array.from(geometry.index!.array)).toEqual(sourceIndices);
  } finally { lod.dispose(); expected.dispose(); geometry.dispose(); }
});

it.each([false, true])('decodes protected half-float/integer streams and keeps full topology (simplify=%s)', simplify => {
  const { root, mesh, walk } = actor();
  const geometry = new THREE.PlaneGeometry(1, 1, 12, 12);
  const vertices = geometry.getAttribute('position').count;
  const skinIndices = new Uint8Array(vertices * 4), skinWeights = new Uint8Array(vertices * 4);
  for (let vertex = 0; vertex < vertices; vertex++) skinWeights[vertex * 4] = 255;
  geometry.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Uint8BufferAttribute(skinWeights, 4, true));
  const halfValues = [1, .5, -2, .25];
  const halfBits = new Uint16Array(vertices * 2);
  for (let vertex = 0; vertex < vertices; vertex++) {
    halfBits[vertex * 2] = THREE.DataUtils.toHalfFloat(halfValues[vertex % halfValues.length]!);
    halfBits[vertex * 2 + 1] = THREE.DataUtils.toHalfFloat(halfValues[(vertex + 1) % halfValues.length]!);
  }
  const half = new THREE.Float16BufferAttribute(halfBits, 2);
  const integerValues = new Int16Array(vertices * 2);
  for (let vertex = 0; vertex < vertices; vertex++) {
    integerValues[vertex * 2] = vertex - 100;
    integerValues[vertex * 2 + 1] = 100 - vertex;
  }
  const integer = new THREE.Int16BufferAttribute(integerValues, 2);
  integer.gpuType = THREE.IntType;
  geometry.setAttribute('halfValue', half);
  geometry.setAttribute('customInteger', integer);
  mesh.geometry = geometry;
  const sourceHalfArray = half.array, sourceIntegerArray = integer.array;
  const sourceAttributes = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, {
    attribute, values: Array.from(attribute.array), constructor: attribute.array.constructor,
  }]));
  const sourceIndex = geometry.index!, sourceIndexArray = sourceIndex.array, sourceIndexValues = Array.from(sourceIndexArray);
  expect(sourceIndex.count).toBeGreaterThan(192);
  const parent = new THREE.Group(), lod = new AnimationLod(parent, root, root, [walk], material => material, false, true, simplify);
  try {
    const sampled = (parent.children[0] as THREE.InstancedMesh).geometry;
    const sampledHalf = sampled.getAttribute('halfValue');
    const sampledInteger = sampled.getAttribute('customInteger');
    const decodedHalf = Array.from({ length: half.count }, (_, vertex) =>
      [half.getX(vertex), half.getY(vertex)].map(value => Math.fround(value))).flat();
    expect(sampled.index!.count).toBe(sourceIndex.count);
    expect(Array.from(sampled.index!.array)).toEqual(sourceIndexValues);
    expect(sampled.drawRange).toEqual({ start: 0, count: sourceIndex.count });
    expect(sampled.drawRange.count / 3).toBe(sourceIndex.count / 3);
    expect(sampledHalf.array).toBeInstanceOf(Float32Array);
    expect(sampledHalf.array).not.toBe(sourceHalfArray);
    expect(sampledHalf.normalized).toBe(false);
    expect(attributeValues(sampledHalf)).toEqual(decodedHalf);
    expect(sampledHalf.getX(0)).toBe(1);
    expect(sampledInteger.array).toBeInstanceOf(Int16Array);
    expect(sampledInteger.array).not.toBe(sourceIntegerArray);
    expect((sampledInteger as THREE.BufferAttribute).gpuType).toBe(THREE.IntType);
    expect(sampledInteger.normalized).toBe(false);
    expect(Array.from(sampledInteger.array)).toEqual(Array.from(integer.array));
    for (const [name, snapshot] of Object.entries(sourceAttributes)) {
      const current = geometry.getAttribute(name);
      expect(current.array).toBe(snapshot.attribute.array);
      expect(current.array.constructor).toBe(snapshot.constructor);
      expect(Array.from(current.array)).toEqual(snapshot.values);
    }
    expect(geometry.index).toBe(sourceIndex);
    expect(geometry.index!.array).toBe(sourceIndexArray);
    expect(Array.from(geometry.index!.array)).toEqual(sourceIndexValues);
    lod.set(0, new THREE.Matrix4(), { clip: walk, time: .4, blend: 1 });
    expect(lod.triangles).toBe(sourceIndex.count / 3);
  } finally { lod.dispose(); geometry.dispose(); }
});

it('prepares in bounded slices with the same sampled vertices as the live skeleton', () => {
  const { root, walk } = actor(), parent = new THREE.Group();
  const lod = new AnimationLod(parent, root, root, [walk], m => m, true);
  const now = vi.spyOn(performance, 'now');
  let clock = 0;
  now.mockImplementation(() => clock++);
  try {
    expect(lod.ready).toBe(false);
    expect(lod.prepare(2)).toBe(false);
    expect(() => lod.set(0, new THREE.Matrix4(), { clip: walk, time: .4, blend: 1 })).toThrow('unfinished');
    let slices = 1;
    while (!lod.prepare(2)) { if (++slices > 100) throw Error('Preparation did not finish'); }
    expect(slices).toBeGreaterThan(5);
    lod.set(0, new THREE.Matrix4(), { clip: walk, time: .4, blend: 1 });
    for (let vertex = 0; vertex < 3; vertex++) {
      expect(paletteVertex(parent.children[0] as THREE.InstancedMesh, 0, vertex)
        .distanceTo(referenceVertex(root, walk, .4, vertex))).toBeLessThan(2e-6);
    }
  } finally { now.mockRestore(); lod.dispose(); }
});

it('cancels partially prepared palettes without adding later scene parts', () => {
  const { root, walk } = actor(), parent = new THREE.Group();
  const lod = new AnimationLod(parent, root, root, [walk], m => m, true);
  lod.prepare(0);
  lod.dispose();
  expect(lod.prepare(Infinity)).toBe(false);
  expect(lod.preparing).toBe(false);
  expect(parent.children).toHaveLength(0);
  expect(lod.textureBytes).toBe(0);
});

it('keeps affine animation bounds equivalent to the eight-corner reference', () => {
  const source = new THREE.Box3(new THREE.Vector3(-3, -2, -7), new THREE.Vector3(1, 4, 2));
  for (let i = 0; i < 60; i++) {
    const matrix = new THREE.Matrix4().makeRotationY(i * .17)
      .multiply(new THREE.Matrix4().makeShear(.2, -.3, .1, .4, -.2, .3))
      .scale(new THREE.Vector3(i % 2 ? -1.2 : .7, .5, 2)).setPosition(i, -i / 2, 3);
    const initial = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const expected = initial.clone().union(source.clone().applyMatrix4(matrix));
    unionTransformedBounds(initial, source, matrix);
    expect(initial.min.distanceTo(expected.min)).toBeLessThan(1e-12);
    expect(initial.max.distanceTo(expected.max)).toBeLessThan(1e-12);
  }
});

it('ignores unused skeleton bones in sampled and terrain-adjusted bounds', () => {
  const { root, mesh, walk } = actor();
  const unused = new THREE.Bone(); unused.name = 'unused'; unused.position.set(5000, 5000, 5000);
  root.add(unused); root.updateMatrixWorld(true);
  mesh.skeleton.bones.splice(1, 0, unused); mesh.skeleton.boneInverses.splice(1, 0, new THREE.Matrix4());
  const sourceIndices = mesh.geometry.getAttribute('skinIndex');
  for (let vertex = 0; vertex < sourceIndices.count; vertex++) for (let influence = 0; influence < 4; influence++) {
    if (sourceIndices.getComponent(vertex, influence) === 1) sourceIndices.setComponent(vertex, influence, 2);
  }
  const parent = new THREE.Group(), lod = new AnimationLod(parent, root, root, [walk], material => material);
  try {
    for (const terrain of [undefined, { placement: new THREE.Matrix4(), origin: new THREE.Vector3(), heightAt: (x: number) => .2 * x }]) {
      lod.set(0, new THREE.Matrix4(), { clip: walk, time: .4, blend: 1, terrain });
      const bounds = lod.bounds(0, new THREE.Box3())!;
      const instance = parent.children[0] as THREE.InstancedMesh;
      expect(sampledAnimationPalette(instance.material as THREE.Material)!.bones).toBe(2);
      expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(2);
      for (let vertex = 0; vertex < 3; vertex++) {
        const actual = paletteVertex(parent.children[0] as THREE.InstancedMesh, 0, vertex);
        expect(bounds.clone().expandByScalar(1e-6).containsPoint(actual)).toBe(true);
        const expected = referenceVertex(root, walk, .4, vertex);
        if (terrain) expected.y += terrain.heightAt(expected.x);
        expect(actual.distanceTo(expected)).toBeLessThan(2e-6);
      }
    }
  } finally { lod.dispose(); }
});

function actor() {
  const root = new THREE.Group();
  root.scale.setScalar(0.01);
  root.rotation.y = 0.3;
  const hip = new THREE.Bone();
  hip.name = "hip";
  hip.position.set(2, 5, 0);
  const head = new THREE.Bone();
  head.name = "head";
  head.position.set(0, 3, 0);
  hip.add(head);
  root.add(hip);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 2, 5, 0, 0, 8, 1], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0], 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 0.6, 0.4, 0, 0, 0, 1, 0, 0], 4));
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), roughness: 0.85 });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "body";
  mesh.position.set(1, -2, 3);
  mesh.scale.set(2, 1.2, 0.9);
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([hip, head]));
  const walk = new THREE.AnimationClip("walk", 1, [
    new THREE.VectorKeyframeTrack("hip.position", [0, 1], [2, 5, 0, 5, 5, 2]),
    new THREE.QuaternionKeyframeTrack("head.quaternion", [0, 1], [0, 0, 0, 1, ...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.9).toArray()]),
  ]);
  const hit = new THREE.AnimationClip("hit", 0.5, [
    new THREE.VectorKeyframeTrack("hip.position", [0, 0.5], [2, 5, 0, -1, 4, 0]),
  ]);
  return { root, mesh, hip, head, walk, hit, geometry, material };
}

// Reference uses Three's ordinary live-skeleton CPU deformation, including the imported hierarchy.
function referenceVertex(root: THREE.Object3D, clip: THREE.AnimationClip, time: number, vertex: number): THREE.Vector3 {
  const copy = cloneRigged(root);
  const mixer = new THREE.AnimationMixer(copy);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(time);
  copy.updateMatrixWorld(true);
  const mesh = copy.getObjectByName("body") as THREE.SkinnedMesh;
  const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex);
  mesh.applyBoneTransform(vertex, point);
  return point.applyMatrix4(mesh.matrixWorld);
}

function paletteVertex(mesh: THREE.InstancedMesh, row: number, vertex: number): THREE.Vector3 {
  const { texture, bones } = sampledAnimationPalette(mesh.material as THREE.Material)!;
  const data = texture.image.data as Float32Array;
  const current = mesh.geometry.getAttribute("lodFrames");
  const previous = mesh.geometry.getAttribute("lodPreviousFrames");
  const index = mesh.geometry.getAttribute("skinIndex");
  const weight = mesh.geometry.getAttribute("skinWeight");
  const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex);
  const result = new THREE.Vector3();
  for (let influence = 0; influence < 4; influence++) {
    const bone = index.getComponent(vertex, influence);
    const w = weight.getComponent(vertex, influence);
    for (const [frames, blend] of [[current, current.getW(row)], [previous, 1 - current.getW(row)]] as const) {
      for (const [frame, fraction] of [[frames.getX(row), 1 - frames.getZ(row)], [frames.getY(row), frames.getZ(row)]]) {
        const skin = new THREE.Matrix4().fromArray(data, (frame! * bones + bone) * 16);
        result.addScaledVector(point.clone().applyMatrix4(skin), w * blend * fraction!);
      }
    }
  }
  const placement = new THREE.Matrix4();
  mesh.getMatrixAt(row, placement);
  return result.applyMatrix4(placement);
}

function overlayClip(): THREE.AnimationClip {
  return new THREE.AnimationClip("masked-recoil", .5, [new THREE.QuaternionKeyframeTrack("head.quaternion", [0, .25, .5],
    [0, 0, 0, 1, ...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .75).toArray(), 0, 0, 0, 1])], THREE.AdditiveAnimationBlendMode);
}

it("keeps terrain-adjusted palette vertices on the same surface as live animation across slots and return to flat", () => {
  const { root, walk } = actor(), parent = new THREE.Group();
  const before = root.toJSON();
  const lod = new AnimationLod(parent, root, root, [walk], material => material);
  const heightAt = (x: number, z: number) => .45 * x - .3 * z;
  for (let slot = 0; slot < 3; slot++) {
    const origin = new THREE.Vector3(slot * 8, heightAt(slot * 8, 4), 4);
    const placement = new THREE.Matrix4().makeRotationY(slot * .6).setPosition(origin);
    const time = .15 + slot * .2;
    lod.set(slot, placement, { clip: walk, time, blend: 1, terrain: { placement, origin, heightAt } });
    const mesh = parent.children[0] as THREE.InstancedMesh;
    for (let vertex = 0; vertex < 3; vertex++) {
      const expected = referenceVertex(root, walk, time, vertex).applyMatrix4(placement);
      expected.y += heightAt(expected.x, expected.z) - origin.y;
      expect(paletteVertex(mesh, slot, vertex).distanceTo(expected)).toBeLessThan(2e-6);
      expect(lod.bounds(slot, new THREE.Box3())!.containsPoint(expected)).toBe(true);
    }
  }
  lod.hide(1);
  lod.set(0, new THREE.Matrix4(), { clip: walk, time: .4, blend: 1 });
  const mesh = parent.children[0] as THREE.InstancedMesh;
  expect(paletteVertex(mesh, 0, 2).distanceTo(referenceVertex(root, walk, .4, 2))).toBeLessThan(1e-6);
  expect(lod.terrainSnapshot(0)).toBeNull();
  expect(root.toJSON()).toEqual(before);
  lod.dispose();
});

it('advances animation without re-uploading stationary placement or color, and invalidates bounds on movement', () => {
  const { root, walk } = actor(), parent = new THREE.Group();
  const lod = new AnimationLod(parent, root, root, [walk], material => material);
  const placement = new THREE.Matrix4().makeRotationY(.7);
  const terrain = { placement, origin:new THREE.Vector3(), heightAt:()=>0 };
  try {
    lod.set(0, placement, {clip:walk,time:0,blend:1,terrain});
    const mesh = parent.children[0] as THREE.InstancedMesh;
    mesh.computeBoundingSphere();
    const sphere = mesh.boundingSphere, matrixVersion = mesh.instanceMatrix.version;
    const colorVersion = mesh.instanceColor!.version, frames = mesh.geometry.getAttribute('lodFrames') as THREE.InstancedBufferAttribute;
    const frameVersion = frames.version, before = paletteVertex(mesh,0,2);
    lod.set(0, placement, {clip:walk,time:.4,blend:1,terrain});
    expect(paletteVertex(mesh,0,2).distanceTo(before)).toBeGreaterThan(.001);
    expect(mesh.instanceMatrix.version).toBe(matrixVersion);
    expect(mesh.instanceColor!.version).toBe(colorVersion);
    expect(frames.version).toBe(frameVersion);
    expect(mesh.boundingSphere).toBe(sphere);
    placement.setPosition(10,0,0);
    lod.set(0, placement, {clip:walk,time:.4,blend:1,terrain}, ()=>new THREE.Color(.2,.3,.4));
    expect(mesh.instanceMatrix.version).toBeGreaterThan(matrixVersion);
    expect(mesh.instanceColor!.version).toBeGreaterThan(colorVersion);
    expect(mesh.boundingSphere).toBeNull();
    mesh.computeBoundingSphere();
    expect(mesh.boundingSphere!.containsPoint(paletteVertex(mesh,0,2))).toBe(true);
  } finally { lod.dispose(); }
});

it('grounds interpolated and crossfaded sampled poses without replaying live animation tracks', () => {
  const { root, walk, hit } = actor();
  const parent = new THREE.Group(), lod = new AnimationLod(parent, root, root, [walk, hit], material => material);
  const placement = new THREE.Matrix4().makeRotationY(.7).scale(new THREE.Vector3(1.2, .8, 1.5));
  const heightAt = (x: number, z: number) => .2 * x - .15 * z;
  const origin = new THREE.Vector3();
  const update = vi.spyOn(THREE.AnimationMixer.prototype, 'update');
  try {
    lod.set(0, placement, { clip: walk, time: .325, previousClip: hit, previousTime: .175, blend: .4,
      terrain: { placement, origin, heightAt } });
    expect(update).not.toHaveBeenCalled();
  } finally { update.mockRestore(); }
  const mesh = parent.children[0] as THREE.InstancedMesh;
  for (let vertex = 0; vertex < 3; vertex++) {
    const current = referenceVertex(root, walk, .3, vertex).lerp(referenceVertex(root, walk, .35, vertex), .5);
    const previous = referenceVertex(root, hit, .15, vertex).lerp(referenceVertex(root, hit, .2, vertex), .5);
    const expected = previous.lerp(current, .4).applyMatrix4(placement);
    expected.y += heightAt(expected.x, expected.z);
    expect(paletteVertex(mesh, 0, vertex).distanceTo(expected)).toBeLessThan(2e-6);
  }
  const before = paletteVertex(mesh, 0, 2);
  lod.terrainSnapshot(0);
  expect(paletteVertex(mesh, 0, 2).toArray()).toEqual(before.toArray());
  lod.dispose();
});

it('matches live joint terrain tangents on curved ground with scale, rotation and bone attachments', () => {
  const { root, head, walk } = actor();
  const attachment = new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2), new THREE.MeshStandardMaterial());
  attachment.name='attachment'; head.add(attachment);
  const parent = new THREE.Group(), lod = new AnimationLod(parent, root, root, [walk], material => material);
  const placement = new THREE.Matrix4().makeRotationY(.7).scale(new THREE.Vector3(1.2,.8,1.5)).setPosition(2,0,3);
  const terrain = { placement, origin:new THREE.Vector3(2,0,3), heightAt:(x:number,z:number)=>.4*Math.sin(x*.3)+.02*z*z };
  lod.set(0, placement, { clip:walk,time:.3,blend:1,terrain });
  const copy = cloneRigged(root), mixer = new THREE.AnimationMixer(copy);
  mixer.clipAction(walk).play(); mixer.setTime(.3); conformTerrainRig(copy, terrain);
  for (const part of parent.children as THREE.InstancedMesh[]) {
    const skinned = part.geometry.getAttribute('position').count === 3;
    const source = copy.getObjectByName(skinned ? 'body' : 'attachment') as THREE.Mesh;
    for (let vertex=0;vertex<part.geometry.getAttribute('position').count;vertex++) {
      const point = skinned ? (source as THREE.SkinnedMesh).getVertexPosition(vertex,new THREE.Vector3())
        : new THREE.Vector3().fromBufferAttribute(source.geometry.getAttribute('position'),vertex);
      point.applyMatrix4(source.matrixWorld).applyMatrix4(placement);
      expect(paletteVertex(part,0,vertex).distanceTo(point)).toBeLessThan(1e-5);
    }
  }
  lod.dispose(); attachment.geometry.dispose(); attachment.material.dispose();
});

/** Independent ordinary live mixer reference: local normal blend, then additive local recoil. */
function overlayReference(root: THREE.Object3D, pose: LodPose, vertex: number): THREE.Vector3 {
  const copy = cloneRigged(root), mixer = new THREE.AnimationMixer(copy);
  const blend = pose.previousClip ? pose.blend : 1;
  const play = (clip: THREE.AnimationClip, time: number, weight: number, mode: THREE.AnimationBlendMode) => {
    const action = mixer.clipAction(clip, undefined, mode).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true; action.setEffectiveWeight(weight).play(); action.time = time;
  };
  if (pose.previousClip) play(pose.previousClip === pose.clip ? pose.previousClip.clone() : pose.previousClip, pose.previousTime!, 1 - blend, THREE.NormalAnimationBlendMode);
  play(pose.clip, pose.time, blend, THREE.NormalAnimationBlendMode);
  play(pose.overlay!.clip, pose.overlay!.time, pose.overlay!.weight, THREE.AdditiveAnimationBlendMode);
  mixer.update(0); copy.updateMatrixWorld(true);
  const mesh = copy.getObjectByName("body") as THREE.SkinnedMesh;
  const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex);
  mesh.applyBoneTransform(vertex, point); point.applyMatrix4(mesh.matrixWorld);
  mixer.stopAllAction(); mixer.uncacheRoot(copy);
  mesh.skeleton.dispose();
  return point;
}

describe("sampled skeletal animation LOD", () => {
  it("reports only current palette vertices through interpolation, blending, overlays and slot compaction", () => {
    const { root, walk, hit } = actor(), parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk, hit], material => material);
    const placement = new THREE.Matrix4().makeRotationY(0.7).setPosition(2304.5, -120, 136);
    lod.set(2, new THREE.Matrix4(), { clip: walk, time: 0, blend: 1 });
    const poses: LodPose[] = [
      { clip: walk, time: 0.327, blend: 1 },
      { clip: hit, time: 0.223, previousClip: walk, previousTime: 0.712, blend: 0.38 },
      { clip: walk, time: 0.423, blend: 1, overlay: { clip: overlayClip(), time: 0.22, weight: 0.7 } },
    ];
    for (const pose of poses) {
      lod.set(7, placement, pose);
      const mesh = parent.children[0] as THREE.InstancedMesh;
      const expected = new THREE.Box3();
      for (let vertex = 0; vertex < 3; vertex++) expected.expandByPoint(paletteVertex(mesh, 1, vertex));
      const actual = lod.drawnBounds(7, new THREE.Box3())!;
      expect(actual.min.distanceTo(expected.min)).toBeLessThan(1e-6);
      expect(actual.max.distanceTo(expected.max)).toBeLessThan(1e-6);
    }
    const before = lod.drawnBounds(7, new THREE.Box3())!.clone();
    lod.hide(2);
    expect(lod.drawnBounds(2, new THREE.Box3())).toBeNull();
    expect(lod.drawnBounds(7, new THREE.Box3())).toEqual(before);
    lod.dispose();
  });

  it('initializes the palette pose outside optional normal branches for basic surfaces and every shadow pass', () => {
    const { root, mesh: sourceMesh, walk } = actor();
    const source = new THREE.MeshBasicMaterial({ color: 0xc9bbeb, transparent: true, opacity: 0.35 });
    source.name = 'M_FeyWingBlurFlipbook_Fey_Opaline';
    Object.assign(sourceMesh, { material: source });
    const parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk], material => material);
    lod.set(4, new THREE.Matrix4(), { clip: walk, time: 0.3, blend: 1, opacity: 0.6 });
    const mesh = parent.children[0] as THREE.InstancedMesh;
    expect('isSkinnedMesh' in mesh, 'Instanced LOD does not enable Three USE_SKINNING').toBe(false);
    expect((mesh.material as MeshBasicNodeMaterial).isMeshBasicNodeMaterial).toBe(true);
    expect((mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(source.color.getHex());
    expect((mesh.material as THREE.Material).opacity).toBe(source.opacity);

    const nodes = mesh.material as MeshBasicNodeMaterial;
    expect(nodes.positionNode?.isNode).toBe(true);
    expect(nodes.maskNode?.isNode).toBe(true);
    // WebGPU's shadow pass consumes these same nodes from the source material.
    expect(mesh.customDepthMaterial).toBeUndefined();
    expect(mesh.customDistanceMaterial).toBeUndefined();
    expect(paletteVertex(mesh, 0, 2).distanceTo(referenceVertex(root, walk, 0.3, 2))).toBeLessThan(1e-6);
    lod.dispose();
    source.dispose();
  });

  it.each([false,true])("preserves shadow casting %s after crowd buffer growth", (castShadow) => {
    const {root,walk}=actor(), parent=new THREE.Group();
    const lod=new AnimationLod(parent,root,root,[walk],material=>material,false,castShadow,true);
    lod.set(0,new THREE.Matrix4(),{clip:walk,time:0.25,blend:1});
    const initial=[...parent.children];
    for(let slot=1;slot<140;slot++)lod.set(slot,new THREE.Matrix4(),{clip:walk,time:0.25,blend:1});
    expect(parent.children.length).toBe(initial.length);
    expect(parent.children.every(mesh=>mesh.castShadow===castShadow && mesh.receiveShadow)).toBe(true);
    // Grown groups draw through fresh meshes whose instance buffers hold every row.
    for(const child of parent.children){
      const mesh=child as THREE.InstancedMesh;
      expect(initial).not.toContain(mesh);
      expect(mesh.count).toBe(140);
      expect(mesh.instanceMatrix.count).toBeGreaterThanOrEqual(140);
      expect(mesh.instanceColor!.count).toBeGreaterThanOrEqual(140);
    }
    expect(lod.bounds(139,new THREE.Box3())?.isEmpty()).toBe(false);
    lod.dispose();
    expect(parent.children).toHaveLength(0);
  });
  it("composes additive masked bones at exact live clocks without replacing moving support bones", () => {
    const { root, walk, hit } = actor(), overlay = overlayClip(), before = root.toJSON();
    const parent = new THREE.Group(), lod = new AnimationLod(parent, root, root, [walk, hit], material => material);
    for (const pose of [
      { clip: walk, time: .327, blend: 1, overlay: { clip: overlay, time: .191, weight: .8 } },
      { clip: walk, time: .731, previousClip: hit, previousTime: .113, blend: .37, overlay: { clip: overlay, time: .231, weight: .6 } },
      { clip: walk, time: .731, previousClip: walk, previousTime: .113, blend: .37, overlay: { clip: overlay, time: .231, weight: .6 } },
    ]) {
      lod.set(4, new THREE.Matrix4(), pose);
      const mesh = parent.children[0] as THREE.InstancedMesh;
      for (let vertex = 0; vertex < 3; vertex++) {
        const expected = overlayReference(root, pose, vertex);
        expect(paletteVertex(mesh, 0, vertex).distanceTo(expected)).toBeLessThan(1e-6);
        expect(lod.bounds(4, new THREE.Box3())!.containsPoint(expected)).toBe(true);
      }
      expect(mesh.geometry.getAttribute("lodFrames").getX(0)).toBeGreaterThanOrEqual(lod.sampleCount);
      expect(lod.drawCalls).toBe(1);
    }
    expect(root.toJSON()).toEqual(before);
    lod.dispose();
  });

  it("reuses overlay frames across sparse-slot compaction, instance growth, and overlay completion", () => {
    const { root, walk } = actor(), overlay = overlayClip(), parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk], material => material);
    const pose = (index: number): LodPose => ({ clip: walk, time: index / 25, blend: 1, overlay: { clip: overlay, time: index / 60, weight: .8 } });
    for (let i = 0; i < 19; i++) lod.set(100 + i, new THREE.Matrix4(), pose(i));
    const mesh = parent.children[0] as THREE.InstancedMesh;
    const firstFrame = mesh.geometry.getAttribute("lodFrames").getX(0), allocated = lod.textureBytes;
    lod.hide(100);
    expect(paletteVertex(mesh, 0, 2).distanceTo(overlayReference(root, pose(18), 2))).toBeLessThan(1e-6);
    lod.set(999, new THREE.Matrix4(), pose(3));
    expect(mesh.geometry.getAttribute("lodFrames").getX(18)).toBe(firstFrame);
    expect(paletteVertex(mesh, 18, 2).distanceTo(overlayReference(root, pose(3), 2))).toBeLessThan(1e-6);
    lod.set(999, new THREE.Matrix4(), { clip: walk, time: .4, blend: 1 });
    expect(mesh.geometry.getAttribute("lodFrames").getX(18)).toBeLessThan(lod.sampleCount);
    expect(paletteVertex(mesh, 18, 2).distanceTo(referenceVertex(root, walk, .4, 2))).toBeLessThan(1e-6);
    expect(lod.textureBytes).toBe(allocated);
    expect(lod.drawCalls).toBe(1);
    expect(parent.children).toHaveLength(1);
    lod.dispose();
  });

  it("restores disjoint base and additive bindings between successive actors", () => {
    const { root, walk, hit } = actor(), headOverlay = overlayClip(), parent = new THREE.Group();
    const hipOverlay = new THREE.AnimationClip("hip-offset", .5, [
      new THREE.VectorKeyframeTrack("hip.position", [0, .5], [0, 0, 0, 0, 2, 1]),
    ], THREE.AdditiveAnimationBlendMode);
    const headOnly = new THREE.AnimationClip("head-only", 1, [walk.tracks[1]!.clone()]);
    const lod = new AnimationLod(parent, root, root, [walk, hit, headOnly], material => material);
    const poses: LodPose[] = [
      { clip: walk, time: .73, blend: 1, overlay: { clip: headOverlay, time: .24, weight: 1 } },
      { clip: hit, time: .19, blend: 1, overlay: { clip: hipOverlay, time: .31, weight: .6 } },
      { clip: headOnly, time: .42, blend: 1, overlay: { clip: headOverlay, time: .11, weight: .8 } },
    ];
    poses.forEach((pose, row) => {
      lod.set(row, new THREE.Matrix4(), pose);
      for (let vertex = 0; vertex < 3; vertex++) expect(paletteVertex(parent.children[0] as THREE.InstancedMesh, row, vertex)
        .distanceTo(overlayReference(root, pose, vertex))).toBeLessThan(1e-6);
    });
    lod.dispose();
  });

  it("updates only dynamic texel rows after upload while retaining the baked palette and the shadow position graph", () => {
    const { root, walk } = actor(), overlay = overlayClip(), parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk], material => material);
    lod.set(4, new THREE.Matrix4(), { clip: walk, time: .2, blend: 1, overlay: { clip: overlay, time: .1, weight: 1 } });
    const mesh = parent.children[0] as THREE.InstancedMesh;
    const { texture } = sampledAnimationPalette(mesh.material as THREE.Material)!;
    const baked = (texture.image.data as Float32Array).slice(0, lod.sampleCount * 2 * 16);
    expect(texture.updateRanges).toHaveLength(0); // first upload must include all baked frames
    texture.onUpdate!(texture);
    lod.set(4, new THREE.Matrix4(), { clip: walk, time: .4, blend: 1, overlay: { clip: overlay, time: .2, weight: 1 } });
    expect(texture.updateRanges.length).toBeGreaterThan(0);
    const queuedRanges = texture.updateRanges.length;
    for (let i = 0; i < 50; i++) lod.set(4, new THREE.Matrix4(), { clip: walk, time: .4, blend: 1, overlay: { clip: overlay, time: .21, weight: 1 } });
    expect(texture.updateRanges).toHaveLength(queuedRanges); // culled textures do not accrue duplicate ranges
    for (const range of texture.updateRanges) {
      expect(range.start).toBeGreaterThanOrEqual(baked.length);
      expect(range.start % (texture.image.width * 4) + range.count).toBeLessThanOrEqual(texture.image.width * 4);
    }
    expect(Array.from((texture.image.data as Float32Array).slice(0, baked.length))).toEqual(Array.from(baked));
    expect(sampledAnimationPalette(mesh.material as THREE.Material)!.texture).toBe(texture);
    expect((mesh.material as MeshStandardNodeMaterial).positionNode).not.toBeNull();
    expect(() => lod.set(5, new THREE.Matrix4(), { clip: walk, time: 0, blend: 1, overlay: { clip: walk, time: 0, weight: 1 } })).toThrow(/additive/);
    lod.dispose();
  });

  it("uploads a complete terrain pose in one range for non-power-of-two skeletons", () => {
    const { root, mesh, hip, walk } = actor(), bones = [...mesh.skeleton.bones];
    while (bones.length < 17) { const bone = new THREE.Bone(); bone.name = `support${bones.length}`; hip.add(bone); bones.push(bone); }
    root.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
    const positions = new Float32Array(17 * 3), indices = new Uint16Array(17 * 4), weights = new Float32Array(17 * 4);
    for (let i = 0; i < 17; i++) { positions[i * 3] = i / 17; indices[i * 4] = i; weights[i * 4] = 1; }
    mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const parent = new THREE.Group(), lod = new AnimationLod(parent, root, root, [walk], material => material);
    const terrain = { placement: new THREE.Matrix4(), origin: new THREE.Vector3(), heightAt: (x: number, z: number) => .1 * x + .05 * z };
    lod.set(0, new THREE.Matrix4(), { clip: walk, time: .2, blend: 1, terrain });
    const instance = parent.children[0] as THREE.InstancedMesh;
    const texture = sampledAnimationPalette(instance.material as THREE.Material)!.texture;
    texture.onUpdate!(texture);
    lod.set(0, new THREE.Matrix4(), { clip: walk, time: .4, blend: 1, terrain });
    expect(texture.updateRanges).toHaveLength(1);
    const range = texture.updateRanges[0]!;
    expect(range.count).toBe(17 * 16);
    expect(range.start % (texture.image.width * 4) + range.count).toBeLessThanOrEqual(texture.image.width * 4);
    lod.dispose();
  });

  it("refuses dynamic texture growth beyond the existing 64 MiB budget without corrupting active rows", () => {
    const { root, mesh, hip } = actor();
    const bones = [...mesh.skeleton.bones];
    while (bones.length < 256) { const bone = new THREE.Bone(); bone.name = `support${bones.length}`; hip.add(bone); bones.push(bone); }
    root.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
    // Every bone must influence geometry to exercise the compact palette's allocation ceiling.
    const positions = new Float32Array(256 * 3), indices = new Uint16Array(256 * 4), weights = new Float32Array(256 * 4);
    for (let i = 0; i < 256; i++) { positions[i * 3] = i / 256; indices[i * 4] = i; weights[i * 4] = 1; }
    mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const idle = new THREE.AnimationClip("long-idle", 204.7, []), overlay = overlayClip(), parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [idle], material => material);
    const pose: LodPose = { clip: idle, time: 2, blend: 1, overlay: { clip: overlay, time: .2, weight: 1 } };
    lod.set(1, new THREE.Matrix4(), pose);
    const allocated = lod.textureBytes;
    expect(allocated).toBe(64 * 1024 * 1024);
    expect(() => lod.set(2, new THREE.Matrix4(), pose)).toThrow(/64 MiB/);
    expect((parent.children[0] as THREE.InstancedMesh).count).toBe(1);
    expect(lod.textureBytes).toBe(allocated);
    lod.hide(1); lod.set(3, new THREE.Matrix4(), pose);
    expect(lod.drawCalls).toBe(1);
    lod.dispose();
  }, 20_000);
  it("interpolates real joint deformation and crossfades while preserving nonuniform mesh scales and skin bindings", () => {
    const { root, walk, hit } = actor();
    const parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk, hit], (material) => material);
    const placement = new THREE.Matrix4().compose(new THREE.Vector3(15, 4, -8), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1), new THREE.Vector3(2, 2, 2));
    lod.set(700, placement, { clip: walk, time: 0.325, previousClip: hit, previousTime: 0.175, blend: 0.4 });
    const instanced = parent.children[0] as THREE.InstancedMesh;
    for (let vertex = 0; vertex < 3; vertex++) {
      const current = referenceVertex(root, walk, 0.3, vertex).lerp(referenceVertex(root, walk, 0.35, vertex), 0.5);
      const previous = referenceVertex(root, hit, 0.15, vertex).lerp(referenceVertex(root, hit, 0.2, vertex), 0.5);
      const expected = previous.lerp(current, 0.4).applyMatrix4(placement);
      expect(paletteVertex(instanced, 0, vertex).distanceTo(expected)).toBeLessThan(0.000001);
      expect(lod.bounds(700, new THREE.Box3())!.containsPoint(expected)).toBe(true);
    }
    lod.set(700, placement, { clip: walk, time: walk.duration, blend: 1 });
    expect(paletteVertex(instanced, 0, 2).distanceTo(referenceVertex(root, walk, 1, 2).applyMatrix4(placement))).toBeLessThan(0.000001);
    lod.dispose();
  });

  it("keeps source poses and assets untouched and disposes all owned passes and palettes exactly once", () => {
    const { root, mesh, walk, geometry, material } = actor();
    const before = root.toJSON();
    const sourceDispose = vi.fn();
    geometry.addEventListener("dispose", sourceDispose);
    material.addEventListener("dispose", sourceDispose);
    material.map!.addEventListener("dispose", sourceDispose);
    const parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk], (source) => source);
    const instance = parent.children[0] as THREE.InstancedMesh;
    const owned = [instance.geometry, instance.material as THREE.Material, sampledAnimationPalette(instance.material as THREE.Material)!.texture];
    const releases = owned.map((resource) => { const spy = vi.fn(); resource.addEventListener("dispose", spy); return spy; });
    expect(instance.geometry).not.toBe(geometry);
    expect((instance.material as THREE.MeshStandardMaterial).map).toBe(material.map);
    expect(root.toJSON()).toEqual(before);
    lod.dispose();
    lod.dispose();
    expect(parent.children).toHaveLength(0);
    expect(sourceDispose).not.toHaveBeenCalled();
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps rigid bone-attached equipment articulated in the same imported coordinate system", () => {
    const { root, head, walk } = actor();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 2, 0], 3));
    const equipment = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    equipment.name = "crest";
    equipment.position.set(2, 0, 1);
    head.add(equipment);
    const parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk], (material) => material);
    lod.set(12, new THREE.Matrix4(), { clip: walk, time: 0.325, blend: 1 });
    const copy = cloneRigged(root);
    const mixer = new THREE.AnimationMixer(copy);
    mixer.clipAction(walk).play();
    const reference = (time: number) => {
      mixer.setTime(time);
      copy.updateMatrixWorld(true);
      return new THREE.Vector3(0, 2, 0).applyMatrix4(copy.getObjectByName("crest")!.matrixWorld);
    };
    const expected = reference(0.3).lerp(reference(0.35), 0.5);
    const rigid = parent.children.find((child) => (child as THREE.InstancedMesh).geometry.getAttribute("position").count === 3 && (child as THREE.InstancedMesh).geometry.getAttribute("position").getY(2) === 2) as THREE.InstancedMesh;
    expect(paletteVertex(rigid, 0, 2).distanceTo(expected)).toBeLessThan(0.000001);
    lod.dispose();
  });

  it("retains front-face orientation when an imported mesh hierarchy is mirrored", () => {
    const { root, walk, geometry } = actor();
    root.scale.x *= -1;
    const parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk], (material) => material);
    lod.set(3, new THREE.Matrix4(), { clip: walk, time: 0.2, blend: 1 });
    const mesh = parent.children[0] as THREE.InstancedMesh;
    expect(Array.from(mesh.geometry.index!.array)).toEqual([0, 2, 1]);
    expect(geometry.index).toBeNull();
    expect(paletteVertex(mesh, 0, 2).distanceTo(referenceVertex(root, walk, 0.2, 2))).toBeLessThan(0.000001);
    lod.dispose();
  });

  it("retains authored surface nodes while sharing the sampled pose and fade with automatic shadows", () => {
    const { root, walk, mesh: source } = actor();
    const material = new MeshStandardNodeMaterial();
    material.colorNode = vec3(0.3, 0.5, 0.8);
    (source as THREE.SkinnedMesh<THREE.BufferGeometry, THREE.Material>).material = material;
    const parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk], source => source);
    const mesh = parent.children[0] as THREE.InstancedMesh;
    const drawn = mesh.material as MeshStandardNodeMaterial;
    expect(drawn).not.toBe(material);
    expect(drawn.colorNode).toBe(material.colorNode);
    expect(drawn.positionNode?.isNode).toBe(true);
    expect(drawn.maskNode?.isNode).toBe(true);
    expect(mesh.customDepthMaterial).toBeUndefined();
    expect(mesh.customDistanceMaterial).toBeUndefined();
    lod.dispose();
  });

  it("fades individual instances and their shadows through the same stable opaque screen-door pattern", () => {
    const { root, walk } = actor();
    const parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk], (material) => material);
    lod.set(3, new THREE.Matrix4(), { clip: walk, time: 0.2, blend: 1 });
    lod.set(4, new THREE.Matrix4(), { clip: walk, time: 0.2, blend: 1, opacity: 0.35 });
    const mesh = parent.children[0] as THREE.InstancedMesh;
    const opacity = mesh.geometry.getAttribute("lodPreviousFrames");
    expect(opacity.getW(0)).toBe(1);
    expect(opacity.getW(1)).toBeCloseTo(0.35);
    const material = mesh.material as MeshStandardNodeMaterial;
    expect(material.transparent).toBe(false);
    expect(material.maskNode?.isNode).toBe(true);
    expect(material.maskShadowNode).toBeNull(); // shadows inherit the exact visible mask
    lod.hide(3);
    expect(opacity.getW(0)).toBeCloseTo(0.35);
    lod.set(4, new THREE.Matrix4(), { clip: walk, time: 0.3, blend: 1, opacity: 0 });
    expect(opacity.getW(0)).toBe(0);
    lod.dispose();
  });

  it("compacts sparse slots through capacity growth without losing poses, placement or per-material tint", () => {
    const { root, walk } = actor();
    const parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk], (material) => material);
    for (let index = 0; index < 19; index++) lod.set(10000 + index * 4, new THREE.Matrix4().makeTranslation(index, 0, 0), { clip: walk, time: index / 20, blend: 1 }, () => new THREE.Color(index / 20, 0.5, 1));
    const mesh = parent.children[0] as THREE.InstancedMesh;
    expect(parent.children).toHaveLength(1);
    expect(mesh.count).toBe(19);
    expect(lod.drawCalls).toBe(1);
    expect(lod.triangles).toBe(19);
    lod.hide(10000);
    expect(mesh.count).toBe(18);
    const placement = new THREE.Matrix4();
    mesh.getMatrixAt(0, placement);
    expect(placement.elements[12]).toBe(18);
    const color = new THREE.Color();
    mesh.getColorAt(0, color);
    expect(color.r).toBeCloseTo(0.9);
    expect(paletteVertex(mesh, 0, 2).distanceTo(referenceVertex(root, walk, 0.9, 2).add(new THREE.Vector3(18, 0, 0)))).toBeLessThan(0.000001);
    expect(lod.bounds(10000, new THREE.Box3())).toBeNull();
    for (let index = 1; index < 19; index++) lod.hide(10000 + index * 4);
    expect(lod.drawCalls).toBe(0);
    expect(mesh.visible).toBe(false);
    lod.dispose();
  });
});
