import * as THREE from "three";
import { yieldToMainThread } from "../core/yield.js";
import type { WebGPURenderer } from "three/webgpu";
import { createGpuCompletion } from "./framePacer.js";
import type { GpuCompletion } from "./framePacer.js";
import { isSceneryInstances } from "./sceneryInstances.js";


type DeviceError = { message?: string };
type ValidationDevice = {
  pushErrorScope(filter: string): void;
  popErrorScope(): Promise<DeviceError | null>;
  createRenderPipelineAsync?: (descriptor: { label?: string }) => Promise<unknown>;
  createComputePipelineAsync?: (descriptor: { label?: string }) => Promise<unknown>;
};
type ValidationState = {
  errors: Error[];
  seen: WeakSet<object>;
  pending: Set<Promise<unknown>>;
  device?: ValidationDevice;
  restore: (() => void)[];
  report?: (error: Error) => void;
};
const validations = new WeakMap<WebGPURenderer, ValidationState>();

function validationError(state: ValidationState, value: unknown, label: string, report = true): void {
  if (value && typeof value === "object") {
    if (state.seen.has(value)) return;
    state.seen.add(value);
  }
  if (state.errors.length >= 32) return;
  const message = value && typeof value === "object" && "message" in value ? String(value.message) : String(value);
  const error = new Error(`${label}: ${message}`, { cause: value });
  state.errors.push(error);
  if (report && state.errors.length === 1) state.report?.(error);
}

function observe<T>(state: ValidationState, promise: Promise<T>): Promise<T> {
  state.pending.add(promise);
  void promise.then(() => state.pending.delete(promise), () => state.pending.delete(promise));
  return promise;
}

/** Three deliberately resolves compileAsync after logging failed native pipelines. Observe the
 * device results as well as its uncaptured-error callback so readiness cannot certify them. */
export function installGraphicsValidation(renderer: WebGPURenderer): void {
  if (validations.has(renderer)) return;
  const backend = (renderer.backend ?? {}) as unknown as { isWebGPUBackend?: boolean; device?: ValidationDevice };
  const state: ValidationState = { errors: [], seen: new WeakSet(), pending: new Set(), restore: [] };
  validations.set(renderer, state);
  const previousError = renderer.onError;
  state.report = error => previousError?.call(renderer,
    { api: "WebGPU", type: "PreparationError", message: error.message } as unknown as string);
  renderer.onError = info => {
    validationError(state, info, "Graphics device error", false);
    previousError?.call(renderer, info);
  };
  state.restore.push(() => { renderer.onError = previousError; });
  if (!backend.isWebGPUBackend || !backend.device?.popErrorScope) return;
  const device = state.device = backend.device;
  const popErrorScope = device.popErrorScope;
  device.popErrorScope = () => observe(state, popErrorScope.call(device).then(error => {
    if (error) validationError(state, error, "Graphics validation failed");
    return error;
  }, error => {
    validationError(state, error, "Graphics validation scope failed");
    throw error;
  }));
  state.restore.push(() => { device.popErrorScope = popErrorScope; });
  for (const name of ["createRenderPipelineAsync", "createComputePipelineAsync"] as const) {
    const original = device[name];
    if (!original) continue;
    device[name] = descriptor => {
      const label = `Graphics pipeline ${descriptor.label ?? name}`;
      try {
        return observe(state, original.call(device, descriptor).catch(error => {
          validationError(state, error, label);
          throw error;
        }));
      } catch (error) {
        validationError(state, error, label);
        throw error;
      }
    };
    state.restore.push(() => { device[name] = original; });
  }
}

export function graphicsValidationState(renderer: WebGPURenderer): { failed: number; pending: number; error: string | null } {
  const state = validations.get(renderer);
  return { failed: state?.errors.length ?? 0, pending: state?.pending.size ?? 0, error: state?.errors[0]?.message ?? null };
}

export function assertGraphicsValid(renderer: WebGPURenderer): void {
  const error = validations.get(renderer)?.errors[0];
  if (error) throw error;
}

/** Only wait for work already submitted. Frames submitted later never extend this barrier. */
export async function waitForGraphicsValidation(renderer: WebGPURenderer): Promise<void> {
  const state = validations.get(renderer);
  if (state) await Promise.allSettled([...state.pending]);
  assertGraphicsValid(renderer);
}

