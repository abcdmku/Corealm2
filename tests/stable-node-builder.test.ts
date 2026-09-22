import { BoxGeometry, InstancedMesh, Mesh, PerspectiveCamera, Scene, type Object3D } from "three";
import { BufferNode, MeshBasicNodeMaterial, WebGPURenderer, WGSLNodeBuilder } from "three/webgpu";
import { expect, it } from "vitest";
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

it("reuses identical WGSL for independent instanced buffers while preserving actual capacity variants", () => {
  const geometry = new BoxGeometry(), material = new MeshBasicNodeMaterial();
  const first = lower(new InstancedMesh(geometry, material, 4));
  const second = lower(new InstancedMesh(geometry, material, 4));
  const larger = lower(new InstancedMesh(geometry, material, 8));
  expect(first.vertex).toContain("NodeBuffer_local_0");
  expect(second).toEqual(first);
  expect(larger.vertex).not.toBe(first.vertex);
  expect(larger.vertex).toContain("array< mat4x4<f32>, 8 >");
  geometry.dispose(); material.dispose();
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
