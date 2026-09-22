import { PerspectiveCamera, Scene, type Camera, type Object3D } from "three";
import { WebGPURenderer, WGSLNodeBuilder } from "three/webgpu";

/** Execute deferred TSL graphs and generate WGSL without creating a GPU device.
 * This catches graph construction errors; browser checks still own shader/device
 * validation and rendered output.
 */
export function lowerToWgsl(object: Object3D, scene = new Scene(), camera: Camera = new PerspectiveCamera()) {
  const canvas = {
    width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {},
  } as unknown as HTMLCanvasElement;
  const renderer = new WebGPURenderer({ canvas });
  Object.assign(renderer.backend, {
    device: { features: new Set<string>(), limits: { maxUniformBufferBindingSize: 65536 } },
  });
  renderer.hasFeature = () => false;
  // Runtime NodeBuilder exposes these fields; the r185 declaration is incomplete.
  const builder = new WGSLNodeBuilder(object, renderer) as WGSLNodeBuilder & {
    scene: Scene; camera: Camera; build(): void; vertexShader: string; fragmentShader: string;
  };
  builder.scene = scene;
  builder.camera = camera;
  builder.build();
  return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}
