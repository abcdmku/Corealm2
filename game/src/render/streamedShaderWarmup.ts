import * as THREE from "three";
import { compileShadowMeshes } from "./shaderPreparation.js";

/** Prepare newly resident meshes before their first draw can synchronously wait on the driver. */
export class StreamedShaderWarmup {
  private readonly waiting = new Set<THREE.Mesh>();
  private readonly queued = new Set<THREE.Mesh>();
  private readonly watched = new Set<THREE.Object3D>();
  private readonly hidden: THREE.Mesh[] = [];
  private readonly materials = new Map<THREE.Material, { clone: THREE.Material; version: number; dispose: () => void }>();
  private readonly retired = new Set<THREE.Material>();
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
      this.waiting.delete(object as THREE.Mesh);
    });
  };

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {
    // Existing meshes were covered by startup warmup. Listen before background residency expands.
    this.watch(scene, false);
  }

  private watch(root: THREE.Object3D, enqueue: boolean): void {
    root.traverse(object => {
      if (this.watched.has(object)) return;
      this.watched.add(object);
      object.addEventListener("childadded", this.added);
      object.addEventListener("childremoved", this.removed);
      if (enqueue && (object as THREE.Mesh).isMesh) {
        this.waiting.add(object as THREE.Mesh);
        this.queued.add(object as THREE.Mesh);
      }
    });
  }

  /** Called after scene updates and before rendering. Restore visibility after every frame. */
  prepare(): void {
    if (this.disposed) return;
    if (this.pending) this.finishIfReady();
    if (!this.pending && this.queued.size) this.compileNext();
    for (const mesh of this.waiting) {
      // A nearby unique actor replaces its distant instance in the same update. It must remain
      // drawable throughout preparation, or that handoff leaves the creature completely absent.
      if (mesh.userData.entityId !== undefined) continue;
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
    const meshes = [...this.queued].slice(0, 64);
    for (const mesh of meshes) this.queued.delete(mesh);
    // A compile-only view preserves each object's actual parent, geometry, batching and skinning.
    // compile() traverses this view; it never renders or updates its transforms.
    const view = new THREE.Group();
    view.traverse = callback => { callback(view); for (const mesh of meshes) callback(mesh); };
    this.pending = true;
    this.batch = meshes;
    try {
      this.compile(view, meshes);
      const previous = this.renderer.getRenderTarget();
      try {
        this.renderer.setRenderTarget(this.linearTarget);
        this.compile(view, meshes);
        compileShadowMeshes(this.renderer, this.scene, this.camera, meshes,
          source => this.compilationMaterial(source), this.defaultDepth);
      } finally { this.renderer.setRenderTarget(previous); }
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
      program.getUniforms();program.getAttributes();
      this.readyPrograms.add(program);
      this.programs.pop();
      if (performance.now() - started >= 3) return;
    }
    this.finish();
  }

  private finish(): void {
    for (const mesh of this.batch) if (!this.queued.has(mesh)) this.waiting.delete(mesh);
    this.batch = [];this.programs = [];this.pending = false;
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
    const cached = this.materials.get(source);
    if (cached?.version === source.version) return cached.clone;
    if (cached) { source.removeEventListener("dispose", cached.dispose); this.retire(cached.clone); }
    const clone = source.clone();
    clone.defines = { ...source.defines };
    clone.onBeforeCompile = source.onBeforeCompile.bind(source);
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

  getState() { return { waiting: this.waiting.size, queued: this.queued.size, compiling: this.pending }; }

  hasPending(root: THREE.Object3D): boolean {
    for (const mesh of this.waiting) {
      for (let object: THREE.Object3D | null = mesh; object; object = object.parent) {
        if (object === root) return true;
      }
    }
    return false;
  }

  dispose(): void {
    this.disposed = true;
    this.restore();
    for (const object of this.watched) {
      object.removeEventListener("childadded", this.added);
      object.removeEventListener("childremoved", this.removed);
    }
    this.watched.clear();this.queued.clear();this.waiting.clear();
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
