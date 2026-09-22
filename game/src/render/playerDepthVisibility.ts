import * as THREE from "three/webgpu";

/** Close the final query through Three's object transition before the render pass ends.
 * r185 retains the last queried object across later non-query passes on the same target.
 * A trailing masked draw leaves that object non-querying and avoids a second query end.
 */
export function createOcclusionQueryEnd(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial> {
  const geometry = new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute([0, 0, 0, .001, 0, 0, 0, .001, 0], 3));
  const material = new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false, depthTest: false,
    transparent: true, blending: THREE.NoBlending, fog: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Occlusion query end';
  mesh.frustumCulled = false;
  mesh.renderOrder = Number.MAX_SAFE_INTEGER;
  mesh.layers.enableAll();
  return mesh;
}

/** Sample completed scene depth, including animated foliage, without waiting on the GPU. */
export class PlayerDepthVisibility {
  private readonly scene = new THREE.Scene();
  private readonly geometry = new THREE.SphereGeometry(0.025, 4, 3);
  private readonly material = new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false });
  private readonly queryEnd = createOcclusionQueryEnd();
  private readonly dots = Array.from({ length: 5 }, () => new THREE.Mesh(this.geometry, this.material));
  private readonly feet = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private blocked = 0;
  private activeRenderer: THREE.WebGPURenderer | null = null;

  constructor() {
    for (const dot of this.dots) {
      dot.frustumCulled = false;
      dot.occlusionTest = true;
      this.scene.add(dot);
    }
    this.scene.add(this.queryEnd);
    // isOccluded reads asynchronously resolved results for the active render
    // context. Calling it outside render cannot access those results.
    this.scene.onBeforeRender = () => {
      this.blocked = this.dots.filter(dot => this.activeRenderer?.isOccluded(dot) === true).length;
    };
  }

  async compile(renderer: THREE.WebGPURenderer, camera: THREE.Camera): Promise<void> {
    await renderer.compileAsync(this.scene, camera);
  }

  sample(renderer: THREE.WebGPURenderer, camera: THREE.Camera, source: THREE.Object3D | null): number {
    if (!source?.visible) { this.blocked = 0; return 0; }
    source.getWorldPosition(this.feet);
    const rightX = camera.matrixWorld.elements[0]!, rightZ = camera.matrixWorld.elements[2]!;
    const samples = [[0.65, 0], [1.05, 0], [1.5, 0], [1.1, -0.22], [1.1, 0.22]] as const;
    samples.forEach(([height, side], index) => {
      this.point.set(this.feet.x + rightX * side, this.feet.y + height, this.feet.z + rightZ * side);
      // Move to the front of the body so its own depth does not count as scenery.
      this.forward.copy(camera.position).sub(this.point).normalize();
      this.dots[index]!.position.copy(this.point).addScaledVector(this.forward, 0.4);
    });
    const autoClear = renderer.autoClear, autoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    this.activeRenderer = renderer;
    try { renderer.render(this.scene, camera); }
    finally {
      this.activeRenderer = null;
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
    }
    return this.blocked;
  }

  dispose(): void {
    this.queryEnd.geometry.dispose();
    this.queryEnd.material.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.scene.clear();
  }
}
