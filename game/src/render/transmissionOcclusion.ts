import * as THREE from "three/webgpu";

type Probe = { key: string; sample: THREE.Mesh; submitted: boolean; hidden: boolean | null; bounds: number[]; result?: boolean };
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
 * Default-off diagnostic. Only immutable terrain writes this private depth buffer:
 * moving foliage and actors cannot become stale occluders. Changing the camera,
 * terrain or target discards the query identity and restores ordinary drawing.
 */
export class TransmissionOcclusion {
  private enabled = false;
  private probeMode: "bounds" | "exact-diagnostic" = "bounds";
  private readonly probes = new Map<THREE.Mesh, Probe>();
  private readonly hidden = new Set<THREE.Mesh>();
  private readonly terrainScene = new THREE.Scene();
  private readonly probeScene = new THREE.Scene();
  private readonly depthMaterial = new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: true, fog: false });
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly probeMaterial = new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide, fog: false });
  private target: THREE.RenderTarget | null = null;
  private terrainKey = "";
  private submittedQueries = 0;
  private extraTriangles = 0;
  private queryCursor = 0;
  private supported = false;
  private lastProbeState: Record<string, unknown> | null = null;
  private lastFailure: string | null = null;

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
    return { enabled: this.enabled, probeMode: this.probeMode, lastFailure: this.lastFailure, supported: this.supported,
      hiddenMeshes: [...this.hidden].map(mesh => mesh.name),
      pendingQueries: [...this.probes.values()].filter(probe => probe.submitted && probe.hidden === null).length,
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
    this.probes.clear();
    this.probeScene.clear();
    this.queryCursor = 0;
  }

  update(renderer: THREE.WebGPURenderer, camera: THREE.Camera, terrain: THREE.Object3D | undefined,
    candidates: readonly THREE.Mesh[], opaqueSources: readonly TransmissionOpaqueOccluder[] = []): void {
    try { this.updateInternal(renderer, camera, terrain, candidates, opaqueSources); }
    catch (error) {
      this.lastFailure = error instanceof Error ? error.message : String(error);
      this.enabled = false;
      this.reset();
    }
  }

  private updateInternal(renderer: THREE.WebGPURenderer, camera: THREE.Camera, terrain: THREE.Object3D | undefined,
    candidates: readonly THREE.Mesh[], opaqueSources: readonly TransmissionOpaqueOccluder[]): void {
    this.restore();
    this.extraTriangles = 0;
    if (!this.enabled || !terrain || !candidates.length) return;
    if ((camera as THREE.Camera & { viewport?: THREE.Vector4 }).viewport) return;
    this.supported = typeof renderer.isOccluded === "function";
    if (!this.supported) { this.reset(); return; }
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
    if (!terrainMeshes.length) { this.reset(); return; }
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
      // An enclosing box crossing the near plane loses its front cap.
      let nearestDepth = Infinity;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        nearestDepth = Math.min(nearestDepth, -new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse).z);
      }
      if (nearestDepth <= ((camera as THREE.PerspectiveCamera).near ?? .1)) continue;
      seen.add(mesh);
      const key = `${cameraKey}|${bounds.min.toArray()},${bounds.max.toArray()}`;
      let probe = this.probes.get(mesh);
      if (!probe || probe.key !== key) {
        // A new identity prevents late GPU results for the previous camera/bounds
        // from hiding geometry after the source or view has changed.
        const sample = new THREE.Mesh(this.boxGeometry, this.probeMaterial);
        sample.frustumCulled = false;
        sample.occlusionTest = true;
        sample.layers.mask = camera.layers.mask;
        bounds.getCenter(sample.position);
        bounds.getSize(sample.scale);
        probe = { key, sample, submitted: false, hidden: null, bounds: [...bounds.min.toArray(), ...bounds.max.toArray()] };
        this.probes.set(mesh, probe);
      }
    }
    for (const mesh of this.probes.keys()) if (!seen.has(mesh)) this.probes.delete(mesh);
    if (!this.probes.size) return;
    if (!this.target) {
      this.target = new THREE.RenderTarget(viewport.x, viewport.y, { depthBuffer: true });
      this.target.samples = Math.max(4, renderer.samples);
    }
    this.target.setSize(viewport.x, viewport.y);
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const previousViewport = renderer.getViewport(new THREE.Vector4());
    const previousScissor = renderer.getScissor(new THREE.Vector4());
    const previousScissorTest = renderer.getScissorTest();
    const previousAutoClear = renderer.autoClear;
    const previousAutoReset = renderer.info.autoReset;
    const trianglesBefore = renderer.info.render.triangles;
    try {
      renderer.setRenderTarget(this.target);
      renderer.setScissorTest(false);
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      renderer.clear();
      // The API returns completed asynchronous results only inside this target's
      // render context. False/undefined is never evidence that a pending box is hidden.
      this.terrainScene.onBeforeRender = () => {
        for (const [mesh, probe] of this.probes) {
          if (!probe.submitted || probe.hidden === true) continue;
          const result = renderer.isOccluded(this.probeMode === "bounds" ? probe.sample : mesh);
          if (result === true) { probe.result = true; probe.hidden = true; }
        }
      };
      renderer.render(this.terrainScene, camera);
      const terrainTriangles = renderer.info.render.triangles - trianglesBefore;
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
        const triangles = renderer.info.render.triangles;
        try {
          for (const material of materials) material.colorWrite = false;
          withTransmissionOccluderSubset(source, () => { during = countVisible(); renderer.render(mesh, camera); });
        } finally { materials.forEach((material, index) => { material.colorWrite = colorWrites[index]!; }); }
        opaqueTriangles += renderer.info.render.triangles - triangles;
        opaqueVisibility.push({ name: mesh.name, allowed: source.instanceIds?.length ?? before, before, during, after: countVisible() });
      }
      const queued = [...this.probes].filter(([, probe]) => probe.hidden !== true);
      // Revisit unresolved/visible boxes in bounded round-robin batches. The backend
      // deliberately exposes no synchronous query-ready check.
      const count = Math.min(queued.length, this.probeMode === "bounds" ? 4 : 1);
      const selected = Array.from({ length: count }, (_, offset) => queued[(this.queryCursor + offset) % queued.length]!);
      this.queryCursor = queued.length ? (this.queryCursor + count) % queued.length : 0;
      this.probeScene.clear();
      if (this.probeMode === "bounds") {
        for (const [, probe] of selected) this.probeScene.add(probe.sample);
        if (selected.length) renderer.render(this.probeScene, camera);
      } else {
        // Exact diagnostic keeps native batch hooks, instances and discard shaders.
        for (const [mesh] of selected) this.renderExact(renderer, camera, mesh);
      }
      for (const [, probe] of selected) { probe.submitted = true; this.submittedQueries++; }
      this.lastProbeState = { mode: this.probeMode, terrainTriangles, opaqueTriangles, opaqueVisibility,
        opaqueSources: opaqueOccluders.map(source => source.mesh.name), depthTest: true,
        depthWrite: false, framebufferBound: true, samples: this.target.samples };
      for (const [mesh, probe] of this.probes) if (probe.hidden === true && this.probeMode === "bounds") {
        mesh.visible = false;
        this.hidden.add(mesh);
      }
    } finally {
      this.extraTriangles = renderer.info.render.triangles - trianglesBefore;
      this.terrainScene.onBeforeRender = () => {};
      renderer.autoClear = previousAutoClear;
      renderer.info.autoReset = previousAutoReset;
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
    }
  }

  private renderExact(renderer: THREE.WebGPURenderer, camera: THREE.Camera, mesh: THREE.Mesh): void {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const states = materials.map(material => ({ material, colorWrite: material.colorWrite,
      depthWrite: material.depthWrite, transmission: (material as THREE.MeshPhysicalMaterial).transmission }));
    const occlusionTest = mesh.occlusionTest;
    try {
      mesh.occlusionTest = true;
      for (const state of states) {
        state.material.colorWrite = false;
        state.material.depthWrite = false;
        if (state.transmission > 0) { (state.material as THREE.MeshPhysicalMaterial).transmission = 0; state.material.needsUpdate = true; }
      }
      renderer.render(mesh, camera);
    } finally {
      mesh.occlusionTest = occlusionTest;
      for (const state of states) {
        state.material.colorWrite = state.colorWrite;
        state.material.depthWrite = state.depthWrite;
        if (state.transmission > 0) { (state.material as THREE.MeshPhysicalMaterial).transmission = state.transmission; state.material.needsUpdate = true; }
      }
    }
  }

  dispose(): void {
    this.reset();
    this.target?.dispose();
    this.depthMaterial.dispose();
    this.boxGeometry.dispose();
    this.probeMaterial.dispose();
    this.terrainScene.clear();
  }
}