function beginValidation(renderer: WebGPURenderer): { state: ValidationState; close(): Promise<void> } {
  installGraphicsValidation(renderer);
  const state = validations.get(renderer)!;
  assertGraphicsValid(renderer);
  const device = state.device;
  // Scopes nest with Three's own pipeline scopes. Synchronous frame scopes are popped in
  // the same turn; serialized preparation scopes may span await without leaving frame scopes open.
  if (device) for (const filter of ["internal", "out-of-memory", "validation"]) device.pushErrorScope(filter);
  return { state, close: async () => {
    if (device) await Promise.all([device.popErrorScope(), device.popErrorScope(), device.popErrorScope()]);
  } };
}

export async function validateGraphicsWork<T>(renderer: WebGPURenderer, label: string, work: () => T | Promise<T>): Promise<T> {
  const scope = beginValidation(renderer);
  let result!: T;
  let failure: unknown;
  try { result = await work(); }
  catch (error) { failure = error; validationError(scope.state, error, label); }
  try { await scope.close(); }
  catch (error) { failure ??= error; validationError(scope.state, error, label); }
  await waitForGraphicsValidation(renderer);
  if (failure !== undefined) throw failure;
  return result;
}

/** Submit a frame with asynchronous error reporting, without awaiting or reading a GPU query. */
export function validateGraphicsSubmission<T>(renderer: WebGPURenderer, label: string, work: () => T): T {
  const scope = beginValidation(renderer);
  try { return work(); }
  catch (error) { validationError(scope.state, error, label); throw error; }
  finally { void scope.close().catch(error => validationError(scope.state, error, label)); }
}

export function disposeGraphicsValidation(renderer: WebGPURenderer): void {
  const state = validations.get(renderer);
  if (!state) return;
  for (const restore of state.restore.reverse()) restore();
  validations.delete(renderer);
}

/** Repeated tiles share geometry and materials, and therefore the same compiler inputs. */
export function shaderGeometryKey(mesh: THREE.Mesh): string {
  if (isSceneryInstances(mesh)) {
    return `scenery:${mesh.sourceGeometry.uuid}:${mesh.receiveShadow}:${Boolean(mesh.instanceColors)}`;
  }
  const instanced = mesh as THREE.InstancedMesh;
  return `${mesh.type}:${mesh.geometry.uuid}:${mesh.receiveShadow}:${Boolean(instanced.instanceColor)}:${Boolean(instanced.morphTexture)}`;
}

export interface ShaderPreparationOptions {
  batchSize?: number;
  renderTarget?: THREE.RenderTarget | null;
  isCancelled?: () => boolean;
  onPendingTextures?: (count: number) => void;
}
type Drawable = THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
type TextureNode = { isNode: true; value?: unknown; getChildren?: () => Iterable<TextureNode> };
type PreparationProgress = { pendingMeshes: number; pendingTextures: number };
type PreparationState = {
  jobs: Set<PreparationProgress>;
  textures: WeakMap<THREE.Texture, number>;
  watchedTextures: WeakSet<THREE.Texture>;
  fadeMaterials: WeakMap<THREE.Material, { version: number; material: THREE.Material; release: () => void }>;
  tail: Promise<void>;
  completion?: GpuCompletion;
};
const states = new WeakMap<WebGPURenderer, PreparationState>();

function stateFor(renderer: WebGPURenderer): PreparationState {
  let state = states.get(renderer);
  if (!state) {
    state = { jobs: new Set(), textures: new WeakMap(), watchedTextures: new WeakSet(), fadeMaterials: new WeakMap(), tail: Promise.resolve() };
    states.set(renderer, state);
  }
  return state;
}

/** Includes queued startup, effect, and streamed work, before its first asynchronous yield. */
export function shaderPreparationState(renderer: WebGPURenderer): PreparationProgress & { compiling: boolean } {
  const jobs = states.get(renderer)?.jobs;
  let pendingMeshes = 0, pendingTextures = 0;
  for (const job of jobs ?? []) {
    pendingMeshes += job.pendingMeshes;
    pendingTextures += job.pendingTextures;
  }
  return { pendingMeshes, pendingTextures, compiling: Boolean(jobs?.size) };
}

