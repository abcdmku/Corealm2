import * as THREE from "three";
import { clone as cloneRigged } from "three/examples/jsm/utils/SkeletonUtils.js";
import { describe, expect, it, vi } from "vitest";
import { AnimationLod } from "../game/src/render/animationLod.js";

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

describe("sampled skeletal animation LOD", () => {
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
