import * as THREE from "three";
import { compileCorpseFadeVariants, compileShadowMeshes } from "./shaderPreparation.js";

/** Prepare newly resident meshes before their first draw can synchronously wait on the driver. */
export class StreamedShaderWarmup {
  /** A covered destination may defer new actors; ordinary play must keep actors visible. */
  deferGameplayDraws = false;
  private readonly waiting = new Set<THREE.Mesh>();
  private readonly enrolled = new WeakSet<THREE.Mesh>();
  private readonly pendingRoots = new Map<THREE.Object3D, number>();
  private readonly pendingAncestors = new Map<THREE.Mesh, THREE.Object3D[]>();
  private readonly queued = new Set<THREE.Mesh>();
  private readonly watched = new Set<THREE.Object3D>();
  private readonly hidden: THREE.Mesh[] = [];
  private readonly materials = new Map<THREE.Material, { clone: THREE.Material; version: number; dispose: () => void }>();
  private readonly retired = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly preparedTextures = new WeakMap<THREE.Texture, number>();
  private pending = false;
  private batch: THREE.Mesh[] = [];
  private programs: NonNullable<THREE.WebGLRenderer["info"]["programs"]> = [];
  private readonly readyPrograms = new WeakSet<object>();
  private disposed = false;
  private readonly linearTarget = new THREE.WebGLRenderTarget(1, 1);
  private readonly defaultDepth = new THREE.MeshDepthMaterial();
  private readonly added = (event: { child: THREE.Object3D }) => this.watch(event.child, true);
  private readonly removed = (event: { child: THREE.Object3D }) => {
    event.child.traverse(object => {
      this.watched.delete(object);
      object.removeEventListener("childadded", this.added);
      object.removeEventListener("childremoved", this.removed);
      this.queued.delete(object as THREE.Mesh);
      this.releaseWaiting(object as THREE.Mesh);
    });
  };

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {
    // Existing meshes were covered by startup warmup. Listen before background residency expands.
    this.watch(scene, false);
  }

  /** Interiors already attached at boot were hidden during startup compilation. Queue their
   * existing meshes before revealing them, as well as the meshes arriving through childadded. */
  enqueue(root: THREE.Object3D): void {
    root.traverse(object => {
      // Streaming may have finished some descendants while the destination loaded. Only
      // enroll the original hidden meshes; do not make already prepared scenery wait twice.
      if (!(object as THREE.Mesh).isMesh || this.enrolled.has(object as THREE.Mesh)) return;
      this.addWaiting(object as THREE.Mesh);
      this.queued.add(object as THREE.Mesh);
    });
  }

