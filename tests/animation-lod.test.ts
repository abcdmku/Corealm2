import * as THREE from "three";
import { clone as cloneRigged } from "three/examples/jsm/utils/SkeletonUtils.js";
import { describe, expect, it, vi } from "vitest";
import { AnimationLod, type LodPose } from "../game/src/render/animationLod.js";

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

type Shader = Parameters<THREE.Material["onBeforeCompile"]>[0];
function compile(material: THREE.Material, library: "standard" | "depth" | "distance" = "standard"): Shader {
  const shader = { vertexShader: THREE.ShaderLib[library].vertexShader, fragmentShader: THREE.ShaderLib[library].fragmentShader, uniforms: {} } as Shader;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
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
  const shader = compile(mesh.material as THREE.Material);
  const texture = shader.uniforms["lodPalette"]!.value as THREE.DataTexture;
  const bones = shader.uniforms["lodBoneCount"]!.value as number;
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

  it("updates only dynamic texel rows after upload while retaining the baked palette and all shadow uniforms", () => {
    const { root, walk } = actor(), overlay = overlayClip(), parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk], material => material);
    lod.set(4, new THREE.Matrix4(), { clip: walk, time: .2, blend: 1, overlay: { clip: overlay, time: .1, weight: 1 } });
    const mesh = parent.children[0] as THREE.InstancedMesh, shader = compile(mesh.material as THREE.Material);
    const texture = shader.uniforms["lodPalette"]!.value as THREE.DataTexture;
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
    expect(compile(mesh.customDepthMaterial!, "depth").uniforms["lodPalette"]!.value).toBe(texture);
    expect(compile(mesh.customDistanceMaterial!, "distance").uniforms["lodPalette"]!.value).toBe(texture);
    expect(() => lod.set(5, new THREE.Matrix4(), { clip: walk, time: 0, blend: 1, overlay: { clip: walk, time: 0, weight: 1 } })).toThrow(/additive/);
    lod.dispose();
  });

  it("refuses dynamic texture growth beyond the existing 64 MiB budget without corrupting active rows", () => {
    const { root, mesh, hip } = actor();
    const bones = [...mesh.skeleton.bones];
    while (bones.length < 256) { const bone = new THREE.Bone(); bone.name = `support${bones.length}`; hip.add(bone); bones.push(bone); }
    root.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
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
    const shader = compile(instance.material as THREE.Material);
    const owned = [instance.geometry, instance.material as THREE.Material, instance.customDepthMaterial!, instance.customDistanceMaterial!, shader.uniforms["lodPalette"]!.value as THREE.DataTexture];
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

  it("uses identical articulated poses for color, directional shadows and point shadows, retaining material hooks", () => {
    const { root, walk, material } = actor();
    material.onBeforeCompile = function (shader) { expect(this).toBe(material); shader.vertexShader += "\n// authored material hook"; };
    material.customProgramCacheKey = () => "authored-surface-v3";
    const parent = new THREE.Group();
    const lod = new AnimationLod(parent, root, root, [walk], (source) => source);
    const mesh = parent.children[0] as THREE.InstancedMesh;
    const color = compile(mesh.material as THREE.Material);
    expect(color.vertexShader).toContain("// authored material hook");
    expect((mesh.material as THREE.Material).customProgramCacheKey()).toContain("authored-surface-v3");
    for (const shader of [color, compile(mesh.customDepthMaterial!, "depth"), compile(mesh.customDistanceMaterial!, "distance")]) {
      expect(shader.uniforms["lodPalette"]!.value).toBe(color.uniforms["lodPalette"]!.value);
      expect(shader.vertexShader).toContain("transformed = (lodSkin * vec4(transformed, 1.0)).xyz;");
      expect(shader.vertexShader).not.toContain("#include <skinning_vertex>");
    }
    expect(color.vertexShader).toContain("transpose(inverse(lodBasis))");
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
    for (const [material, library] of [[mesh.material as THREE.Material, "standard"], [mesh.customDepthMaterial!, "depth"], [mesh.customDistanceMaterial!, "distance"]] as const) {
      const shader = compile(material, library);
      expect(material.transparent).toBe(false);
      expect(shader.vertexShader).toContain("lodOpacity = lodPreviousFrames.w;");
      expect(shader.fragmentShader).toContain("mod(floor(gl_FragCoord.xy), 4.0)");
      expect(shader.fragmentShader).toContain("if (lodOpacity < lodThreshold) discard;");
      expect(shader.fragmentShader).toContain("const float lodBayer[16]");
    }
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
