import { AnimationClip, Bone, Group, Skeleton, SkinnedMesh, VectorKeyframeTrack, Float32BufferAttribute, BoxGeometry, InstancedMesh, Mesh, PerspectiveCamera, Scene, type Object3D } from "three";
import { BufferNode, MeshBasicNodeMaterial, MeshStandardNodeMaterial, WebGPURenderer, WGSLNodeBuilder, type Node } from "three/webgpu";
import { buffer, positionLocal, vec4 } from "three/tsl";
import { expect, it } from "vitest";
import { AnimationLod } from "../game/src/render/animationLod.js";
import { objectInstanceWorldOrigin } from "../game/src/render/objectTransformNodes.js";
import { installStableShaderNames, StableWGSLNodeBuilder } from "../game/src/render/stableNodeBuilder.js";

function rendererFixture() {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
  const renderer = new WebGPURenderer({ canvas });
  Object.assign(renderer.backend, { device: { features: new Set<string>(), limits: { maxUniformBufferBindingSize: 65536 } } });
  renderer.hasFeature = () => false;
  return renderer;
}

function lower(object: Object3D) {
  const builder = new StableWGSLNodeBuilder(object, rendererFixture()) as StableWGSLNodeBuilder & {
    scene: Scene; camera: PerspectiveCamera; build(): void; vertexShader: string; fragmentShader: string;
  };
  builder.scene = new Scene(); builder.camera = new PerspectiveCamera(); builder.build();
  return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

it("reuses identical WGSL for independent instanced buffers of different capacities", () => {
  const geometry = new BoxGeometry(), material = new MeshBasicNodeMaterial();
  const first = lower(new InstancedMesh(geometry, material, 4));
  const second = lower(new InstancedMesh(geometry, material, 4));
  const larger = lower(new InstancedMesh(geometry, material, 8));
  expect(first.vertex).not.toContain("var<uniform> NodeBuffer_");
  expect(second).toEqual(first);
  expect(larger).toEqual(first);
  geometry.dispose(); material.dispose();
});

it("preserves capacity differences in explicit authored uniform buffers", () => {
  const geometry = new BoxGeometry();
  const shaders = [4, 8].map(count => {
    const material = new MeshBasicNodeMaterial();
    const transforms = buffer(new Float32Array(count * 16), "mat4" as const, count);
    // r185 omits BufferNode.element from its declarations, although its TSL proxy supports it.
    const matrix = (transforms as typeof transforms & { element(index: number): Node<"mat4"> }).element(0);
    material.positionNode = matrix.mul(vec4(positionLocal, 1)).xyz;
    return lower(new InstancedMesh(geometry, material, 4));
  });
  expect(shaders[0]!.vertex).toContain("array< mat4x4<f32>, 4 >");
  expect(shaders[1]!.vertex).toContain("array< mat4x4<f32>, 8 >");
  expect(shaders[0]!.vertex).not.toBe(shaders[1]!.vertex);
  geometry.dispose();
});

it("retains the uniform path when the instance attributes could exceed device layout limits", () => {
  const geometry = new BoxGeometry();
  for (let index = 0; index < 4; index++) geometry.setAttribute(`custom${index}`, new Float32BufferAttribute(new Float32Array(24 * 4), 4));
  const mesh = new InstancedMesh(geometry, new MeshBasicNodeMaterial(), 4);
  const builder = new StableWGSLNodeBuilder(mesh, rendererFixture());
  expect(builder.getUniformBufferLimit()).toBe(65536);
  const ordinary = new StableWGSLNodeBuilder(new Mesh(), rendererFixture());
  expect(ordinary.getUniformBufferLimit()).toBe(65536);
  geometry.dispose();
});

it("keeps production sampled actor shaders within vertex limits when their position graph repeats instancing", () => {
  const root = new Group(), parent = new Group(), bone = new Bone();
  bone.name = "hip"; root.add(bone);
  const geometry = new BoxGeometry(), vertices = geometry.getAttribute("position").count;
  const weights = new Float32Array(vertices * 4);
  for (let vertex = 0; vertex < vertices; vertex++) weights[vertex * 4] = 1;
  geometry.setAttribute("skinIndex", new Float32BufferAttribute(new Float32Array(vertices * 4), 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
  geometry.setAttribute("tangent", new Float32BufferAttribute(new Float32Array(vertices * 4).fill(1), 4));
  geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(vertices * 4).fill(1), 4));
  const material = new MeshStandardNodeMaterial({ vertexColors: true });
  material.positionNode = positionLocal.add(objectInstanceWorldOrigin().mul(0.00001));
  const mesh = new SkinnedMesh(geometry, material); root.add(mesh); root.updateMatrixWorld(true);
  mesh.bind(new Skeleton([bone]));
  const clip = new AnimationClip("walk", 1, [new VectorKeyframeTrack("hip.position", [0, 1], [0, 0, 0, 0, 1, 0])]);
  const lod = new AnimationLod(parent, root, root, [clip], source => source);
  try {
    const sampled = parent.children[0] as InstancedMesh;
    expect(sampled.geometry.hasAttribute("lodFrames")).toBe(true);
    const builder = new StableWGSLNodeBuilder(sampled, rendererFixture());
    expect(builder.getUniformBufferLimit()).toBe(65536);
    const shader = lower(sampled).vertex;
    expect(shader).toContain("var<uniform> NodeBuffer_local_");
    const inputs = [...shader.slice(shader.indexOf("@vertex")).matchAll(/@location\(\s*(\d+)\s*\)/g)].map(match => Number(match[1]));
    expect(inputs.length).toBeGreaterThan(8);
    expect(Math.max(...inputs)).toBeLessThan(16);
  } finally { lod.dispose(); geometry.dispose(); material.dispose(); }
});

it("keeps distinct bindings separate, shares names across stages, and preserves authored names", () => {
  const builder = new StableWGSLNodeBuilder(new Mesh(), rendererFixture());
  const first = new BufferNode(new Float32Array(16), "mat4", 1);
  const second = new BufferNode(new Float32Array(16), "mat4", 1);
  const authored = new BufferNode(new Float32Array(16), "mat4", 1);
  const firstVertex = builder.getUniformFromNode(first, "buffer", "vertex");
  const firstFragment = builder.getUniformFromNode(first, "buffer", "fragment");
  const secondVertex = builder.getUniformFromNode(second, "buffer", "vertex");
  const named = builder.getUniformFromNode(authored, "buffer", "vertex", "AuthoredTransforms");
  expect(firstVertex.name).toBe(firstFragment.name);
  expect(firstVertex.name).not.toBe(secondVertex.name);
  expect(firstVertex.node).toBe(first);
  expect(secondVertex.node).toBe(second);
  expect(named.name).toBe("AuthoredTransforms");
  expect(builder.getUniformFromNode(authored, "buffer", "fragment").name).toBe(named.name);
});

it("installs the builder only on its native renderer without changing other renderer factories", () => {
  const renderer = rendererFixture();
  const backend = renderer.backend as unknown as { createNodeBuilder(object: Object3D, renderer: WebGPURenderer): WGSLNodeBuilder };
  const before = backend.createNodeBuilder;
  installStableShaderNames(renderer);
  expect(backend.createNodeBuilder(new Mesh(), renderer)).toBeInstanceOf(StableWGSLNodeBuilder);
  const factory = backend.createNodeBuilder;
  installStableShaderNames(renderer);
  expect(backend.createNodeBuilder).toBe(factory);
  const fallback = { backend: { isWebGPUBackend: false, createNodeBuilder: before } } as unknown as WebGPURenderer;
  installStableShaderNames(fallback);
  expect((fallback.backend as unknown as typeof backend).createNodeBuilder).toBe(before);
});