  private watch(root: THREE.Object3D, enqueue: boolean): void {
    root.traverse(object => {
      if (this.watched.has(object)) return;
      this.watched.add(object);
      object.addEventListener("childadded", this.added);
      object.addEventListener("childremoved", this.removed);
      if (enqueue && (object as THREE.Mesh).isMesh) {
        // Input rings share the texture-free RGBA material variant prepared at startup.
        // Recreating a ring must not queue it behind incoming scenery.
        for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) {
          if (ancestor.userData.prewarmedInputFeedback === true) return;
        }
        this.addWaiting(object as THREE.Mesh);
        this.queued.add(object as THREE.Mesh);
      }
    });
  }

  private addWaiting(mesh: THREE.Mesh): void {
    if (this.waiting.has(mesh)) return;
    this.enrolled.add(mesh);
    this.waiting.add(mesh);
    const ancestors: THREE.Object3D[] = [];
    for (let root: THREE.Object3D | null = mesh; root; root = root.parent) {
      ancestors.push(root);
      this.pendingRoots.set(root, (this.pendingRoots.get(root) ?? 0) + 1);
    }
    this.pendingAncestors.set(mesh, ancestors);
  }

  private releaseWaiting(mesh: THREE.Mesh): void {
    if (!this.waiting.delete(mesh)) return;
    // childremoved arrives after detachment. Retain the original ancestry so a moved
    // subtree cannot leave its old parent permanently waiting for graphics preparation.
    for (const root of this.pendingAncestors.get(mesh) ?? []) {
      const count = (this.pendingRoots.get(root) ?? 1) - 1;
      if (count) this.pendingRoots.set(root, count);
      else this.pendingRoots.delete(root);
    }
    this.pendingAncestors.delete(mesh);
  }

  /** Called after scene updates and before rendering. Restore visibility after every frame. */
  prepare(): void {
    if (this.disposed) return;
    if (this.pending) this.finishIfReady();
    if (!this.pending && this.queued.size) this.compileNext();
    for (const mesh of this.waiting) {
      // EntityViews retains the sampled actor until its detailed rig is ready. Other gameplay
      // objects and selection feedback without a replacement still remain drawable.
      if (!this.deferGameplayDraws && ((mesh.userData.entityId !== undefined && !mesh.userData.deferFirstDraw)
        || mesh.parent?.userData.keepVisibleDuringWarmup === true)) continue;
      if (!mesh.visible) continue;
      mesh.visible = false;
      this.hidden.push(mesh);
    }
  }

  restore(): void {
    for (const mesh of this.hidden) mesh.visible = true;
    this.hidden.length = 0;
  }

  private compileNext(): void {
    const meshes = [...this.queued].slice(0, 8);
    for (const mesh of meshes) this.queued.delete(mesh);
    // A compile-only view preserves each object's actual parent, geometry, batching and skinning.
    // compile() traverses this view; it never renders or updates its transforms.
    const view = new THREE.Group();
    view.traverse = callback => { callback(view); for (const mesh of meshes) callback(mesh); };
    this.pending = true;
    this.batch = meshes;
    try {
      this.compile(view, meshes);
      compileCorpseFadeVariants(this.renderer, this.scene, this.camera, meshes, source => this.compilationMaterial(source));
      const previous = this.renderer.getRenderTarget();
      const cubeFace = this.renderer.getActiveCubeFace(), mipLevel = this.renderer.getActiveMipmapLevel();
      try {
        this.renderer.setRenderTarget(this.linearTarget);
        this.compile(view, meshes);
        compileCorpseFadeVariants(this.renderer, this.scene, this.camera, meshes, source => this.compilationMaterial(source));
        compileShadowMeshes(this.renderer, this.scene, this.camera, meshes,
          source => this.compilationMaterial(source), this.defaultDepth);
      } finally { this.renderer.setRenderTarget(previous, cubeFace, mipLevel); }
      // compileAsync checks only each material's last program. Shared materials can produce
      // several mesh/side variants; wait for all submitted programs without blocking the driver.
      this.programs = (this.renderer.info.programs ?? []).filter(program => !this.readyPrograms.has(program));
    } catch (error) {
      // Do not make a failed compilation leave gameplay objects invisible forever.
      console.error("Streamed shader preparation failed", error);
      this.finish();
    }
  }

  private finishIfReady(): void {
    const gl = this.renderer.getContext();
    const extension = gl.getExtension("KHR_parallel_shader_compile");
    const started = performance.now();
    const current = new Set(this.renderer.info.programs ?? []);
    while (this.programs.length) {
      const program = this.programs[this.programs.length - 1]!;
      if (!program.program || !current.has(program)) { this.programs.pop(); continue; }
      if (extension && !gl.getProgramParameter(program.program as WebGLProgram, extension.COMPLETION_STATUS_KHR)) return;
      // Three defers shader diagnostics and uniform/attribute reflection until first use.
      // Spread that driver work across frames instead of paying for every variant in one draw.
      const checkErrors = this.renderer.debug.checkShaderErrors;
      // A successfully linked program needs no synchronous shader-log queries. Keep Three's
      // diagnostics for failures, and restore its policy for unrelated runtime programs.
      if (gl.getProgramParameter(program.program as WebGLProgram, gl.LINK_STATUS)) this.renderer.debug.checkShaderErrors = false;
      try { program.getUniforms(); program.getAttributes(); }
      finally { this.renderer.debug.checkShaderErrors = checkErrors; }
      this.readyPrograms.add(program);
      this.programs.pop();
      if (performance.now() - started >= 3) return;
    }
    // Linking a shader does not upload its textures. Prepare a bounded number before
    // revealing the batch, rather than uploading all maps and bone palettes on first draw.
    let uploaded = 0;
    for (const texture of this.textures) {
      this.renderer.initTexture(texture);
      if (!this.preparedTextures.has(texture)) {
        // A disposed texture may be reused with the same version and need another upload.
        const prepared = this.preparedTextures;
        const invalidate = () => { prepared.delete(texture); texture.removeEventListener('dispose', invalidate); };
        texture.addEventListener('dispose', invalidate);
      }
      this.preparedTextures.set(texture, texture.version);
      this.textures.delete(texture);
      uploaded++;
      if (uploaded >= 2 || performance.now() - started >= 3) return;
    }
    this.finish();
  }

  private collectTextures(value: unknown): void {
    if (value && typeof value === "object" && (value as THREE.Texture).isTexture) {
      const texture = value as THREE.Texture;
      // Shared maps occur in many small mesh batches. Already prepared versions must not
      // spend the upload budget again, or distant scenery waits seconds on no-op uploads.
      if (!texture.isRenderTargetTexture && this.preparedTextures.get(texture) !== texture.version) {
        this.textures.add(texture);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) this.collectTextures(item);
    }
  }

  private finish(): void {
    for (const mesh of this.batch) if (!this.queued.has(mesh)) this.releaseWaiting(mesh);
    this.batch = [];this.programs = [];this.pending = false;this.textures.clear();
    for (const material of this.retired) material.dispose();
    this.retired.clear();
  }

  private compile(view: THREE.Group, meshes: THREE.Mesh[]): void {
    const originals = meshes.map(mesh => mesh.material);
    try {
      for (const mesh of meshes) mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(material => this.compilationMaterial(material)) : this.compilationMaterial(mesh.material);
      this.renderer.compile(view, this.camera, this.scene);
    } finally {
      meshes.forEach((mesh, index) => { mesh.material = originals[index]!; });
    }
  }

  private compilationMaterial(source: THREE.Material): THREE.Material {
    for (const value of Object.values(source)) this.collectTextures(value);
    const uniforms = (source as THREE.ShaderMaterial).uniforms;
    if (uniforms) for (const uniform of Object.values(uniforms)) this.collectTextures(uniform.value);
    const cached = this.materials.get(source);
    if (cached?.version === source.version) return cached.clone;
    if (cached) { source.removeEventListener("dispose", cached.dispose); this.retire(cached.clone); }
    const clone = source.clone();
    // ShaderMaterial.clone duplicates texture-valued uniforms. Compilation must share
    // the source textures; uploading disposable clones would retain extra GPU references.
    if (uniforms) (clone as THREE.ShaderMaterial).uniforms = uniforms;
    clone.defines = { ...source.defines };
    clone.onBeforeCompile = (shader, renderer) => {
      source.onBeforeCompile(shader, renderer);
      for (const uniform of Object.values(shader.uniforms)) this.collectTextures(uniform.value);
    };
    clone.customProgramCacheKey = source.customProgramCacheKey.bind(source);
    const dispose = () => { this.retire(clone); this.materials.delete(source); source.removeEventListener("dispose", dispose); };
    source.addEventListener("dispose", dispose);
    this.materials.set(source, { clone, version: source.version, dispose });
    // Retaining the clone keeps the compiled program cached until an offscreen mesh first draws.
    return clone;
  }

  private retire(material: THREE.Material): void {
    if (this.pending) this.retired.add(material);
    else material.dispose();
  }

  getState() { return { waiting: this.waiting.size, queued: this.queued.size, compiling: this.pending, textures: this.textures.size }; }

  hasPending(root: THREE.Object3D): boolean {
    return this.pendingRoots.has(root);
  }

  dispose(): void {
    this.disposed = true;
    this.restore();
    for (const object of this.watched) {
      object.removeEventListener("childadded", this.added);
      object.removeEventListener("childremoved", this.removed);
    }
    this.watched.clear();this.queued.clear();this.waiting.clear();
    this.pendingRoots.clear();this.pendingAncestors.clear();
    this.finish();
    this.releaseMaterials();
  }

  private releaseMaterials(): void {
    for (const [source, entry] of this.materials) { source.removeEventListener("dispose", entry.dispose); entry.clone.dispose(); }
    this.materials.clear();
    this.linearTarget.dispose();
    this.defaultDepth.dispose();
  }
}
