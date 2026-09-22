import * as THREE from "three";
import { type Node } from "three/webgpu";
import { Fn, If, array, attribute, float, instancedMesh, int, ivec2, mat3, mat4, normalLocal,
  positionLocal, screenCoordinate, tangentLocal, textureLoad, varying, vec4 } from "three/tsl";
import { cloneNodeMaterial, composeSurface, type SurfaceNodeMaterial } from "./nodeMaterials.js";
import { conformTerrainRig, restoreTerrainRig, terrainRigSnapshot, type TerrainPose } from "./terrainRig.js";

import {simplifyCrowdGeometry} from "./crowdGeometry.js";
import { clone as cloneRigged } from "three/examples/jsm/utils/SkeletonUtils.js";

export interface LodPose {
  terrain?: TerrainPose;
  clip: THREE.AnimationClip;
  time: number;
  previousClip?: THREE.AnimationClip;
  previousTime?: number;
  blend: number;
  opacity?: number;
  /** Already masked, additive local-bone recoil on the actor's existing locomotion clock. */
  overlay?: { clip: THREE.AnimationClip; time: number; weight: number };
}

interface ClipSamples { offset: number; frames: number; duration: number }
interface Palette {
  texture: THREE.DataTexture;
  bones: number;
  bounds: THREE.Box3;
  mirrored: boolean;
  uploaded: boolean;
  dirtyFrames: Set<number>;
  influences: { bone: number; index: number; bounds: THREE.Box3 }[];
  /** Joint anchors at the same sample times as the skin matrices, in model space. */
  anchors: Float32Array;
}
interface Part {
  source: THREE.Material;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  mesh: THREE.InstancedMesh;
  triangles: number;
  palette: Palette;
}

const SAMPLE_HZ = 20;
const MAX_SAMPLES = 4096;
const MAX_TEXTURE_SIZE = 2048;
const WHITE = new THREE.Color(0xffffff);
// Three supports mat4 -> mat3 conversion; its declaration omits that overload.
const matrixBasis = mat3 as unknown as (matrix: Node<"mat4">) => Node<"mat3">;

/** Exact affine AABB transform, including reflection and shear, without eight corner transforms. */
export function unionTransformedBounds(target: THREE.Box3, source: THREE.Box3, matrix: THREE.Matrix4): void {
  if (source.isEmpty()) return;
  const cx = (source.min.x + source.max.x) * .5, ex = (source.max.x - source.min.x) * .5;
  const cy = (source.min.y + source.max.y) * .5, ey = (source.max.y - source.min.y) * .5;
  const cz = (source.min.z + source.max.z) * .5, ez = (source.max.z - source.min.z) * .5;
  const e = matrix.elements;
  const x = e[0]! * cx + e[4]! * cy + e[8]! * cz + e[12]!;
  const y = e[1]! * cx + e[5]! * cy + e[9]! * cz + e[13]!;
  const z = e[2]! * cx + e[6]! * cy + e[10]! * cz + e[14]!;
  const dx = Math.abs(e[0]!) * ex + Math.abs(e[4]!) * ey + Math.abs(e[8]!) * ez;
  const dy = Math.abs(e[1]!) * ex + Math.abs(e[5]!) * ey + Math.abs(e[9]!) * ez;
  const dz = Math.abs(e[2]!) * ex + Math.abs(e[6]!) * ey + Math.abs(e[10]!) * ez;
  target.min.x = Math.min(target.min.x, x - dx); target.max.x = Math.max(target.max.x, x + dx);
  target.min.y = Math.min(target.min.y, y - dy); target.max.y = Math.max(target.max.y, y + dy);
  target.min.z = Math.min(target.min.z, z - dz); target.max.z = Math.max(target.max.z, z + dz);
}

// Both ordinary meshes (bone-attached equipment) and skinned meshes use this path.
// Matrices already contain the source mesh hierarchy and its skin bind transforms.
const sampledPalettes = new WeakMap<THREE.Material, Readonly<Pick<Palette, "texture" | "bones">>>();

/** CPU diagnostics use the exact texture consumed by the sampled animation graph. */
export function sampledAnimationPalette(material: THREE.Material) {
  return sampledPalettes.get(material) ?? null;
}

