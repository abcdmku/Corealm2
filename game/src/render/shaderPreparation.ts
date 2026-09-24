import * as THREE from "three";
import { yieldToMainThread } from "../core/yield.js";
import type { WebGPURenderer } from "three/webgpu";
import { createGpuCompletion } from "./framePacer.js";
import type { GpuCompletion } from "./framePacer.js";
import { isSceneryInstances } from "./sceneryInstances.js";
import { withPipelineConcurrency } from "./nativePipelinePreparation.js";


type DeviceError = { message?: string };
type ValidationDevice = {
  pushErrorScope(filter: string): void;
  popErrorScope(): Promise<DeviceError | null>;
  createRenderPipelineAsync?: (descriptor: { label?: string }) => Promise<unknown>;
  createComputePipelineAsync?: (descriptor: { label?: string }) => Promise<unknown>;
};
/** Failures raised by one preparation job: its thrown work, its error scopes and the native
 * pipelines it submitted. They fail that job's objects, never the device or a later job. */
type JobFailures = { errors: Error[]; materials: Set<number> };
type ValidationState = {
  /** Device and frame failures. Any one stops gameplay frames and every later preparation. */
  errors: Error[];
  seen: WeakSet<object>;
  pending: Set<Promise<unknown>>;
  device?: ValidationDevice;
  restore: (() => void)[];
  report?: (error: Error) => void;
  /** The running preparation job. Jobs are serialized per renderer. */
  job: JobFailures | null;
  /** Nonzero while a gameplay frame submits: its device calls never belong to the job. */
  frames: number;
};
const validations = new WeakMap<WebGPURenderer, ValidationState>();

/** Where a device call made now reports: decided when the call is made, not when it settles. */
const owner = (state: ValidationState): JobFailures | null => state.frames ? null : state.job;

