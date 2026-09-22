import type { Object3D } from "three";
import { WGSLNodeBuilder, type WebGPURenderer } from "three/webgpu";

// r185's declarations omit this public runtime method. Keep that missing shape local.
type ShaderUniform = { name: string; type: string; node: object };
type UniformBuilder = {
  getUniformFromNode(node: object, type: string, shaderStage: string, name?: string | null): ShaderUniform;
};
const nativeUniform = (WGSLNodeBuilder.prototype as unknown as UniformBuilder).getUniformFromNode;

/** Three's default buffer names contain process-global node IDs, making equivalent
 * skinned and instanced shaders miss its source-based GPU program cache. Supply names
 * during node lowering, before bindings and shader text are generated. */
export class StableWGSLNodeBuilder extends WGSLNodeBuilder {
  private readonly bufferNames = new WeakMap<object, string>();
  private nextBuffer = 0;

  getUniformFromNode(node: object, type: string, shaderStage: string, name: string | null = null): ShaderUniform {
    if (type === "buffer" || type === "storageBuffer" || type === "indirectStorageBuffer") {
      name ||= this.bufferNames.get(node) ?? `NodeBuffer_local_${this.nextBuffer++}`;
      this.bufferNames.set(node, name);
    }
    return nativeUniform.call(this, node, type, shaderStage, name);
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
