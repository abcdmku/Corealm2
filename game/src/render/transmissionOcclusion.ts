import * as THREE from "three";

type Probe = { key: string; query: WebGLQuery | null; hidden: boolean | null; bounds?: number[]; result?: unknown };
/** Caller certifies static geometry/instances and changes revision on any source lifecycle change. */
export interface TransmissionOpaqueOccluder { mesh: THREE.Mesh; revision: string; instanceIds?: readonly number[]; sourceInstanceIds?: readonly number[] }

/** Restrict the original batch only for this synchronous draw; restore even when rendering throws. */
export function withTransmissionOccluderSubset<T>(source: TransmissionOpaqueOccluder, draw: () => T): T {
  const batch = source.mesh as THREE.BatchedMesh;
  if (!batch.isBatchedMesh || !source.instanceIds) return draw();
  if (!source.sourceInstanceIds) throw new Error("Native batch subset requires its complete live instance ID inventory");
  const allowed = new Set(source.instanceIds);
  const changed: number[] = [];
  try {
    for (const index of source.sourceInstanceIds) {
      if (!allowed.has(index) && batch.getVisibleAt(index)) { batch.setVisibleAt(index, false); changed.push(index); }
    }
    return draw();
  } finally { for (const index of changed) batch.setVisibleAt(index, true); }
}

