import * as THREE from "three";

/** Sample the completed scene depth, including animated foliage and rendered scenery. */
export class PlayerDepthVisibility {
  private readonly scene = new THREE.Scene();
  private readonly geometry = new THREE.SphereGeometry(0.025, 4, 3);
  private readonly material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  private readonly dot = new THREE.Mesh(this.geometry, this.material);
  private readonly feet = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private queries: WebGLQuery[] = [];
  private context: WebGL2RenderingContext | null = null;
  private pending = false;
  private blocked = 0;

  constructor() { this.scene.add(this.dot); this.dot.frustumCulled = false; }

  sample(renderer: THREE.WebGLRenderer, camera: THREE.Camera, source: THREE.Object3D | null): number {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (!source?.visible) { this.blocked = 0; return 0; }
    if (!this.context) {
      this.context = gl;
      for (let i = 0; i < 5; i++) {
        const query = gl.createQuery();
        if (query) this.queries.push(query);
      }
    }
    if (this.queries.length !== 5) return 0;
    if (this.pending) {
      if (!this.queries.every(query => gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))) return this.blocked;
      this.blocked = this.queries.filter(query => !gl.getQueryParameter(query, gl.QUERY_RESULT)).length;
      this.pending = false;
    }
    source.getWorldPosition(this.feet);
    const rightX = camera.matrixWorld.elements[0]!, rightZ = camera.matrixWorld.elements[2]!;
    const samples = [[0.65, 0], [1.05, 0], [1.5, 0], [1.1, -0.22], [1.1, 0.22]] as const;
    const autoClear = renderer.autoClear, autoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    try {
      samples.forEach(([height, side], index) => {
        this.point.set(this.feet.x + rightX * side, this.feet.y + height, this.feet.z + rightZ * side);
        // Move to the front of the body so the player's own depth does not count as scenery.
        this.forward.copy(camera.position).sub(this.point).normalize();
        this.dot.position.copy(this.point).addScaledVector(this.forward, 0.4);
        gl.beginQuery(gl.ANY_SAMPLES_PASSED, this.queries[index]!);
        try { renderer.render(this.scene, camera); }
        finally { gl.endQuery(gl.ANY_SAMPLES_PASSED); }
      });
      this.pending = true;
    } finally {
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
    }
    return this.blocked;
  }

  dispose(): void {
    for (const query of this.queries) this.context?.deleteQuery(query);
    this.queries = [];
    this.geometry.dispose(); this.material.dispose(); this.scene.clear();
  }
}