function collectTextures(objects: readonly THREE.Object3D[], scene: THREE.Scene): THREE.Texture[] {
  const textures = new Set<THREE.Texture>(), visited = new Set<object>();
  const collect = (value: unknown): void => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if ((value as THREE.Texture).isTexture) {
      const texture = value as THREE.Texture;
      if (!texture.isRenderTargetTexture) textures.add(texture);
    } else if (Array.isArray(value)) {
      for (const item of value) collect(item);
    } else if ((value as TextureNode).isNode) {
      // TSL nodes retain source textures. Never walk scene/geometry objects or pixel arrays.
      const node = value as TextureNode;
      collect(node.value);
      for (const child of node.getChildren?.() ?? []) collect(child);
    }
  };
  collect(scene.environment); collect(scene.background);
  for (const object of objects) {
    const drawable = object as Drawable;
    const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
    for (const material of materials) {
      if (material) for (const value of Object.values(material)) collect(value);
    }
    const mesh = object as THREE.SkinnedMesh & THREE.InstancedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) {
      if (!mesh.skeleton.boneTexture) mesh.skeleton.computeBoneTexture();
      collect(mesh.skeleton.boneTexture);
    }
    if (mesh.isInstancedMesh) collect(mesh.morphTexture);
  }
  return [...textures];
}

function corpseMaterial(source: THREE.Material, state: PreparationState): THREE.Material {
  const retained = state.fadeMaterials.get(source);
  if (retained?.version === source.version) return retained.material;
  retained?.release();
  const material = source.clone();
  material.transparent = true;
  material.depthWrite = false;
  const release = () => {
    source.removeEventListener("dispose", release);
    material.dispose();
    state.fadeMaterials.delete(source);
  };
  source.addEventListener("dispose", release);
  state.fadeMaterials.set(source, { version: source.version, material, release });
  return material;
}

/** A multi-batch warmup must not walk the full world again for every light lookup.
 * Track topology while yielding; visibility and attachment are checked live per light. */
class PreparationLights {
  private readonly watched = new Set<THREE.Object3D>();
  private readonly lights = new Set<THREE.Object3D>();
  private readonly added = (event: { child: THREE.Object3D }) => this.watch(event.child);
  private readonly removed = (event: { child: THREE.Object3D }) => event.child.traverse(object => this.unwatch(object));

  constructor(private readonly scene: THREE.Scene) { this.watch(scene); }

  private watch(root: THREE.Object3D): void {
    root.traverse(object => {
      if (this.watched.has(object)) return;
      this.watched.add(object);
      if ((object as THREE.Light).isLight) this.lights.add(object);
      object.addEventListener("childadded", this.added);
      object.addEventListener("childremoved", this.removed);
    });
  }

  private unwatch(object: THREE.Object3D): void {
    this.watched.delete(object); this.lights.delete(object);
    object.removeEventListener("childadded", this.added);
    object.removeEventListener("childremoved", this.removed);
  }

  visitVisible(callback: (object: THREE.Object3D) => void): void {
    for (const light of this.lights) {
      for (let ancestor: THREE.Object3D | null = light; ancestor; ancestor = ancestor.parent) {
        if (!ancestor.visible) break;
        if (ancestor === this.scene) { callback(light); break; }
      }
    }
  }

  dispose(): void { for (const object of this.watched) this.unwatch(object); }
}

/** Three collects render items before its first pipeline-building await. Keep the actual
 * scene cache, mesh identity, skinning and parent transforms, then restore all live state
 * before it yields. WebGPU walks children directly, so traverse overrides do not work. */