export function isTransmissionDepthOccluder(mesh: THREE.Mesh, camera: THREE.Camera): boolean {
  if (!mesh.visible || !mesh.layers.test(camera.layers) || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return false;
  for (let parent = mesh.parent; parent; parent = parent.parent) if (!parent.visible) return false;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.every(material => material.visible && !material.transparent && material.depthTest && material.depthWrite
    && !(material as THREE.MeshPhysicalMaterial).transmission
    && (material.depthFunc === THREE.LessDepth || material.depthFunc === THREE.LessEqualDepth));
}

/** A padded enclosing box. Testing it can reject only a completely hidden surface. */
export function transmissionProbeBounds(bounds: THREE.Box3, camera: THREE.Camera, height: number): THREE.Box3 {
  const centre = bounds.getCenter(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse);
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  const perspective = camera.projectionMatrix.elements[15] === 0;
  const padding = 2 * (perspective ? Math.abs(centre.z) + radius : 1)
    / Math.max(1e-6, Math.abs(camera.projectionMatrix.elements[5]!) * height) * 2;
  return bounds.clone().expandByScalar(Math.max(.001, padding));
}

/**
 * Default-off diagnostic. Only immutable terrain writes this private depth buffer: moving leaves,
 * actors and props cannot become stale occluders. A camera/terrain/target change restores drawing.
 */
export class TransmissionOcclusion {
  private enabled = false;
  private probeMode: "bounds" | "exact-diagnostic" = "bounds";
  private readonly probes = new Map<THREE.Mesh, Probe>();
  private readonly hidden = new Set<THREE.Mesh>();
  private readonly terrainScene = new THREE.Scene();
  private readonly probeScene = new THREE.Scene();
  private readonly depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, fog: false });
  private readonly box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  private target: THREE.WebGLRenderTarget | null = null;
  private terrainKey = "";
  private submittedQueries = 0;
  private extraTriangles = 0;
  private lastProbeState: Record<string, unknown> | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private lastFailure: string | null = null;

  constructor() { this.box.frustumCulled = false; this.probeScene.add(this.box); }

  get active(): boolean { return this.enabled; }

  /** Exact source sampling is diagnostic only: it never authorizes cached hiding. */
  setProbeMode(mode: "bounds" | "exact-diagnostic"): void {
    if (mode !== this.probeMode) { this.reset(); this.probeMode = mode; }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.lastFailure = null;
    if (!enabled) this.reset();
  }

  snapshot() {
    return { enabled: this.enabled, probeMode: this.probeMode, lastFailure: this.lastFailure, supported: this.gl !== null, hiddenMeshes: [...this.hidden].map(mesh => mesh.name),
      pendingQueries: [...this.probes.values()].filter(probe => probe.query !== null).length,
      submittedQueries: this.submittedQueries, extraTriangles: this.extraTriangles,
      lastProbeState: this.lastProbeState,
      probes: [...this.probes].map(([mesh, probe]) => ({ name: mesh.name, hidden: probe.hidden, result: probe.result, bounds: probe.bounds })) };
  }

  restore(): void {
    for (const mesh of this.hidden) mesh.visible = true;
    this.hidden.clear();
  }

  reset(): void {
    this.restore();
    if (this.gl) for (const probe of this.probes.values()) if (probe.query) this.gl.deleteQuery(probe.query);
    this.probes.clear();
  }

  update(renderer: THREE.WebGLRenderer, camera: THREE.Camera, terrain: THREE.Object3D | undefined,
    candidates: readonly THREE.Mesh[], opaqueSources: readonly TransmissionOpaqueOccluder[] = []): void {
    try { this.updateInternal(renderer, camera, terrain, candidates, opaqueSources); }
    catch (error) {
      // A diagnostic must not prevent the ordinary render or leave a stale hidden source.
      this.lastFailure = error instanceof Error ? error.message : String(error);
      this.enabled = false;
      this.reset();
    }
  }

  private updateInternal(renderer: THREE.WebGLRenderer, camera: THREE.Camera, terrain: THREE.Object3D | undefined,
    candidates: readonly THREE.Mesh[], opaqueSources: readonly TransmissionOpaqueOccluder[]): void {
    this.restore();
    this.extraTriangles = 0;
    if (!this.enabled || !terrain || !candidates.length) return;
    if (renderer.clippingPlanes?.length || (camera as THREE.Camera & { viewport?: THREE.Vector4 }).viewport) return;
    const context = renderer.getContext();
    if (!("createQuery" in context) || context.isContextLost()) { this.reset(); return; }
    this.gl = context;
    const gl = context;
    const viewport = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (viewport.x < 1 || viewport.y < 1) return;
    terrain.updateWorldMatrix(true, true);
    const terrainMeshes: THREE.Mesh[] = [];
    terrain.traverseVisible(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.name.startsWith("terrain-chunk-") || !mesh.layers.test(camera.layers)) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some(material => !material.visible || material.transparent || !material.depthWrite
        || material.alphaTest > 0 || material.alphaHash || material.clippingPlanes?.length || material.side === THREE.BackSide
        || (material.depthFunc !== THREE.LessDepth && material.depthFunc !== THREE.LessEqualDepth)
        || (material as THREE.MeshStandardMaterial).displacementMap)) return;
      terrainMeshes.push(mesh);
    });
    if (!terrainMeshes.length) return;
    const opaqueOccluders = this.probeMode === "exact-diagnostic"
      ? opaqueSources.filter(source => !candidates.includes(source.mesh) && isTransmissionDepthOccluder(source.mesh, camera)) : [];
    for (const source of opaqueOccluders) source.mesh.updateWorldMatrix(true, false);
    const terrainKey = terrainMeshes.map(mesh => {
      const position = mesh.geometry.getAttribute("position");
      const version = "version" in position ? position.version : position.data.version;
      return `${mesh.geometry.uuid}:${version}:${mesh.geometry.index?.version}:${mesh.geometry.drawRange.start},${mesh.geometry.drawRange.count}:${mesh.matrixWorld.elements.join(",")}`;
    }).join("|") + opaqueOccluders.map(({ mesh, revision, instanceIds }) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      return `|opaque:${mesh.uuid}:${revision}:${instanceIds?.join(",")}:${mesh.geometry.uuid}:${mesh.matrixWorld.elements.join(",")}:${materials.map(m => `${m.uuid}:${m.version}`).join(",")}`;
    }).join("");
    if (terrainKey !== this.terrainKey) {
      this.reset();
      this.terrainKey = terrainKey;
      this.terrainScene.clear();
      for (const source of terrainMeshes) {
        const proxy = new THREE.Mesh(source.geometry, this.depthMaterial);
        proxy.matrixAutoUpdate = false;
        proxy.matrix.copy(source.matrixWorld);
        proxy.layers.mask = source.layers.mask;
        this.terrainScene.add(proxy);
      }
    }
    const cameraKey = `${camera.projectionMatrix.elements.join(",")}|${camera.matrixWorldInverse.elements.join(",")}|${camera.layers.mask}|${viewport.x},${viewport.y}`;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    const queued: { mesh: THREE.Mesh; bounds: THREE.Box3; probe: Probe }[] = [];
    const seen = new Set<THREE.Mesh>();
    for (const mesh of candidates) {
      if (!mesh.visible || mesh.castShadow || (mesh as THREE.SkinnedMesh).isSkinnedMesh || !mesh.layers.test(camera.layers)) continue;
      let ancestor = mesh.parent;
      let visibleParents = true;
      while (ancestor) { if (!ancestor.visible) { visibleParents = false; break; } ancestor = ancestor.parent; }
      if (!visibleParents) continue;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!materials.some(material => (material as THREE.MeshPhysicalMaterial).transmission > 0)) continue;
      mesh.updateWorldMatrix(true, false);
      const batched = mesh as THREE.BatchedMesh;
      if (batched.isBatchedMesh) batched.computeBoundingBox();
      const bounds = transmissionProbeBounds(new THREE.Box3().setFromObject(mesh), camera, viewport.y);
      if (bounds.isEmpty() || !frustum.intersectsBox(bounds)) continue;
      // An enclosing box crossing the near plane loses its front cap; do not trust that query.
      let nearestDepth = Infinity;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        nearestDepth = Math.min(nearestDepth, -new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse).z);
      }
      if (nearestDepth <= ((camera as THREE.PerspectiveCamera).near ?? .1)) continue;
      seen.add(mesh);
      const key = `${cameraKey}|${bounds.min.toArray()},${bounds.max.toArray()}`;
      let probe = this.probes.get(mesh);
      if (!probe || probe.key !== key) {
        if (probe?.query) gl.deleteQuery(probe.query);
        probe = { key, query: null, hidden: null, bounds: [...bounds.min.toArray(), ...bounds.max.toArray()] };
        this.probes.set(mesh, probe);
      }
      if (probe.query && gl.getQueryParameter(probe.query, gl.QUERY_RESULT_AVAILABLE)) {
        probe.result = gl.getQueryParameter(probe.query, gl.QUERY_RESULT);
        probe.hidden = probe.result === false || probe.result === 0;
        gl.deleteQuery(probe.query); probe.query = null;
      }
      if (probe.hidden === true && this.probeMode === "bounds") { mesh.visible = false; this.hidden.add(mesh); }
      else if (probe.hidden === null && !probe.query) queued.push({ mesh, bounds, probe });
    }
    for (const [mesh, probe] of this.probes) if (!seen.has(mesh)) {
      if (probe.query) gl.deleteQuery(probe.query);
      this.probes.delete(mesh);
    }
    if (!queued.length) return;
    // No blocking result reads, and no overlapping occlusion query from another diagnostic.
    if (gl.getQuery(gl.ANY_SAMPLES_PASSED, gl.CURRENT_QUERY)) return;
    if (!this.target) {
      this.target = new THREE.WebGLRenderTarget(viewport.x, viewport.y, { depthBuffer: true });
      this.target.samples = Math.max(4, Number(gl.getParameter(gl.SAMPLES)) || 0);
    }
    this.target.setSize(viewport.x, viewport.y);
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace?.() ?? 0;
    const previousMip = renderer.getActiveMipmapLevel?.() ?? 0;
    const previousViewport = renderer.getViewport(new THREE.Vector4());
    const previousScissor = renderer.getScissor(new THREE.Vector4());
    const previousScissorTest = renderer.getScissorTest();
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.setRenderTarget(this.target);
      renderer.setScissorTest(false);
      renderer.autoClear = false;
      renderer.clear();
      renderer.render(this.terrainScene, camera);
      this.extraTriangles += renderer.info.render.triangles;
      const terrainTriangles = renderer.info.render.triangles;
      let opaqueTriangles = 0;
      const opaqueVisibility: { name: string; allowed: number; before: number; during: number; after: number }[] = [];
      for (const source of opaqueOccluders) {
        const { mesh } = source;
        const batch = mesh as THREE.BatchedMesh;
        const countVisible = () => batch.isBatchedMesh ? (source.sourceInstanceIds ?? []).filter(i => batch.getVisibleAt(i)).length : 1;
        const before = countVisible();
        let during = before;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const colorWrites = materials.map(material => material.colorWrite);
        // Keep the actual alpha texture, discard shader, sidedness, depth state and batch hooks.
        // No proxy box or simplified solid may occlude a sample absent from native geometry.
        try {
          for (const material of materials) material.colorWrite = false;
          withTransmissionOccluderSubset(source, () => { during = countVisible(); renderer.render(mesh, camera); });
          opaqueTriangles += renderer.info.render.triangles;
          this.extraTriangles += renderer.info.render.triangles;
        } finally { materials.forEach((material, index) => { material.colorWrite = colorWrites[index]!; }); }
        opaqueVisibility.push({ name: mesh.name, allowed: source.instanceIds?.length ?? before, before, during, after: countVisible() });
      }
      this.box.layers.mask = camera.layers.mask;
      for (const entry of queued.slice(0, 4)) {
        entry.bounds.getCenter(this.box.position);
        entry.bounds.getSize(this.box.scale);
        const query = gl.createQuery();
        if (!query) continue;
        let active = false;
        let submitted = false;
        let completed = false;
        const exact = this.probeMode === "exact-diagnostic";
        const object = exact ? entry.mesh : this.box;
        const before = object.onBeforeRender;
        const after = object.onAfterRender;
        const captureProbeState = () => {
          this.lastProbeState = { mode: this.probeMode, terrainTriangles, opaqueTriangles, opaqueVisibility,
            opaqueSources: opaqueOccluders.map(source => source.mesh.name), depthTest: gl.isEnabled?.(gl.DEPTH_TEST),
            depthFunction: gl.getParameter(gl.DEPTH_FUNC), depthWrite: gl.getParameter(gl.DEPTH_WRITEMASK),
            framebufferBound: Boolean(gl.getParameter(gl.FRAMEBUFFER_BINDING)), samples: gl.getParameter(gl.SAMPLES) };
        };
        // Use the actual batch and its original hooks, geometry, instance textures and transforms.
        // Disable only colour output, depth writes and the unrelated transmission colour prepass.
        const materials = exact ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
        const states = materials.map(material => ({ material, colorWrite: material.colorWrite,
          depthWrite: material.depthWrite, transmission: (material as THREE.MeshPhysicalMaterial).transmission }));
        for (const state of states) {
          state.material.colorWrite = false; state.material.depthWrite = false;
          if (state.transmission > 0) { (state.material as THREE.MeshPhysicalMaterial).transmission = 0; state.material.needsUpdate = true; }
        }
        object.onBeforeRender = function (...args) {
          before.apply(this, args);
          gl.beginQuery(gl.ANY_SAMPLES_PASSED, query); active = true; submitted = true;
        };
        object.onAfterRender = function (...args) {
          gl.endQuery(gl.ANY_SAMPLES_PASSED); active = false;
          captureProbeState();
          after.apply(this, args);
        };
        try {
          renderer.render(exact ? object : this.probeScene, camera);
          completed = true;
        }
        finally {
          try { if (active) gl.endQuery(gl.ANY_SAMPLES_PASSED); }
          finally {
            object.onBeforeRender = before;
            object.onAfterRender = after;
            for (const state of states) {
              state.material.colorWrite = state.colorWrite; state.material.depthWrite = state.depthWrite;
              if (state.transmission > 0) { (state.material as THREE.MeshPhysicalMaterial).transmission = state.transmission; state.material.needsUpdate = true; }
            }
            if (!completed) gl.deleteQuery(query);
          }
        }
        this.extraTriangles += renderer.info.render.triangles;
        if (submitted) { entry.probe.query = query; this.submittedQueries++; }
        else gl.deleteQuery(query);
      }
    } finally {
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
    }
  }

  dispose(): void {
    this.reset(); this.target?.dispose(); this.depthMaterial.dispose();
    this.box.geometry.dispose(); (this.box.material as THREE.Material).dispose();
    this.terrainScene.clear();
  }
}