function wrapMaterial(material: SurfaceNodeMaterial, palette: Palette): void {
  const frames = attribute<"vec4">("lodFrames", "vec4");
  const previous = attribute<"vec4">("lodPreviousFrames", "vec4");
  const indices = attribute<"vec4">("skinIndex", "vec4");
  const weights = attribute<"vec4">("skinWeight", "vec4");
  const boneAt = (frame: Node<"float">, bone: Node<"float">) => {
    const address = int(frame).mul(palette.bones).add(int(bone)).mul(4);
    const uv = ivec2(address.mod(palette.texture.image.width), address.div(palette.texture.image.width));
    return mat4(textureLoad(palette.texture, uv), textureLoad(palette.texture, uv.add(ivec2(1, 0))),
      textureLoad(palette.texture, uv.add(ivec2(2, 0))), textureLoad(palette.texture, uv.add(ivec2(3, 0))));
  };
  const between = Fn(([sample, bone]: [Node<"vec4">, Node<"float">]) => {
    const pose = boneAt(sample.x, bone).toVar();
    If(sample.z.greaterThan(0).and(sample.x.notEqual(sample.y)), () => {
      pose.assign(pose.mul(float(1).sub(sample.z)).add(boneAt(sample.y, bone).mul(sample.z)));
    });
    return pose;
  });
  const bone = Fn(([index]: [Node<"float">]) => {
    const current = between(frames, index).toVar();
    If(frames.w.lessThan(1), () => {
      current.assign(between(previous, index).mul(float(1).sub(frames.w)).add(current.mul(frames.w)));
    });
    return current;
  });
  composeSurface(material, {
    position: inherited => Fn((builder) => {
      const skin = bone(indices.x).mul(weights.x).toVar();
      If(weights.y.greaterThan(0), () => { skin.assign(skin.add(bone(indices.y).mul(weights.y))); });
      If(weights.z.greaterThan(0), () => { skin.assign(skin.add(bone(indices.z).mul(weights.z))); });
      If(weights.w.greaterThan(0), () => { skin.assign(skin.add(bone(indices.w).mul(weights.w))); });
      // NodeMaterial's position hook runs after default instancing. Start from raw
      // geometry, apply the sampled model-space skin, then apply the instance once.
      positionLocal.assign(skin.mul(vec4(attribute<"vec3">("position", "vec3"), 1)).xyz);
      if (builder.geometry.hasAttribute("normal")) {
        const basis = matrixBasis(skin).toVar(), normalMatrix = basis.toVar();
        If(basis.determinant().abs().greaterThan(1e-12), () => {
          normalMatrix.assign(basis.inverse().transpose());
        });
        normalLocal.assign(normalMatrix.mul(attribute<"vec3">("normal", "vec3")));
        if (builder.geometry.hasAttribute("tangent")) {
          tangentLocal.assign(basis.mul(attribute<"vec4">("tangent", "vec4").xyz));
        }
      }
      instancedMesh(builder.object as THREE.InstancedMesh);
      return inherited;
    })(),
  });
  const opacity = varying(previous.w);
  const pixel = screenCoordinate.xy.floor().mod(4);
  const bayer = array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(value => float(value)));
  const threshold = bayer.element(int(pixel.y).mul(4).add(int(pixel.x))).add(0.5).div(16);
  const visible = opacity.greaterThanEqual(threshold);
  material.maskNode = material.maskNode ? (material.maskNode as Node<"bool">).and(visible) : visible;
  // WebGPU copies positionNode and maskNode into its shadow material, so the
  // shadow uses the same pose and ordered corpse fade as the visible actor.
  sampledPalettes.set(material, { texture: palette.texture, bones: palette.bones });
}

