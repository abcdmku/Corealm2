import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { createGpuCompletion } from "./framePacer.js";
import type { GpuCompletion } from "./framePacer.js";

/** Repeated tiles share geometry and materials, and therefore the same compiler inputs. */
export function shaderGeometryKey(mesh: THREE.Mesh): string {
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
type PreparationState = {
  textures: WeakMap<THREE.Texture, number>;
  watchedTextures: WeakSet<THREE.Texture>;
  fadeMaterials: WeakMap<THREE.Material, { version: number; material: THREE.Material; release: () => void }>;
  tail: Promise<void>;
  completion?: GpuCompletion;
};
const states = new WeakMap<WebGPURenderer, PreparationState>();
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function stateFor(renderer: WebGPURenderer): PreparationState {
  let state = states.get(renderer);
  if (!state) {
    state = { textures: new WeakMap(), watchedTextures: new WeakSet(), fadeMaterials: new WeakMap(), tail: Promise.resolve() };
    states.set(renderer, state);
  }
  return state;
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

/** Three collects render items before its first pipeline-building await. Keep the actual
 * scene cache, mesh identity, skinning and parent transforms, then restore all live state
 * before it yields. WebGPU walks children directly, so traverse overrides do not work. */
function compileBatch(
  renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera,
  objects: readonly THREE.Object3D[], state: PreparationState, fading: boolean,
  renderTarget: THREE.RenderTarget | null | undefined,
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
  try {
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
  await yieldTask();
}

async function prepare(
  renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera,
  objects: readonly THREE.Object3D[], options: ShaderPreparationOptions, state: PreparationState,
): Promise<void> {
  // compileBatch relies on collection running synchronously until pipeline building starts.
  await renderer.init();
  const completion = state.completion ??= createGpuCompletion(renderer);
  const cancelled = options.isCancelled ?? (() => false);
  const batchSize = Math.max(1, Math.min(4, Math.floor(options.batchSize ?? 2)));
  try {
    for (let offset = 0; offset < objects.length && !cancelled(); offset += batchSize) {
      const batch = objects.slice(offset, offset + batchSize);
      const textures = collectTextures(batch, scene).filter(texture => state.textures.get(texture) !== texture.version);
      options.onPendingTextures?.(textures.length);
      for (let index = 0; index < textures.length; index++) {
        if (cancelled()) return;
        const texture = textures[index]!;
        renderer.initTexture(texture);
        if (!state.watchedTextures.has(texture)) {
          texture.addEventListener("dispose", () => state.textures.delete(texture));
          state.watchedTextures.add(texture);
        }
        state.textures.set(texture, texture.version);
        await finishUploads(completion);
        options.onPendingTextures?.(textures.length - index - 1);
      }
      if (cancelled()) return;
      await compileBatch(renderer, scene, camera, batch, state, false, options.renderTarget);
      if (cancelled()) return;
      const fading = batch.filter(object => object.userData.prepareCorpseFade === true);
      if (fading.length) await compileBatch(renderer, scene, camera, fading, state, true, options.renderTarget);
      await finishUploads(completion);
    }
  } finally { options.onPendingTextures?.(0); }
}

/** Native asynchronous pipeline creation shared by startup and streamed content. Calls
 * serialize per renderer so background and destination loads cannot flood its GPU queue. */
export function prepareShaderMeshes(
  renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera,
  objects: readonly THREE.Object3D[], options: ShaderPreparationOptions = {},
): Promise<void> {
  const state = stateFor(renderer);
  const result = state.tail.then(() => prepare(renderer, scene, camera, objects, options, state));
  state.tail = result.catch(() => {});
  return result;
}