function validationError(state: ValidationState, value: unknown, label: string, report = true,
  job: JobFailures | null = owner(state)): void {
  if (value && typeof value === "object") {
    if (state.seen.has(value)) return;
    state.seen.add(value);
  }
  const message = value && typeof value === "object" && "message" in value ? String(value.message) : String(value);
  const error = new Error(`${label}: ${message}`, { cause: value });
  state.seen.add(error);
  if (job) { job.errors.push(error); return; }
  if (state.errors.length >= 32) return;
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
  const state: ValidationState = { errors: [], seen: new WeakSet(), pending: new Set(), restore: [], job: null, frames: 0 };
  validations.set(renderer, state);
  const previousError = renderer.onError;
  state.report = error => previousError?.call(renderer,
    { api: "WebGPU", type: "PreparationError", message: error.message } as unknown as string);
  renderer.onError = info => {
    validationError(state, info, "Graphics device error", false, null);
    previousError?.call(renderer, info);
  };
  state.restore.push(() => { renderer.onError = previousError; });
  if (!backend.isWebGPUBackend || !backend.device?.popErrorScope) return;
  const device = state.device = backend.device;
  const popErrorScope = device.popErrorScope;
  device.popErrorScope = () => {
    const job = owner(state);
    return observe(state, popErrorScope.call(device).then(error => {
      if (error) validationError(state, error, "Graphics validation failed", true, job);
      return error;
    }, error => {
      validationError(state, error, "Graphics validation scope failed", true, job);
      throw error;
    }));
  };
  state.restore.push(() => { device.popErrorScope = popErrorScope; });
  for (const name of ["createRenderPipelineAsync", "createComputePipelineAsync"] as const) {
    const original = device[name];
    if (!original) continue;
    device[name] = descriptor => {
      const label = `Graphics pipeline ${descriptor.label ?? name}`;
      const job = owner(state);
      // Three labels a render pipeline `renderPipeline_<material name>_<material id>`, and
      // resets its reused descriptor as soon as this call returns.
      const material = /_(\d+)$/.exec(descriptor.label ?? "")?.[1];
      const fail = (error: unknown) => {
        validationError(state, error, label, true, job);
        if (job && material) job.materials.add(Number(material));
      };
      try {
        return observe(state, original.call(device, descriptor).catch(error => { fail(error); throw error; }));
      } catch (error) { fail(error); throw error; }
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

/** Device work outside any preparation job, such as initialization: its failures are the device's. */
export async function validateGraphicsWork<T>(renderer: WebGPURenderer, label: string, work: () => T | Promise<T>): Promise<T> {
  return validateWork(renderer, label, work, true, null);
}

async function validateWork<T>(renderer: WebGPURenderer, label: string, work: () => T | Promise<T>,
  drainPipelines: boolean, job: JobFailures | null): Promise<T> {
  const scope = beginValidation(renderer);
  const before = job?.errors.length ?? 0;
  let result!: T;
  let failure: unknown;
  try { result = await work(); }
  catch (error) { failure = error; validationError(scope.state, error, label, true, job); }
  try { await scope.close(); }
  catch (error) { failure ??= error; validationError(scope.state, error, label, true, job); }
  if (drainPipelines) await waitForGraphicsValidation(renderer);
  else assertGraphicsValid(renderer);
  if (failure !== undefined) throw failure;
  if (job && job.errors.length > before) throw job.errors[before];
  return result;
}

/** Submit a frame with asynchronous error reporting, without awaiting or reading a GPU query. */
export function validateGraphicsSubmission<T>(renderer: WebGPURenderer, label: string, work: () => T): T {
  const scope = beginValidation(renderer);
  scope.state.frames++;
  try { return work(); }
  catch (error) { validationError(scope.state, error, label, true, null); throw error; }
  finally {
    // The scope pops are issued synchronously here, so they report as the frame's own.
    const closing = scope.close();
    scope.state.frames--;
    void closing.catch(error => validationError(scope.state, error, label, true, null));
  }
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

/** Covered preparation (startup, destinations, effects) keeps this many native pipelines compiling. */
export const COVERED_PIPELINE_CONCURRENCY = 8;

/** A preparation job failed. `failed` holds the objects whose own pipeline the device rejected;
 * any other object of the job may be innocent, since one batch shares scopes and fences. */
export class ShaderPreparationError extends Error {
  constructor(error: Error, readonly failed: readonly THREE.Object3D[]) {
    super(error.message, { cause: error });
    this.name = "ShaderPreparationError";
  }
}

export interface ShaderPreparationOptions {
  batchSize?: number;
  /** Startup overlaps several asynchronous pipeline waits while node building stays serial. */
  pipelineConcurrency?: number;
  renderTarget?: THREE.RenderTarget | null;
  isCancelled?: () => boolean;
  onPendingTextures?: (count: number) => void;
  /** Runs only after the batch's pipelines, uploads and GPU completion have succeeded. */
  onPreparedBatch?: (objects: readonly THREE.Object3D[]) => void;
}
type Drawable = THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
type TextureNode = { isNode: true; value?: unknown; getChildren?: () => Iterable<TextureNode> };
type PreparationProgress = {
  pendingMeshes: number; pendingTextures: number;
  totalMeshes: number; submittedMeshes: number;
  startedAt: number; stageStartedAt: number; stage: string;
  batch: readonly THREE.Object3D[];
};
type AttributeBuffer = THREE.BufferAttribute | THREE.InterleavedBuffer;
type PreparedBuffer = { version: number; array: THREE.TypedArray };
const MAX_PREPARATION_BUFFER_BYTES = 256 * 1024;
type PreparationState = {
  jobs: Set<PreparationProgress>;
  textures: WeakMap<THREE.Texture, number>;
  watchedTextures: WeakSet<THREE.Texture>;
  buffers: WeakMap<AttributeBuffer, PreparedBuffer>;
  watchedGeometries: WeakSet<THREE.BufferGeometry>;
  sceneryLayouts: WeakMap<THREE.Material, { version: number; keys: Set<string> }>;
  fadeMaterials: WeakMap<THREE.Material, { version: number; material: THREE.Material; release: () => void }>;
  tail: Promise<void>;
  completion?: GpuCompletion;
};
const states = new WeakMap<WebGPURenderer, PreparationState>();

function stateFor(renderer: WebGPURenderer): PreparationState {
  let state = states.get(renderer);
  if (!state) {
    state = { jobs: new Set(), textures: new WeakMap(), watchedTextures: new WeakSet(), buffers: new WeakMap(),
      watchedGeometries: new WeakSet(), sceneryLayouts: new WeakMap(), fadeMaterials: new WeakMap(), tail: Promise.resolve() };
    states.set(renderer, state);
  }
  return state;
}

function geometryAttributeBuffers(geometry: THREE.BufferGeometry | undefined): Set<AttributeBuffer> {
  const buffers = new Set<AttributeBuffer>();
  const add = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null | undefined) => {
    if (attribute) buffers.add((attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
      ? (attribute as THREE.InterleavedBufferAttribute).data : attribute as THREE.BufferAttribute);
  };
  if (geometry) {
    for (const attribute of Object.values(geometry.attributes)) add(attribute);
    add(geometry.index);
    for (const attributes of Object.values(geometry.morphAttributes)) for (const attribute of attributes ?? []) add(attribute);
  }
  return buffers;
}

function geometryBuffers(object: THREE.Object3D): Set<AttributeBuffer> {
  const mesh = object as THREE.Mesh & THREE.InstancedMesh;
  const buffers = geometryAttributeBuffers(mesh.geometry);
  if (mesh.isInstancedMesh) {
    buffers.add(mesh.instanceMatrix);
    if (mesh.instanceColor) buffers.add(mesh.instanceColor);
  }
  return buffers;
}

function bufferUploadBytes(buffer: AttributeBuffer): number {
  // WebGPU widens unnormalized small integer arrays to 32 bits and can pad storage vec3s.
  // Counting every small integer as widened is conservative for normalized imported attributes.
  const attribute = buffer as THREE.BufferAttribute & { isStorageBufferAttribute?: boolean; isStorageInstancedBufferAttribute?: boolean };
  const stride = (buffer as THREE.InterleavedBuffer).isInterleavedBuffer
    ? (buffer as THREE.InterleavedBuffer).stride : attribute.itemSize;
  const components = stride === 3 && (attribute.isStorageBufferAttribute || attribute.isStorageInstancedBufferAttribute) ? 4 : stride;
  return buffer.count * Math.ceil(components * Math.max(4, buffer.array.BYTES_PER_ELEMENT) / 4) * 4;
}

function preparedScenery(object: THREE.Object3D, state: PreparationState): boolean {
  if (!isSceneryInstances(object) || object.userData.prepareCorpseFade === true) return false;
  const key = shaderGeometryKey(object);
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.length > 0 && materials.every(material => {
    const prepared = state.sceneryLayouts.get(material);
    return prepared?.version === material.version && prepared.keys.has(key);
  });
}

function nextPreparationBatch(objects: readonly THREE.Object3D[], offset: number, batchSize: number,
  state: PreparationState, pipelineConcurrency: number): THREE.Object3D[] {
  const first = objects[offset]!;
  const scenery = isSceneryInstances(first);
  const firstPrepared = scenery && preparedScenery(first, state);
  // Startup's native loop builds nodes serially, so later items reuse the completed
  // builder even while its GPU pipeline is pending. On fallback, group fresh
  // layouts up to the caller's batch size; every object still compiles and the
  // byte cap plus GPU fence remain per batch. Interactive default stays one.
  let limit = scenery ? firstPrepared ? 8 : pipelineConcurrency > 1 ? 4 : batchSize : batchSize;
  const batch: THREE.Object3D[] = [], selectedBuffers = new Set<AttributeBuffer>();
  let bytes = 0;
  for (let index = offset; index < objects.length && batch.length < limit; index++) {
    const object = objects[index]!;
    if (index > offset && (scenery
      ? !isSceneryInstances(object) || (pipelineConcurrency === 1 && firstPrepared && !preparedScenery(object, state))
      : isSceneryInstances(object))) break;
    if (scenery && pipelineConcurrency > 1 && !preparedScenery(object, state)) {
      limit = Math.min(limit, 4);
      if (batch.length >= limit) break;
    }
    const buffers = geometryBuffers(object);
    let additional = 0;
    for (const buffer of buffers) {
      const prepared = state.buffers.get(buffer);
      if (!selectedBuffers.has(buffer) && (prepared?.version !== buffer.version || prepared.array !== buffer.array
        || buffer.usage === THREE.DynamicDrawUsage)) additional += bufferUploadBytes(buffer);
    }
    // An indivisible oversized object still loads, with the whole submission to itself.
    if (batch.length && bytes + additional > MAX_PREPARATION_BUFFER_BYTES) break;
    batch.push(object); bytes += additional;
    for (const buffer of buffers) selectedBuffers.add(buffer);
  }
  return batch;
}

function rememberPreparedBuffers(objects: readonly THREE.Object3D[], buffers: Map<AttributeBuffer, PreparedBuffer>, state: PreparationState): void {
  for (const [buffer, prepared] of buffers) state.buffers.set(buffer, prepared);
  for (const object of objects) {
    const mesh = object as THREE.Mesh;
    const geometries = isSceneryInstances(object) ? [object.geometry, object.sourceGeometry] : [mesh.geometry];
    for (const geometry of geometries) if (geometry && !state.watchedGeometries.has(geometry)) {
      state.watchedGeometries.add(geometry);
      const originalBuffers = geometryAttributeBuffers(geometry);
      geometry.addEventListener('dispose', () => {
        // Disposing one scenery wrapper may retain shared buffers. Invalidating those too
        // is conservative: a later preparation counts their bytes again instead of guessing.
        for (const buffer of originalBuffers) state.buffers.delete(buffer);
        for (const buffer of geometryAttributeBuffers(geometry)) state.buffers.delete(buffer);
      });
    }
    if (!isSceneryInstances(object)) continue;
    const key = shaderGeometryKey(object);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let prepared = state.sceneryLayouts.get(material);
      if (prepared?.version !== material.version) {
        prepared = { version: material.version, keys: new Set() };
        state.sceneryLayouts.set(material, prepared);
      }
      prepared.keys.add(key);
    }
  }
}

/** A scenery cluster whose shared layout already compiled needs only its own buffers, which its
 * first draw uploads. Covered loads draw such clusters directly instead of queueing each one. */
export function isPreparedScenery(renderer: WebGPURenderer, object: THREE.Object3D): boolean {
  const state = states.get(renderer);
  return Boolean(state) && preparedScenery(object, state!);
}

/** Includes queued startup, effect, and streamed work, before its first asynchronous yield. */
export function shaderPreparationState(renderer: WebGPURenderer) {
  const jobs = states.get(renderer)?.jobs;
  let pendingMeshes = 0, pendingTextures = 0;
  for (const job of jobs ?? []) {
    pendingMeshes += job.pendingMeshes;
    pendingTextures += job.pendingTextures;
  }
  const now = performance.now();
  return {
    pendingMeshes, pendingTextures, compiling: Boolean(jobs?.size),
    jobs: Array.from(jobs ?? []).slice(0, 4).map(job => ({
      stage: job.stage,
      elapsedMs: Math.round(now - job.startedAt),
      stageElapsedMs: Math.round(now - job.stageStartedAt),
      totalMeshes: job.totalMeshes,
      submittedMeshes: job.submittedMeshes,
      pendingMeshes: job.pendingMeshes,
      pendingTextures: job.pendingTextures,
      batch: job.batch.slice(0, 8).map(object => {
        const drawable = object as Drawable;
        const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
        return { object: object.name || object.type, objectId: object.uuid.slice(0, 8),
          materials: materials.filter((material): material is THREE.Material => Boolean(material))
            .slice(0, 4).map(material => material.name || material.type) };
      }),
    })),
  };
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
    // Node skinning reads skeleton.boneMatrices as a buffer sized when a mesh is first drawn.
    // Never build a WebGL bone texture: it pads that shared array and overflows existing draws.
    const mesh = object as THREE.InstancedMesh;
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

const nextFrame = (): Promise<void> => new Promise(resolve => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
});

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
  const stage = (name: string, batch: readonly THREE.Object3D[] = progress.batch) => {
    progress.stage = name;
    progress.stageStartedAt = performance.now();
    progress.batch = batch;
  };
  // compileBatch relies on collection running synchronously until pipeline building starts.
  stage('renderer-init');
  await renderer.init();
  installGraphicsValidation(renderer);
  const validation = validations.get(renderer)!;
  const failures: JobFailures = { errors: [], materials: new Set() };
  const completion = state.completion ??= createGpuCompletion(renderer);
  const cancelled = options.isCancelled ?? (() => false);
  const batchSize = Math.max(1, Math.min(4, Math.floor(options.batchSize ?? 1)));
  const backend = renderer.backend as unknown as { isWebGLBackend?: boolean; parallel?: unknown };
  const pipelineConcurrency = backend.isWebGLBackend && !backend.parallel ? 1 : options.pipelineConcurrency ?? 1;
  const lights = objects.length >= 16 && objects.length > batchSize ? new PreparationLights(scene) : undefined;
  const completedBatches: THREE.Object3D[][] = [];
  // Covered work (startup, destinations) is ready only as a whole, so one GPU fence at the end
  // replaces a round trip per batch. Interactive streaming keeps per-batch fences to pace uploads.
  const covered = pipelineConcurrency > 1;
  // Covered work also shares one error scope: three asynchronous scope pops per small batch
  // were another GPU round trip each.
  const scoped = <T>(label: string, work: () => T | Promise<T>): Promise<T> =>
    covered ? Promise.resolve(work()) : validateWork(renderer, label, work, true, failures);
  const prepareBatches = async () => {
    for (let offset = 0; offset < objects.length && !cancelled();) {
      const batch = nextPreparationBatch(objects, offset, batchSize, state, pipelineConcurrency);
      stage('texture-uploads', batch);
      const textures = collectTextures(batch, scene).filter(texture => state.textures.get(texture) !== texture.version);
      progress.pendingTextures = textures.length;
      options.onPendingTextures?.(progress.pendingTextures);
      if (cancelled()) return;
      // One fence covers the batch's uploads; a fence per texture serialized hundreds of GPU round trips.
      if (textures.length) await scoped(`Textures ${textures.map(texture => texture.name || texture.uuid).join(", ")}`, async () => {
        for (const texture of textures) renderer.initTexture(texture);
        if (!covered) await finishUploads(completion);
      });
      for (const texture of textures) {
        if (!state.watchedTextures.has(texture)) {
          texture.addEventListener("dispose", () => state.textures.delete(texture));
          state.watchedTextures.add(texture);
        }
        state.textures.set(texture, texture.version);
      }
      progress.pendingTextures = 0;
      options.onPendingTextures?.(0);
      if (cancelled()) return;
      stage('main-thread-yield', batch);
      await yieldToMainThread();
      const buffers = new Map<AttributeBuffer, PreparedBuffer>();
      for (const object of batch) for (const buffer of geometryBuffers(object)) {
        buffers.set(buffer, { version: buffer.version, array: buffer.array });
      }
      // Clusters of an already compiled scenery layout create no pipeline, so they need neither
      // an error scope nor a GPU fence: one animation frame per batch paces their uploads.
      const known = !covered && !textures.length && batch.every(object => preparedScenery(object, state));
      stage('resident-pipelines', batch);
      if (known) await compileBatch(renderer, scene, camera, batch, state, false, options.renderTarget, lights);
      else await scoped("Resident graphics pipelines", () =>
        compileBatch(renderer, scene, camera, batch, state, false, options.renderTarget, lights));
      if (cancelled()) return;
      const fading = batch.filter(object => object.userData.prepareCorpseFade === true);
      if (fading.length) {
        stage('creature-fade-pipelines', fading);
        await scoped("Creature fade pipelines", () =>
          compileBatch(renderer, scene, camera, fading, state, true, options.renderTarget, lights));
      }
      if (known) await nextFrame();
      else if (!covered) {
        stage('gpu-completion', batch);
        await finishUploads(completion);
      }
      rememberPreparedBuffers(batch, buffers, state);
      offset += batch.length;
      progress.submittedMeshes = offset;
      if (!covered) {
        progress.pendingMeshes -= batch.length;
        if (!cancelled()) options.onPreparedBatch?.(batch);
      } else completedBatches.push(batch);
    }
  };
  validation.job = failures;
  try {
    if (!covered) await prepareBatches();
    else {
      // Bounded pipeline compilations span batches. None of this job becomes ready before
      // its full pipeline/error drain and its single upload fence.
      try { await validateWork(renderer, "Covered graphics preparation",
        () => withPipelineConcurrency(renderer, prepareBatches, pipelineConcurrency), false, failures); }
      finally {
        stage('pipeline-validation');
        await waitForGraphicsValidation(renderer);
      }
      if (failures.errors.length) throw failures.errors[0];
      stage('gpu-completion');
      await finishUploads(completion);
      stage('prepared-batch-delivery');
      if (!cancelled()) for (const batch of completedBatches) {
        progress.pendingMeshes -= batch.length;
        options.onPreparedBatch?.(batch);
      }
    }
  } catch (error) {
    validationError(validation, error, "Shader preparation", true, failures);
    // Already a device failure: it belongs to the device, not to this job's objects.
    if (!failures.errors.length) throw error;
  } finally { validation.job = null; lights?.dispose(); options.onPendingTextures?.(0); }
  if (failures.errors.length) {
    throw new ShaderPreparationError(failures.errors[0]!, objects.filter(object => usesFailedMaterial(object, failures.materials, state)));
  }
}

/** Three numbers every material; its render pipeline labels carry that id. */
type NumberedMaterial = THREE.Material & { readonly id: number };

function usesFailedMaterial(object: THREE.Object3D, failed: ReadonlySet<number>, state: PreparationState): boolean {
  const material = (object as Drawable).material;
  return Boolean(material) && (Array.isArray(material) ? material : [material!]).some(material =>
    [material, state.fadeMaterials.get(material)?.material].some(used => used && failed.has((used as NumberedMaterial).id)));
}

/** Native asynchronous pipeline creation shared by startup and streamed content. Calls
 * serialize per renderer so background and destination loads cannot flood its GPU queue. */
export function prepareShaderMeshes(
  renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera,
  objects: readonly THREE.Object3D[], options: ShaderPreparationOptions = {},
): Promise<void> {
  const state = stateFor(renderer);
  const now = performance.now();
  const progress: PreparationProgress = { pendingMeshes: objects.length, pendingTextures: 0,
    totalMeshes: objects.length, submittedMeshes: 0, startedAt: now, stageStartedAt: now,
    stage: 'queued', batch: [] };
  state.jobs.add(progress);
  const result = state.tail.then(() => prepare(renderer, scene, camera, objects, options, state, progress))
    .finally(() => { state.jobs.delete(progress); });
  state.tail = result.catch(() => {});
  return result;
}