/** Share floating shader-input layouts across imported, simplified and rigid sampled parts. */
function canonicalSampledAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute | THREE.InterleavedBufferAttribute {
  const interleaved = (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute;
  // Explicit ivec/uvec inputs must retain integer delivery and full integer precision.
  if ((attribute as THREE.BufferAttribute).gpuType === THREE.IntType) return attribute;
  if (!interleaved && attribute.array instanceof Float32Array && !attribute.normalized) return attribute;
  const halfFloat = (attribute as THREE.BufferAttribute & { isFloat16BufferAttribute?: boolean }).isFloat16BufferAttribute;
  const values = new Float32Array(attribute.count * attribute.itemSize);
  for (let vertex = 0; vertex < attribute.count; vertex++) {
    for (let component = 0; component < attribute.itemSize; component++) {
      // Decode normalized integer colors/UVs before changing their GPU input format.
      values[vertex * attribute.itemSize + component] = halfFloat
        ? THREE.DataUtils.fromHalfFloat(attribute.array[vertex * attribute.itemSize + component]!)
        : attribute.getComponent(vertex, component);
    }
  }
  const data = interleaved ? (attribute as THREE.InterleavedBufferAttribute).data : attribute as THREE.BufferAttribute;
  const instanced = (data as THREE.InstancedInterleavedBuffer & { isInstancedInterleavedBuffer?: boolean }).isInstancedInterleavedBuffer
    || (attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute;
  const result = instanced ? new THREE.InstancedBufferAttribute(values, attribute.itemSize, false,
    (data as THREE.InstancedInterleavedBuffer).meshPerAttribute) : new THREE.BufferAttribute(values, attribute.itemSize);
  result.name = attribute.name;
  result.setUsage(data.usage);
  return result;
}

/** Shared sampled skeletal poses with small per-instance clip/phase attributes. */
export class AnimationLod {
  private readonly terrainPoses = new Map<number, LodPose>();
  terrainSnapshot(slot: number) {
    const pose = this.terrainPoses.get(slot), frame = this.overlayFrames.get(slot);
    if (!pose || frame === undefined) return null;
    this.writeOverlay(this.sampleCount + frame, pose, false);
    return terrainRigSnapshot(this.samplingRoot!);
  }
  readonly sampleCount: number;
  private readonly samples = new Map<THREE.AnimationClip, ClipSamples>();
  private readonly palettes: Palette[] = [];
  private readonly parts: Part[] = [];
  private sourceTriangleCount = 0;
  private readonly slots = new Map<number, number>();
  private readonly placements = new Map<number, THREE.Matrix4>();
  private readonly rows: number[] = [];
  private capacity = 16;
  private frames = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  private previousFrames = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  private disposed = false;
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchColor = new THREE.Color();
  private readonly terrainMatrix = new THREE.Matrix4();
  private readonly terrainInverse = new THREE.Matrix4();
  private readonly terrainAnchor = new THREE.Vector3();
  private samplingRoot: THREE.Object3D | null = null;
  private samplingAnimationRoot: THREE.Object3D | null = null;
  private samplingMixer: THREE.AnimationMixer | null = null;
  private samplingMeshes: THREE.Mesh[] = [];
  private sampledTerrainSupported = true;
  private readonly replayClips = new Map<THREE.AnimationClip, THREE.AnimationClip>();
  private readonly overlayFrames = new Map<number, number>();
  private readonly freeOverlayFrames: number[] = [];
  private overlayCapacity = 0;
  private overlayHighWater = 0;
  private preparation: Generator<void> | null = null;
  private prepared = false;

  constructor(
    private readonly parent: THREE.Object3D,
    root: THREE.Object3D,
    animationRoot: THREE.Object3D,
    clips: readonly THREE.AnimationClip[],
    materialFor: (source: THREE.Material) => THREE.Material,
    deferPreparation = false,
    private readonly castShadow = true,
    private readonly simplifyGeometry = false,
  ) {
    const uniqueClips = [...new Set(clips)];
    if (uniqueClips.length === 0 || uniqueClips.length > MAX_SAMPLES / 2) {
      throw new Error("AnimationLod requires a bounded, nonempty clip library.");
    }
    const totalDuration = uniqueClips.reduce((sum, clip) => sum + Math.max(0, clip.duration), 0);
    // Long imported takes cannot allocate an unbounded atlas. Ordinary game clips retain 20 Hz.
    const rate = Math.min(SAMPLE_HZ, (MAX_SAMPLES - uniqueClips.length * 2) / Math.max(totalDuration, 1));
    let count = 0;
    for (const clip of uniqueClips) {
      if (!Number.isFinite(clip.duration) || clip.duration < 0) throw new Error(`Invalid clip duration: ${clip.name}`);
      const frames = Math.max(2, Math.ceil(clip.duration * rate) + 1);
      this.samples.set(clip, { offset: count, frames, duration: clip.duration });
      count += frames;
    }
    this.sampleCount = count;

    this.preparation = this.prepareSamples(root, animationRoot, materialFor);
    if (!deferPreparation) this.prepare(Infinity);
  }

  get ready(): boolean { return this.prepared && !this.disposed; }
  get preparing(): boolean { return !this.prepared && !this.disposed; }
  get meshCount(): number { return this.parts.length; }

  /** CPU sampling can finish before the streamed shaders and textures are drawable. */
  isViewReady(ready: (root: THREE.Object3D) => boolean): boolean {
    return this.ready && this.parts.every(part => ready(part.mesh));
  }

  /** Count the actual drawable meshes for this slot, including the streamed preparation gate. */
  renderedMeshCount(slot: number, ready: (root: THREE.Object3D) => boolean): number {
    if (!this.slots.has(slot)) return 0;
    return this.parts.filter(part => {
      for (let node: THREE.Object3D | null = part.mesh; node; node = node.parent) {
        if (!node.visible) return false;
      }
      return ready(part.mesh) && part.mesh.count > 0;
    }).length;
  }

  /** Yield between sampled poses, so a new distant actor cannot block a whole input frame. */
  prepare(budgetMs = 2): boolean {
    if (this.disposed) return false;
    const started = performance.now();
    try {
      while (this.preparation) {
        if (this.preparation.next().done) {
          this.preparation = null;
          this.prepared = true;
        }
        if (performance.now() - started >= budgetMs) break;
      }
    } catch (error) {
      this.preparation = null;
      this.dispose();
      throw error;
    }
    return this.ready;
  }

  private *prepareSamples(root: THREE.Object3D, animationRoot: THREE.Object3D,
    materialFor: (source: THREE.Material) => THREE.Material): Generator<void> {

    const sampledRoot = cloneRigged(root);
    const originals: THREE.Object3D[] = [];
    const clones: THREE.Object3D[] = [];
    root.traverse((node) => originals.push(node));
    sampledRoot.traverse((node) => clones.push(node));
    const sampledAnimationRoot = clones[originals.indexOf(animationRoot)];
    if (!sampledAnimationRoot) throw new Error("AnimationLod animationRoot must belong to root.");
    const meshes = clones.filter((node): node is THREE.Mesh => (node as THREE.Mesh).isMesh && this.isVisible(node, sampledRoot));
    const mixer = new THREE.AnimationMixer(sampledAnimationRoot);
    this.samplingRoot = sampledRoot;
    this.samplingAnimationRoot = sampledAnimationRoot;
    this.samplingMixer = mixer;
    this.samplingMeshes = meshes;
    try {
      sampledRoot.updateMatrixWorld(true);
      for (const mesh of meshes) {
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          if ((mesh as THREE.SkinnedMesh).bindMode !== THREE.AttachedBindMode) this.sampledTerrainSupported = false;
          for (let parent = mesh.parent; parent; parent = parent.parent) {
            if ((parent as THREE.Bone).isBone) this.sampledTerrainSupported = false;
          }
        }
        if (Object.values(mesh.geometry.morphAttributes).some((attributes) => attributes.length > 0)) {
          throw new Error(`AnimationLod requires skeletal animation; morph targets need a separate renderer: ${mesh.name}`);
        }
      }
      for (const mesh of meshes) { this.palettes.push(this.allocatePalette(mesh)); yield; }
      const skin = new THREE.Matrix4();
      const bind = new THREE.Matrix4();
      for (const [clip, sample] of this.samples) {
        mixer.stopAllAction();
        const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        for (let frame = 0; frame < sample.frames; frame++) {
          mixer.setTime(sample.duration * frame / (sample.frames - 1));
          sampledRoot.updateMatrixWorld(true);
          for (let part = 0; part < meshes.length; part++) {
            const mesh = meshes[part]!;
            const palette = this.palettes[part]!;
            const skinned = mesh as THREE.SkinnedMesh;
            const data = palette.texture.image.data as Float32Array;
            if (skinned.isSkinnedMesh) bind.multiplyMatrices(mesh.matrixWorld, skinned.bindMatrixInverse);
            for (const { bone, index, bounds } of palette.influences) {
              if (skinned.isSkinnedMesh) {
                skin.multiplyMatrices(skinned.skeleton.bones[bone]!.matrixWorld, skinned.skeleton.boneInverses[bone]!);
                skin.premultiply(bind).multiply(skinned.bindMatrix);
              } else {
                skin.copy(mesh.matrixWorld);
              }
              skin.toArray(data, ((sample.offset + frame) * palette.bones + index) * 16);
              let anchor: THREE.Object3D | null = skinned.isSkinnedMesh ? skinned.skeleton.bones[bone]! : mesh.parent;
              while (anchor && !(anchor as THREE.Bone).isBone) anchor = anchor.parent;
              const at = ((sample.offset + frame) * palette.bones + index) * 3;
              if (anchor) this.terrainAnchor.setFromMatrixPosition(anchor.matrixWorld).toArray(palette.anchors, at);
              else palette.anchors[at] = NaN;
              // Weighted skinning and interpolation are convex combinations of these transforms.
              // Their union bounds all vertices, including transitions between different clips.
              unionTransformedBounds(palette.bounds, bounds, skin);
            }
          }
          yield;
        }
      }
      for (let index = 0; index < meshes.length; index++) {
        const mesh = meshes[index]!;
        const original = originals[clones.indexOf(mesh)] as THREE.Mesh;
        this.createParts(original, this.palettes[index]!, materialFor);
        yield;
      }
    } finally {
      mixer.stopAllAction();
      // Retain this one shared clone for transient exact local-bone overlay composition.
    }
  }

  get drawCalls(): number { return this.rows.length ? this.parts.length : 0; }
  materialNames(slot:number):string[] {
    return this.slots.has(slot)?this.parts.map(part=>part.material.name):[];
  }
  get triangles(): number { return this.rows.length * this.parts.reduce((sum, part) => sum + part.triangles, 0); }
  get sourceTriangles(): number { return this.rows.length * this.sourceTriangleCount; }
  get shadowDrawCalls(): number { return this.rows.length ? this.parts.filter(part => part.mesh.castShadow).length : 0; }
  get textureBytes(): number { return this.palettes.reduce((sum, palette) => sum + (palette.texture.image.data as Float32Array).byteLength, 0); }

  set(slot: number, matrix: THREE.Matrix4, pose: LodPose, tintForMaterial?: (source: THREE.Material) => THREE.Color | null): void {
    if (this.disposed) throw new Error("AnimationLod has been disposed.");
    if (!this.ready) throw new Error("AnimationLod preparation is unfinished.");
    let current = this.frameAt(pose.clip, pose.time);
    const previous = pose.previousClip ? this.frameAt(pose.previousClip, pose.previousTime ?? 0) : current;
    const overlay = pose.overlay;
    if (overlay && (!Number.isFinite(overlay.time) || !Number.isFinite(overlay.weight))) throw new Error("AnimationLod requires finite overlay time and weight.");
    const hasOverlay = overlay !== undefined && overlay.weight > 0;
    const dynamic = hasOverlay || pose.terrain !== undefined;
    if (dynamic) {
      if (hasOverlay && overlay.clip.blendMode !== THREE.AdditiveAnimationBlendMode) throw new Error("AnimationLod overlay must be a masked additive clip.");
      if (!Number.isFinite(pose.time) || !Number.isFinite(pose.blend)
        || (pose.previousTime !== undefined && !Number.isFinite(pose.previousTime))) throw new Error("AnimationLod requires finite base clocks.");
      const frame = this.overlayFrame(slot);
      // Ground following does not need to replay every animation track and skeleton. Warp
      // the same interpolated palettes used by the GPU; only additive hits need a live mixer.
      if (pose.terrain && !hasOverlay && this.sampledTerrainSupported) this.writeTerrain(frame, pose, current, previous);
      else this.writeOverlay(frame, pose);
      if (pose.terrain) {
        const previousTerrain = this.terrainPoses.get(slot)?.terrain;
        const terrain = previousTerrain ?? { ...pose.terrain, placement: new THREE.Matrix4(), origin: new THREE.Vector3() };
        terrain.placement.copy(pose.terrain.placement);
        terrain.origin.copy(pose.terrain.origin);
        terrain.heightAt = pose.terrain.heightAt;
        this.terrainPoses.set(slot, { ...pose, terrain });
      } else this.terrainPoses.delete(slot);
      current = [frame, frame, 0];
    } else this.releaseOverlayFrame(slot);
    let row = this.slots.get(slot);
    if (row === undefined) {
      row = this.rows.length;
      if (row === this.capacity) this.grow();
      this.slots.set(slot, row);
      this.rows.push(slot);
    }
    this.writeFrames(this.frames, row, current[0], current[1], current[2], !dynamic && pose.previousClip ? THREE.MathUtils.clamp(pose.blend, 0, 1) : 1);
    this.writeFrames(this.previousFrames, row, previous[0], previous[1], previous[2], THREE.MathUtils.clamp(pose.opacity ?? 1, 0, 1));
    const placement = this.placements.get(slot);
    const moved = !placement || !placement.equals(matrix);
    if (moved) this.placements.set(slot, (placement ?? new THREE.Matrix4()).copy(matrix));
    for (const part of this.parts) {
      if (moved) {
        part.mesh.setMatrixAt(row, matrix);
        part.mesh.instanceMatrix.needsUpdate = true;
        part.mesh.boundingSphere = null;
        part.mesh.boundingBox = null;
      }
      const tint = tintForMaterial?.(part.source) ?? WHITE;
      part.mesh.getColorAt(row, this.scratchColor);
      if (Math.fround(tint.r) !== this.scratchColor.r || Math.fround(tint.g) !== this.scratchColor.g || Math.fround(tint.b) !== this.scratchColor.b) {
        part.mesh.setColorAt(row, tint);
        part.mesh.instanceColor!.needsUpdate = true;
      }
      part.mesh.count = this.rows.length;
      part.mesh.visible = true;
    }
  }

  hide(slot: number): void {
    this.placements.delete(slot);
    this.releaseOverlayFrame(slot);
    const row = this.slots.get(slot);
    if (row === undefined) return;
    const last = this.rows.length - 1;
    if (row !== last) {
      this.frames.copyAt(row, this.frames, last);
      this.previousFrames.copyAt(row, this.previousFrames, last);
      const moved = this.rows[last]!;
      this.rows[row] = moved;
      this.slots.set(moved, row);
      for (const part of this.parts) {
        part.mesh.getMatrixAt(last, this.scratchMatrix);
        part.mesh.setMatrixAt(row, this.scratchMatrix);
        part.mesh.getColorAt(last, this.scratchColor);
        part.mesh.setColorAt(row, this.scratchColor);
      }
    }
    this.rows.pop();
    this.slots.delete(slot);
    this.frames.needsUpdate = true;
    this.previousFrames.needsUpdate = true;
    for (const part of this.parts) {
      part.mesh.count = this.rows.length;
      part.mesh.visible = this.rows.length > 0;
      part.mesh.instanceMatrix.needsUpdate = true;
      part.mesh.instanceColor!.needsUpdate = true;
      part.mesh.boundingSphere = null;
      part.mesh.boundingBox = null;
    }
  }

  /** Conservative bounds of all sampled poses, expressed in the supplied parent's space. */
  bounds(slot: number, out: THREE.Box3): THREE.Box3 | null {
    const row = this.slots.get(slot);
    if (row === undefined || this.parts.length === 0) return null;
    out.makeEmpty();
    for (const part of this.parts) out.union(part.geometry.boundingBox!);
    this.parts[0]!.mesh.getMatrixAt(row, this.scratchMatrix);
    return out.applyMatrix4(this.scratchMatrix);
  }

  /** Current drawn vertices, for explicit inspection only. Rendering retains cheap conservative bounds. */
  drawnBounds(slot: number, out: THREE.Box3): THREE.Box3 | null {
    const row = this.slots.get(slot);
    if (row === undefined || this.parts.length === 0) return null;
    out.makeEmpty();
    const point = new THREE.Vector3();
    for (const part of this.parts) {
      const data = part.palette.texture.image.data as Float32Array;
      const bones = part.palette.bones;
      const matrices = new Float64Array(bones * 16);
      const blend = this.frames.getW(row);
      // Read the actual uploaded frame attributes, including crossfades and dynamic overlays.
      for (const [frames, weight] of [[this.frames, blend], [this.previousFrames, 1 - blend]] as const) {
        for (const [frame, fraction] of [[frames.getX(row), 1 - frames.getZ(row)], [frames.getY(row), frames.getZ(row)]] as const) {
          if (weight * fraction === 0) continue;
          const offset = frame * bones * 16;
          for (let element = 0; element < matrices.length; element++) {
            matrices[element] = matrices[element]! + data[offset + element]! * weight * fraction;
          }
        }
      }
      const geometry = part.geometry, positions = geometry.getAttribute("position");
      const indices = geometry.getAttribute("skinIndex"), weights = geometry.getAttribute("skinWeight");
      const end = Math.min(geometry.index?.count ?? positions.count, geometry.drawRange.start + geometry.drawRange.count);
      part.mesh.getMatrixAt(row, this.scratchMatrix);
      for (let item = geometry.drawRange.start; item < end; item++) {
        const vertex = geometry.index ? geometry.index.getX(item) : item;
        const x = positions.getX(vertex), y = positions.getY(vertex), z = positions.getZ(vertex);
        point.set(0, 0, 0);
        for (let influence = 0; influence < 4; influence++) {
          const weight = weights.getComponent(vertex, influence);
          if (weight === 0) continue;
          const bone = indices.getComponent(vertex, influence) * 16;
          // Palette GLSL consumes xyz directly, then applies the instance matrix with w=1.
          point.x += weight * (matrices[bone]! * x + matrices[bone + 4]! * y + matrices[bone + 8]! * z + matrices[bone + 12]!);
          point.y += weight * (matrices[bone + 1]! * x + matrices[bone + 5]! * y + matrices[bone + 9]! * z + matrices[bone + 13]!);
          point.z += weight * (matrices[bone + 2]! * x + matrices[bone + 6]! * y + matrices[bone + 10]! * z + matrices[bone + 14]!);
        }
        out.expandByPoint(point.applyMatrix4(this.scratchMatrix));
      }
    }
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.preparation?.return(undefined);
    this.preparation = null;
    this.samplingMixer?.stopAllAction();
    if (this.samplingAnimationRoot) this.samplingMixer?.uncacheRoot(this.samplingAnimationRoot);
    for (const skeleton of new Set(this.samplingMeshes.filter((mesh) => (mesh as THREE.SkinnedMesh).isSkinnedMesh).map((mesh) => (mesh as THREE.SkinnedMesh).skeleton))) skeleton.dispose();
    this.samplingRoot = null;
    this.samplingAnimationRoot = null;
    this.samplingMixer = null;
    this.samplingMeshes = [];
    this.replayClips.clear();
    this.overlayFrames.clear();
    this.terrainPoses.clear();
    this.freeOverlayFrames.length = 0;
    for (const part of this.parts) {
      part.mesh.removeFromParent();
      part.mesh.dispose();
      part.geometry.dispose();
      part.material.dispose();
    }
    for (const palette of this.palettes) palette.texture.dispose();
    this.parts.length = 0;
    this.palettes.length = 0;
    this.rows.length = 0;
    this.slots.clear();
    this.placements.clear();
  }

  private releaseOverlayFrame(slot: number): void {
    this.terrainPoses.delete(slot);
    const frame = this.overlayFrames.get(slot);
    if (frame === undefined) return;
    this.overlayFrames.delete(slot);
    this.freeOverlayFrames.push(frame);
  }

  /** Dynamic frames belong to logical slots, independent of compacted instance rows. */
  private overlayFrame(slot: number): number {
    const existing = this.overlayFrames.get(slot);
    if (existing !== undefined) return this.sampleCount + existing;
    let frame = this.freeOverlayFrames.pop();
    if (frame === undefined) {
      if (this.overlayHighWater === this.overlayCapacity) this.growOverlayPalettes();
      frame = this.overlayHighWater++;
    }
    this.overlayFrames.set(slot, frame);
    return this.sampleCount + frame;
  }

  private growOverlayPalettes(): void {
    let capacity = Math.max(1, this.overlayCapacity * 2);
    const dimensions = (count: number) => this.palettes.map(palette => Math.ceil((this.sampleCount + count) * palette.bones * 4 / palette.texture.image.width));
    const fits = (sizes: number[]) => sizes.every(height => height <= MAX_TEXTURE_SIZE)
      && sizes.reduce((sum, height, index) => sum + height * this.palettes[index]!.texture.image.width * 16, 0) <= 64 * 1024 * 1024;
    let heights = dimensions(capacity);
    if (!fits(heights)) { capacity = this.overlayHighWater + 1; heights = dimensions(capacity); }
    // Validate every part before mutating anything, including rigid attachments and all skin palettes.
    if (!fits(heights)) {
      throw new Error("AnimationLod additive overlays exceed its 64 MiB texture budget.");
    }
    this.palettes.forEach((palette, index) => {
      const texture = palette.texture, height = heights[index]!;
      if (height === texture.image.height) return;
      const data = new Float32Array(texture.image.width * height * 4);
      data.set(texture.image.data as Float32Array);
      // Keep the uniform's texture identity while releasing immutable GPU storage before resizing.
      texture.dispose();
      texture.image = { data, width: texture.image.width, height };
      texture.clearUpdateRanges();
      palette.dirtyFrames.clear();
      palette.uploaded = false;
      texture.needsUpdate = true;
    });
    this.overlayCapacity = capacity;
  }

  /** One shared mixer composes local rotations before skinning; matrix-space addition is invalid. */
  private writeOverlay(frame: number, pose: LodPose, upload = true): void {
    const mixer = this.samplingMixer!, root = this.samplingRoot!, overlay = pose.overlay!;
    restoreTerrainRig(root);
    const blend = pose.previousClip ? THREE.MathUtils.clamp(pose.blend, 0, 1) : 1;
    mixer.stopAllAction();
    const play = (clip: THREE.AnimationClip, time: number, weight: number, mode: THREE.AnimationBlendMode): void => {
      const action = mixer.clipAction(clip, undefined, mode).reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.setEffectiveWeight(weight).play();
      action.time = THREE.MathUtils.clamp(time, 0, clip.duration);
    };
    if (pose.previousClip && blend < 1) {
      let previous = pose.previousClip;
      if (previous === pose.clip) {
        if (!this.replayClips.has(previous)) this.replayClips.set(previous, previous.clone());
        previous = this.replayClips.get(previous)!;
      }
      play(previous, pose.previousTime ?? 0, 1 - blend, THREE.NormalAnimationBlendMode);
    }
    play(pose.clip, pose.time, blend, THREE.NormalAnimationBlendMode);
    if (overlay) play(overlay.clip, overlay.time, THREE.MathUtils.clamp(overlay.weight, 0, 1), THREE.AdditiveAnimationBlendMode);
    mixer.update(0);
    if (pose.terrain) conformTerrainRig(root, pose.terrain);
    else root.updateMatrixWorld(true);
    if (!upload) return;
    const skin = new THREE.Matrix4(), bind = new THREE.Matrix4();
    for (let part = 0; part < this.samplingMeshes.length; part++) {
      const mesh = this.samplingMeshes[part]!, skinned = mesh as THREE.SkinnedMesh, palette = this.palettes[part]!;
      const data = palette.texture.image.data as Float32Array;
      if (skinned.isSkinnedMesh) bind.multiplyMatrices(mesh.matrixWorld, skinned.bindMatrixInverse);
      for (const { bone, index, bounds } of palette.influences) {
        if (skinned.isSkinnedMesh) {
          skin.multiplyMatrices(skinned.skeleton.bones[bone]!.matrixWorld, skinned.skeleton.boneInverses[bone]!);
          skin.premultiply(bind).multiply(skinned.bindMatrix);
        } else skin.copy(mesh.matrixWorld);
        skin.toArray(data, (frame * palette.bones + index) * 16);
        unionTransformedBounds(palette.bounds, bounds, skin);
      }
      this.dirtyPaletteFrame(palette, frame);
    }
    this.refreshBounds();
  }

  private writeFrames(attribute: THREE.InstancedBufferAttribute, row: number, x: number, y: number, z: number, w: number): void {
    if (attribute.getX(row) === x && attribute.getY(row) === y
      && attribute.getZ(row) === Math.fround(z) && attribute.getW(row) === Math.fround(w)) return;
    attribute.setXYZW(row, x, y, z, w);
    attribute.needsUpdate = true;
  }

  private writeTerrain(frame: number, pose: LodPose, current: readonly number[], previous: readonly number[]): void {
    const terrain = pose.terrain!, placement = terrain.placement;
    const inverse = this.terrainInverse.copy(placement).invert();
    const matrix = this.terrainMatrix, anchor = this.terrainAnchor;
    const blend = pose.previousClip ? THREE.MathUtils.clamp(pose.blend, 0, 1) : 1;
    const wa = (1 - current[2]!) * blend, wb = current[2]! * blend;
    const wc = (1 - previous[2]!) * (1 - blend), wd = previous[2]! * (1 - blend);
    const p = placement.elements, inv = inverse.elements;
    const base = terrain.heightAt(terrain.origin.x, terrain.origin.z);
    for (const palette of this.palettes) {
      const data = palette.texture.image.data as Float32Array;
      const a = current[0]! * palette.bones, b = current[1]! * palette.bones;
      const c = previous[0]! * palette.bones, d = previous[1]! * palette.bones;
      for (const { index, bounds } of palette.influences) {
        const elements = matrix.elements;
        const ia = (a + index) * 16, ib = (b + index) * 16;
        for (let element = 0; element < 16; element++) {
          elements[element] = data[ia + element]! * wa + data[ib + element]! * wb;
        }
        const anchors = palette.anchors, aa = (a + index) * 3, ab = (b + index) * 3;
        anchor.set(anchors[aa]! * wa + anchors[ab]! * wb,
          anchors[aa + 1]! * wa + anchors[ab + 1]! * wb, anchors[aa + 2]! * wa + anchors[ab + 2]! * wb);
        if (blend < 1) {
          const ic = (c + index) * 16, id = (d + index) * 16, ac = (c + index) * 3, ad = (d + index) * 3;
          for (let element = 0; element < 16; element++) elements[element] = elements[element]! + data[ic + element]! * wc + data[id + element]! * wd;
          anchor.x += anchors[ac]! * wc + anchors[ad]! * wd;
          anchor.y += anchors[ac + 1]! * wc + anchors[ad + 1]! * wd;
          anchor.z += anchors[ac + 2]! * wc + anchors[ad + 2]! * wd;
        }
        if (Number.isFinite(base) && Number.isFinite(anchor.x)) {
          anchor.applyMatrix4(placement);
          const { x, z } = anchor, e = .04;
          const h = terrain.heightAt(x, z);
          const dx = (terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z)) / (2 * e);
          const dz = (terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
          if (Number.isFinite(h) && Number.isFinite(dx) && Number.isFinite(dz)) {
            // P^-1 * (I + worldY * tangent) * P is a rank-one correction.
            // Apply that correction directly, avoiding two full matrix products per bone.
            const tx = dx * p[0]! + dz * p[2]!, ty = dx * p[4]! + dz * p[6]!;
            const tz = dx * p[8]! + dz * p[10]!, tw = dx * p[12]! + dz * p[14]! + h - base - dx * x - dz * z;
            for (let column = 0; column < 16; column += 4) {
              const shift = tx * elements[column]! + ty * elements[column + 1]! + tz * elements[column + 2]! + tw * elements[column + 3]!;
              elements[column] = elements[column]! + inv[4]! * shift;
              elements[column + 1] = elements[column + 1]! + inv[5]! * shift;
              elements[column + 2] = elements[column + 2]! + inv[6]! * shift;
            }
          }
        }
        matrix.toArray(data, (frame * palette.bones + index) * 16);
        unionTransformedBounds(palette.bounds, bounds, matrix);
      }
      this.dirtyPaletteFrame(palette, frame);
    }
    this.refreshBounds();
  }

  private dirtyPaletteFrame(palette: Palette, frame: number): void {
    // Three's partial texture updates must not cross a texel row. Before first upload or
    // after resizing, leave ranges empty so the complete baked library uploads as well.
    if (palette.uploaded && !palette.dirtyFrames.has(frame)) {
      palette.dirtyFrames.add(frame);
      const rowWidth = palette.texture.image.width * 4;
      let start = frame * palette.bones * 16, remaining = palette.bones * 16;
      while (remaining > 0) {
        const count = Math.min(remaining, rowWidth - start % rowWidth);
        palette.texture.addUpdateRange(start, count); start += count; remaining -= count;
      }
    }
    palette.texture.needsUpdate = true;
  }

  private refreshBounds(): void {
    for (const part of this.parts) {
      if (part.geometry.boundingBox!.equals(part.palette.bounds)) continue;
      part.geometry.boundingBox!.copy(part.palette.bounds);
      part.palette.bounds.getBoundingSphere(part.geometry.boundingSphere!);
      part.mesh.boundingSphere = null;
      part.mesh.boundingBox = null;
    }
  }

  private frameAt(clip: THREE.AnimationClip, time: number): [number, number, number] {
    const sample = this.samples.get(clip);
    if (!sample) throw new Error(`AnimationLod did not sample clip: ${clip.name}`);
    const phase = sample.duration > 0 ? THREE.MathUtils.clamp(time / sample.duration, 0, 1) * (sample.frames - 1) : 0;
    const lower = Math.floor(phase);
    return [sample.offset + lower, sample.offset + Math.min(lower + 1, sample.frames - 1), phase - lower];
  }

  private isVisible(node: THREE.Object3D, root: THREE.Object3D): boolean {
    for (let ancestor: THREE.Object3D | null = node; ancestor && ancestor !== root; ancestor = ancestor.parent) {
      if (!ancestor.visible) return false;
    }
    return true;
  }

  private allocatePalette(mesh: THREE.Mesh): Palette {
    // A part may carry the whole imported skeleton while using only a few bones.
    // A vertex's skin result is a convex combination of its positive-weight influences.
    const positions = mesh.geometry.getAttribute("position"), point = new THREE.Vector3();
    const boundsByBone = new Map<number, THREE.Box3>();
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
      for (let vertex = 0; vertex < positions.count; vertex++) {
        point.fromBufferAttribute(positions, vertex);
        for (let influence = 0; influence < 4; influence++) {
          if (weights.getComponent(vertex, influence) <= 0) continue;
          const bone = indices.getComponent(vertex, influence);
          const bounds = boundsByBone.get(bone) ?? new THREE.Box3();
          bounds.expandByPoint(point); boundsByBone.set(bone, bounds);
        }
      }
    } else boundsByBone.set(0, new THREE.Box3().setFromBufferAttribute(positions as THREE.BufferAttribute));
    const influences = [...boundsByBone].map(([bone, bounds], index) => ({ bone, index, bounds }));
    const bones = influences.length;
    if (bones === 0) throw new Error(`AnimationLod has an empty skeleton: ${mesh.name}`);
    const texels = this.sampleCount * bones * 4;
    // Three uploads partial DataTextures one row per GL command. A square power-of-two
    // texture split a single actor pose across several rows, even for small palettes.
    // Align rows to whole poses so ordinary terrain/animation updates need one command.
    // WebGL2 supports these non-power-of-two dimensions with nearest filtering/no mips.
    const poseWidth = bones * 4;
    const width = poseWidth <= MAX_TEXTURE_SIZE
      ? Math.min(Math.floor(MAX_TEXTURE_SIZE / poseWidth), Math.max(1, Math.ceil(Math.sqrt(texels) / poseWidth))) * poseWidth
      : MAX_TEXTURE_SIZE;
    const height = Math.ceil(texels / width);
    if (height > MAX_TEXTURE_SIZE) throw new Error(`AnimationLod palette exceeds 64 MiB: ${mesh.name}`);
    const allocatedBytes = this.palettes.reduce((sum, palette) => sum + (palette.texture.image.data as Float32Array).byteLength, 0);
    if (allocatedBytes + width * height * 16 > 64 * 1024 * 1024) throw new Error("AnimationLod clip library exceeds its 64 MiB texture budget.");
    const texture = new THREE.DataTexture(new Float32Array(width * height * 4), width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.name = `animation-lod:${mesh.name}`;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const palette = { texture, bones, influences, anchors: new Float32Array(this.sampleCount * bones * 3),
      bounds: new THREE.Box3(), mirrored: mesh.matrixWorld.determinant() < 0, uploaded: false, dirtyFrames: new Set<number>() };
    texture.onUpdate = () => { palette.uploaded = true; palette.dirtyFrames.clear(); };
    return palette;
  }

  private createParts(mesh: THREE.Mesh, palette: Palette, materialFor: (source: THREE.Material) => THREE.Material): void {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const total = mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count;
    const groups = Array.isArray(mesh.material) && mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: total, materialIndex: 0 }];
    // The simplifier reads numeric components into floats. Preserve topology for
    // formats whose half-float encoding or integer shader inputs need special handling.
    const simplify = this.simplifyGeometry && !Object.values(mesh.geometry.attributes).some((attribute) =>
      (attribute as THREE.BufferAttribute).gpuType === THREE.IntType
      || (attribute as THREE.BufferAttribute & { isFloat16BufferAttribute?: boolean }).isFloat16BufferAttribute);
    for (const group of groups) {
      const source = materials[group.materialIndex ?? 0];
      if (!source || !source.visible) continue;
      const start = Math.max(group.start, mesh.geometry.drawRange.start);
      const end = Math.min(group.start + group.count, mesh.geometry.drawRange.start + mesh.geometry.drawRange.count, total);
      this.sourceTriangleCount += Math.floor(Math.max(0, end - start) / 3);
      const geometry = simplify
        ? simplifyCrowdGeometry(mesh.geometry, start, Math.max(0, end - start)) : mesh.geometry.clone();
      // Source buffers remain immutable. Canonicalize even when simplification keeps the
      // original topology, so full-detail players do not introduce cold input layouts.
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        geometry.setAttribute(name, canonicalSampledAttribute(attribute));
      }
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        const remap = new Map(palette.influences.map(({ bone, index }) => [bone, index]));
        const indices = geometry.getAttribute("skinIndex");
        for (let vertex = 0; vertex < indices.count; vertex++) {
          for (let influence = 0; influence < 4; influence++) {
            indices.setComponent(vertex, influence, remap.get(indices.getComponent(vertex, influence)) ?? 0);
          }
        }
      }
      if (palette.mirrored) {
        // The source renderer flips front faces for a reflected mesh.matrixWorld. That reflection
        // now lives in the palette, so retain its face orientation in the owned index buffer.
        const indices = geometry.index
          ? Array.from(geometry.index.array)
          : Array.from({ length: geometry.getAttribute("position").count }, (_, index) => index);
        for (let index = 0; index + 2 < indices.length; index += 3) {
          [indices[index + 1], indices[index + 2]] = [indices[index + 2]!, indices[index + 1]!];
        }
        geometry.setIndex(indices);
      }
      geometry.clearGroups();
      if (!simplify) geometry.setDrawRange(start, Math.max(0, end - start));
      if (!(mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        const vertexCount = geometry.getAttribute("position").count;
        const weights = new Float32Array(vertexCount * 4);
        for (let index = 0; index < vertexCount; index++) weights[index * 4] = 1;
        geometry.setAttribute("skinIndex", new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 4), 4));
        geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
      }
      geometry.setAttribute("lodFrames", this.frames);
      geometry.setAttribute("lodPreviousFrames", this.previousFrames);
      geometry.boundingBox = palette.bounds.clone();
      geometry.boundingSphere = palette.bounds.getBoundingSphere(new THREE.Sphere());
      const material = cloneNodeMaterial(materialFor(source));
      wrapMaterial(material, palette);
      const part: Part = { source, geometry, material, mesh: null!, triangles: Math.floor(geometry.drawRange.count / 3), palette };
      part.mesh = this.makeMesh(part);
      this.parts.push(part);
      this.parent.add(part.mesh);
    }
  }

  private makeMesh(part: Part): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, this.capacity);
    mesh.name = `animation-lod:${part.source.name}`;
    mesh.count = this.rows.length;
    mesh.visible = mesh.count > 0;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }

  private grow(): void {
    this.capacity *= 2;
    const frames = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const previous = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    frames.array.set(this.frames.array);
    previous.array.set(this.previousFrames.array);
    this.frames = frames;
    this.previousFrames = previous;
    for (const part of this.parts) {
      // Release the old attribute buffers before replacement. Three otherwise keeps their GPU
      // allocations until a geometry disposal that can no longer see the removed attributes.
      part.geometry.dispose();
      part.geometry.setAttribute("lodFrames", frames);
      part.geometry.setAttribute("lodPreviousFrames", previous);
      const matrices = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 16), 16)
        .setUsage(THREE.DynamicDrawUsage);
      const colors = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3)
        .setUsage(THREE.DynamicDrawUsage);
      matrices.array.set(part.mesh.instanceMatrix.array);
      colors.array.set(part.mesh.instanceColor!.array);
      // Capacity is buffer storage, not a shader variant. Keep the prepared mesh resident so a
      // seventeenth actor cannot requeue shaders and hide the sixteen actors already drawing.
      // Three's dispose listener frees these old instance buffers and VAOs before replacement;
      // its next object update installs the listener again and uploads the new attributes.
      part.mesh.dispose();
      part.mesh.instanceMatrix = matrices;
      part.mesh.instanceColor = colors;
    }
  }
}