function compileBatch(
  renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera,
  objects: readonly THREE.Object3D[], state: PreparationState, fading: boolean,
  renderTarget: THREE.RenderTarget | null | undefined, lights?: PreparationLights,
): Promise<void> {
  const view = new THREE.Group();
  view.matrixWorldAutoUpdate = false;
  view.children = [...objects];
  const originals = objects.map(object => ({
    object, visible: object.visible, culled: object.frustumCulled,
    children: object.children, mask: object.layers.mask, material: (object as Drawable).material,
  }));
  const target = renderTarget === undefined ? undefined : renderer.getRenderTarget();
  const cubeFace = renderTarget === undefined ? 0 : renderer.getActiveCubeFace();
  const mipLevel = renderTarget === undefined ? 0 : renderer.getActiveMipmapLevel();
  const beforeRender = scene.onBeforeRender, traverseVisible = scene.traverseVisible;
  try {
    if (lights) scene.onBeforeRender = function (...args) {
      // Authored hooks may traverse or alter the world; run them before intercepting
      // the renderer's immediately following, light-only targetScene traversal.
      beforeRender.apply(this, args);
      scene.traverseVisible = callback => {
        scene.traverseVisible = traverseVisible;
        lights.visitVisible(callback);
      };
    };
    if (renderTarget !== undefined) renderer.setRenderTarget(renderTarget);
    for (const original of originals) {
      const object = original.object as Drawable;
      object.updateWorldMatrix(true, false);
      object.visible = true;
      object.frustumCulled = false;
      object.layers.mask = camera.layers.mask;
      object.children = [];
      if (fading && original.material) object.material = Array.isArray(original.material)
        ? original.material.map(source => corpseMaterial(source, state)) : corpseMaterial(original.material, state);
    }
    return renderer.compileAsync(view, camera, scene);
  } finally {
    scene.onBeforeRender = beforeRender; scene.traverseVisible = traverseVisible;
    if (target !== undefined) renderer.setRenderTarget(target, cubeFace, mipLevel);
    for (const original of originals) {
      const object = original.object as Drawable;
      object.visible = original.visible;
      object.frustumCulled = original.culled;
      object.layers.mask = original.mask;
      object.children = original.children;
      if (original.material) object.material = original.material;
    }
  }
}

/** One upload at a time with an asynchronous GPU fence, never a synchronous query. */
async function finishUploads(completion: GpuCompletion): Promise<void> {
  await completion();
  await yieldToMainThread();
}

async function prepare(
  renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera,
  objects: readonly THREE.Object3D[], options: ShaderPreparationOptions, state: PreparationState,
  progress: PreparationProgress,
): Promise<void> {
  // compileBatch relies on collection running synchronously until pipeline building starts.
  await renderer.init();
  const completion = state.completion ??= createGpuCompletion(renderer);
  const cancelled = options.isCancelled ?? (() => false);
  const batchSize = Math.max(1, Math.min(4, Math.floor(options.batchSize ?? 1)));
  const lights = objects.length >= 16 && objects.length > batchSize ? new PreparationLights(scene) : undefined;
  try {
    for (let offset = 0; offset < objects.length && !cancelled(); offset += batchSize) {
      const batch = objects.slice(offset, offset + batchSize);
      const textures = collectTextures(batch, scene).filter(texture => state.textures.get(texture) !== texture.version);
      progress.pendingTextures = textures.length;
      options.onPendingTextures?.(progress.pendingTextures);
      for (let index = 0; index < textures.length; index++) {
        if (cancelled()) return;
        const texture = textures[index]!;
        await validateGraphicsWork(renderer, `Texture ${texture.name || texture.uuid}`, async () => {
          renderer.initTexture(texture);
          await finishUploads(completion);
        });
        if (!state.watchedTextures.has(texture)) {
          texture.addEventListener("dispose", () => state.textures.delete(texture));
          state.watchedTextures.add(texture);
        }
        state.textures.set(texture, texture.version);
        progress.pendingTextures = textures.length - index - 1;
        options.onPendingTextures?.(progress.pendingTextures);
      }
      if (cancelled()) return;
      await yieldToMainThread();
      await validateGraphicsWork(renderer, "Resident graphics pipelines", () =>
        compileBatch(renderer, scene, camera, batch, state, false, options.renderTarget, lights));
      if (cancelled()) return;
      const fading = batch.filter(object => object.userData.prepareCorpseFade === true);
      if (fading.length) await validateGraphicsWork(renderer, "Creature fade pipelines", () =>
        compileBatch(renderer, scene, camera, fading, state, true, options.renderTarget, lights));
      await finishUploads(completion);
      progress.pendingMeshes -= batch.length;
    }
  } finally { lights?.dispose(); options.onPendingTextures?.(0); }
}

/** Native asynchronous pipeline creation shared by startup and streamed content. Calls
 * serialize per renderer so background and destination loads cannot flood its GPU queue. */
export function prepareShaderMeshes(
  renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera,
  objects: readonly THREE.Object3D[], options: ShaderPreparationOptions = {},
): Promise<void> {
  const state = stateFor(renderer);
  const progress: PreparationProgress = { pendingMeshes: objects.length, pendingTextures: 0 };
  state.jobs.add(progress);
  const result = state.tail.then(() => prepare(renderer, scene, camera, objects, options, state, progress))
    .finally(() => { state.jobs.delete(progress); });
  state.tail = result.catch(() => {});
  return result;
}
