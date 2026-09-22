import type { InstancedMesh, InterleavedBufferAttribute, Object3D } from "three";
import { WGSLNodeBuilder, type WebGPURenderer } from "three/webgpu";

// r185's declarations omit this public runtime method. Keep that missing shape local.
type ShaderUniform = { name: string; type: string; node: object };
type UniformBuilder = {
  getUniformBufferLimit(): number;
  getUniformFromNode(node: object, type: string, shaderStage: string, name?: string | null): ShaderUniform;
};
const nativeBuilder = WGSLNodeBuilder.prototype as unknown as UniformBuilder;

/** Three's default buffer names contain process-global node IDs, making equivalent
 * skinned and instanced shaders miss its source-based GPU program cache. Supply names
 * during node lowering, before bindings and shader text are generated. */
export class StableWGSLNodeBuilder extends WGSLNodeBuilder {
  private readonly bufferNames = new WeakMap<object, string>();
  private nextBuffer = 0;
  private instanceUniformLimit: number | undefined;

  /** Matrix uniforms bake each cluster capacity into WGSL. Prefer Three's existing
   * interleaved instance attributes, which retain the source arrays and update ranges.
   * Explicit BufferNodes do not consult this limit and retain their declared capacities. */
  getUniformBufferLimit(): number {
    if (this.instanceUniformLimit !== undefined) return this.instanceUniformLimit;
    const nativeLimit = nativeBuilder.getUniformBufferLimit.call(this);
    const mesh = this.object as InstancedMesh;
    if (!mesh.isInstancedMesh) return nativeLimit;
    // Sampled actors deliberately apply instancing again after replacing the skinned
    // position. Their deferred TSL graph can add two sets of matrix attributes, so
    // the geometry alone cannot bound its input slots. Keep their native uniform path.
    if (mesh.geometry.hasAttribute("lodFrames") || mesh.geometry.hasAttribute("lodPreviousFrames")) {
      return nativeLimit;
    }
    const backend = this.renderer.backend as unknown as {
      device: { limits: { maxVertexAttributes?: number; maxVertexBuffers?: number } };
    };
    const limits = backend.device.limits;
    const attributes = Object.values(mesh.geometry.attributes);
    const buffers = new Set(attributes.map(attribute =>
      (attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute
        ? (attribute as InterleavedBufferAttribute).data : attribute));
    // World-space effects use another instance matrix through objectTransformNodes.
    // Reserve both four-column matrices and their buffers, even when a material uses one.
    const colorSlots = mesh.instanceColor ? 1 : 0;
    const attributeSlots = attributes.reduce((total, attribute) => total + Math.ceil(attribute.itemSize / 4), 0) + 8 + colorSlots;
    const bufferSlots = buffers.size + 2 + colorSlots;
    this.instanceUniformLimit = attributeSlots <= (limits.maxVertexAttributes ?? 16)
      && bufferSlots <= (limits.maxVertexBuffers ?? 8) ? 0 : nativeLimit;
    return this.instanceUniformLimit;
  }

  getUniformFromNode(node: object, type: string, shaderStage: string, name: string | null = null): ShaderUniform {
    if (type === "buffer" || type === "storageBuffer" || type === "indirectStorageBuffer") {
      name ||= this.bufferNames.get(node) ?? `NodeBuffer_local_${this.nextBuffer++}`;
      this.bufferNames.set(node, name);
    }
    return nativeBuilder.getUniformFromNode.call(this, node, type, shaderStage, name);
  }
}

const installed = new WeakSet<object>();

/** Apply only to this initialized native backend; the WebGL2 builder is unchanged. */
export function installStableShaderNames(renderer: WebGPURenderer): void {
  const backend = renderer.backend as unknown as {
    isWebGPUBackend?: boolean;
    createNodeBuilder(object: Object3D, renderer: WebGPURenderer): WGSLNodeBuilder;
  };
  if (!backend.isWebGPUBackend || installed.has(backend)) return;
  backend.createNodeBuilder = (object, activeRenderer) => new StableWGSLNodeBuilder(object, activeRenderer);
  installed.add(backend);
}
