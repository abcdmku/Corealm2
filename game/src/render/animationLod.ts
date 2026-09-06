import * as THREE from "three";
import { clone as cloneRigged } from "three/examples/jsm/utils/SkeletonUtils.js";

export interface LodPose {
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
}
interface Part {
  source: THREE.Material;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  depth: THREE.Material;
  distance: THREE.Material;
  mesh: THREE.InstancedMesh;
  triangles: number;
  palette: Palette;
}

const SAMPLE_HZ = 20;
const MAX_SAMPLES = 4096;
const MAX_TEXTURE_SIZE = 2048;
const WHITE = new THREE.Color(0xffffff);

// Both ordinary meshes (bone-attached equipment) and skinned meshes use this path.
// Matrices already contain the source mesh hierarchy and its skin bind transforms.
const PALETTE_SHADER = /* glsl */ `
uniform highp sampler2D lodPalette;
uniform int lodBoneCount;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec4 lodFrames;
attribute vec4 lodPreviousFrames;
varying float lodOpacity;

mat4 lodBoneAt(float frame, float bone) {
  int width = textureSize(lodPalette, 0).x;
  int address = (int(frame) * lodBoneCount + int(bone)) * 4;
  ivec2 uv = ivec2(address % width, address / width);
  return mat4(
    texelFetch(lodPalette, uv, 0),
    texelFetch(lodPalette, uv + ivec2(1, 0), 0),
    texelFetch(lodPalette, uv + ivec2(2, 0), 0),
    texelFetch(lodPalette, uv + ivec2(3, 0), 0)
  );
}
mat4 lodBetween(vec3 frames, float bone) {
  return lodBoneAt(frames.x, bone) * (1.0 - frames.z)
       + lodBoneAt(frames.y, bone) * frames.z;
}
mat4 lodBone(float bone) {
  mat4 current = lodBetween(lodFrames.xyz, bone);
  if (lodFrames.w >= 1.0) return current;
  return lodBetween(lodPreviousFrames.xyz, bone) * (1.0 - lodFrames.w)
       + current * lodFrames.w;
}
`;

const OPACITY_SHADER = /* glsl */ `
varying float lodOpacity;
const float lodBayer[16] = float[16](
   0.0,  8.0,  2.0, 10.0,
  12.0,  4.0, 14.0,  6.0,
   3.0, 11.0,  1.0,  9.0,
  15.0,  7.0, 13.0,  5.0
);
`;

const OPACITY_DISCARD = /* glsl */ `
if (lodOpacity < 1.0) {
  ivec2 lodPixel = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
  float lodThreshold = (lodBayer[lodPixel.y * 4 + lodPixel.x] + 0.5) / 16.0;
  if (lodOpacity < lodThreshold) discard;
}
`;

function wrapMaterial(material: THREE.Material, palette: Palette): void {
  const inheritedCompile = material.onBeforeCompile;
  const inheritedKey = material.customProgramCacheKey.call(material);
  material.onBeforeCompile = function (shader, renderer) {
    inheritedCompile.call(this, shader, renderer);
    shader.uniforms["lodPalette"] = { value: palette.texture };
    shader.uniforms["lodBoneCount"] = { value: palette.bones };
    shader.vertexShader = shader.vertexShader
      .replace("#include <skinning_pars_vertex>", PALETTE_SHADER)
      .replace("#include <skinbase_vertex>", /* glsl */ `
        lodOpacity = lodPreviousFrames.w;
        mat4 lodSkin = skinWeight.x * lodBone(skinIndex.x);
        if (skinWeight.y > 0.0) lodSkin += skinWeight.y * lodBone(skinIndex.y);
        if (skinWeight.z > 0.0) lodSkin += skinWeight.z * lodBone(skinIndex.z);
        if (skinWeight.w > 0.0) lodSkin += skinWeight.w * lodBone(skinIndex.w);
      `)
      .replace("#include <skinnormal_vertex>", /* glsl */ `
        mat3 lodBasis = mat3(lodSkin);
        mat3 lodNormal = abs(determinant(lodBasis)) > 1e-12
          ? transpose(inverse(lodBasis)) : lodBasis;
        objectNormal = lodNormal * objectNormal;
        #ifdef USE_TANGENT
          objectTangent = lodBasis * objectTangent;
        #endif
      `)
      .replace("#include <skinning_vertex>", "transformed = (lodSkin * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${OPACITY_SHADER}`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${OPACITY_DISCARD}`);
  };
  material.customProgramCacheKey = () => `${inheritedKey}|sampled-skeleton-v2`;
}

function ownedMaterial(source: THREE.Material): THREE.Material {
  const owned = source.clone();
  // Material.clone does not preserve application shader hooks.
  owned.onBeforeCompile = (shader, renderer) => source.onBeforeCompile.call(source, shader, renderer);
  owned.customProgramCacheKey = () => source.customProgramCacheKey.call(source);
  return owned;
}

function shadowMaterial(source: THREE.Material, distance: boolean): THREE.Material {
  const surface = source as THREE.MeshStandardMaterial;
  const result = distance ? new THREE.MeshDistanceMaterial() : new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  result.map = surface.map ?? null;
  result.alphaMap = surface.alphaMap ?? null;
  result.alphaTest = surface.alphaTest;
  result.side = surface.side;
  result.displacementMap = surface.displacementMap ?? null;
  result.displacementScale = surface.displacementScale ?? 1;
  result.displacementBias = surface.displacementBias ?? 0;
  result.clippingPlanes = surface.clippingPlanes;
  result.clipIntersection = surface.clipIntersection;
  result.clipShadows = surface.clipShadows;
  return result;
}

/** Shared sampled skeletal poses with small per-instance clip/phase attributes. */
export class AnimationLod {
  readonly sampleCount: number;
  private readonly samples = new Map<THREE.AnimationClip, ClipSamples>();
  private readonly palettes: Palette[] = [];
  private readonly parts: Part[] = [];
  private readonly slots = new Map<number, number>();
  private readonly rows: number[] = [];
  private capacity = 16;
  private frames = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  private previousFrames = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  private disposed = false;
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchColor = new THREE.Color();
  private samplingRoot: THREE.Object3D | null = null;
  private samplingAnimationRoot: THREE.Object3D | null = null;
  private samplingMixer: THREE.AnimationMixer | null = null;
  private samplingMeshes: THREE.Mesh[] = [];
  private samplingBounds: THREE.Box3[] = [];
  private readonly replayClips = new Map<THREE.AnimationClip, THREE.AnimationClip>();
  private readonly overlayFrames = new Map<number, number>();
  private readonly freeOverlayFrames: number[] = [];
  private overlayCapacity = 0;
  private overlayHighWater = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    root: THREE.Object3D,
    animationRoot: THREE.Object3D,
    clips: readonly THREE.AnimationClip[],
    materialFor: (source: THREE.Material) => THREE.Material,
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
        if (Object.values(mesh.geometry.morphAttributes).some((attributes) => attributes.length > 0)) {
          throw new Error(`AnimationLod requires skeletal animation; morph targets need a separate renderer: ${mesh.name}`);
        }
      }
      for (const mesh of meshes) this.palettes.push(this.allocatePalette(mesh));
      const skin = new THREE.Matrix4();
      const bind = new THREE.Matrix4();
      const transformedBounds = new THREE.Box3();
      const sourceBounds = meshes.map((mesh) => new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute("position") as THREE.BufferAttribute));
      this.samplingBounds = sourceBounds;
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
            for (let bone = 0; bone < palette.bones; bone++) {
              if (skinned.isSkinnedMesh) {
                bind.multiplyMatrices(mesh.matrixWorld, skinned.bindMatrixInverse);
                skin.multiplyMatrices(skinned.skeleton.bones[bone]!.matrixWorld, skinned.skeleton.boneInverses[bone]!);
                skin.premultiply(bind).multiply(skinned.bindMatrix);
              } else {
                skin.copy(mesh.matrixWorld);
              }
              skin.toArray(data, ((sample.offset + frame) * palette.bones + bone) * 16);
              // Weighted skinning and interpolation are convex combinations of these transforms.
              // Their union bounds all vertices, including transitions between different clips.
              transformedBounds.copy(sourceBounds[part]!).applyMatrix4(skin);
              palette.bounds.union(transformedBounds);
            }
          }
        }
      }
      for (let index = 0; index < meshes.length; index++) {
        const mesh = meshes[index]!;
        const original = originals[clones.indexOf(mesh)] as THREE.Mesh;
        this.createParts(original, this.palettes[index]!, materialFor);
      }
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      mixer.stopAllAction();
      // Retain this one shared clone for transient exact local-bone overlay composition.
    }
  }

  get drawCalls(): number { return this.rows.length ? this.parts.length : 0; }
  get triangles(): number { return this.rows.length * this.parts.reduce((sum, part) => sum + part.triangles, 0); }
  get textureBytes(): number { return this.palettes.reduce((sum, palette) => sum + (palette.texture.image.data as Float32Array).byteLength, 0); }

  set(slot: number, matrix: THREE.Matrix4, pose: LodPose, tintForMaterial?: (source: THREE.Material) => THREE.Color | null): void {
    if (this.disposed) throw new Error("AnimationLod has been disposed.");
    let current = this.frameAt(pose.clip, pose.time);
    const previous = pose.previousClip ? this.frameAt(pose.previousClip, pose.previousTime ?? 0) : current;
    const overlay = pose.overlay;
    if (overlay && (!Number.isFinite(overlay.time) || !Number.isFinite(overlay.weight))) throw new Error("AnimationLod requires finite overlay time and weight.");
    const hasOverlay = overlay !== undefined && overlay.weight > 0;
    if (hasOverlay) {
      if (overlay.clip.blendMode !== THREE.AdditiveAnimationBlendMode) throw new Error("AnimationLod overlay must be a masked additive clip.");
      if (!Number.isFinite(pose.time) || !Number.isFinite(pose.blend)
        || (pose.previousTime !== undefined && !Number.isFinite(pose.previousTime))) throw new Error("AnimationLod requires finite base clocks.");
      const frame = this.overlayFrame(slot);
      this.writeOverlay(frame, pose);
      current = [frame, frame, 0];
    } else this.releaseOverlayFrame(slot);
    let row = this.slots.get(slot);
    if (row === undefined) {
      row = this.rows.length;
      if (row === this.capacity) this.grow();
      this.slots.set(slot, row);
      this.rows.push(slot);
    }
    this.frames.setXYZW(row, current[0], current[1], current[2], !hasOverlay && pose.previousClip ? THREE.MathUtils.clamp(pose.blend, 0, 1) : 1);
    this.previousFrames.setXYZW(row, previous[0], previous[1], previous[2], THREE.MathUtils.clamp(pose.opacity ?? 1, 0, 1));
    this.frames.needsUpdate = true;
    this.previousFrames.needsUpdate = true;
    for (const part of this.parts) {
      part.mesh.setMatrixAt(row, matrix);
      part.mesh.setColorAt(row, tintForMaterial?.(part.source) ?? WHITE);
      part.mesh.count = this.rows.length;
      part.mesh.visible = true;
      part.mesh.instanceMatrix.needsUpdate = true;
      part.mesh.instanceColor!.needsUpdate = true;
      part.mesh.boundingSphere = null;
      part.mesh.boundingBox = null;
    }
  }

  hide(slot: number): void {
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.samplingMixer?.stopAllAction();
    if (this.samplingAnimationRoot) this.samplingMixer?.uncacheRoot(this.samplingAnimationRoot);
    for (const skeleton of new Set(this.samplingMeshes.filter((mesh) => (mesh as THREE.SkinnedMesh).isSkinnedMesh).map((mesh) => (mesh as THREE.SkinnedMesh).skeleton))) skeleton.dispose();
    this.samplingRoot = null;
    this.samplingAnimationRoot = null;
    this.samplingMixer = null;
    this.samplingMeshes = [];
    this.samplingBounds = [];
    this.replayClips.clear();
    this.overlayFrames.clear();
    this.freeOverlayFrames.length = 0;
    for (const part of this.parts) {
      part.mesh.removeFromParent();
      part.mesh.dispose();
      part.geometry.dispose();
      part.material.dispose();
      part.depth.dispose();
      part.distance.dispose();
    }
    for (const palette of this.palettes) palette.texture.dispose();
    this.parts.length = 0;
    this.palettes.length = 0;
    this.rows.length = 0;
    this.slots.clear();
  }

  private releaseOverlayFrame(slot: number): void {
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
  private writeOverlay(frame: number, pose: LodPose): void {
    const mixer = this.samplingMixer!, root = this.samplingRoot!, overlay = pose.overlay!;
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
    play(overlay.clip, overlay.time, THREE.MathUtils.clamp(overlay.weight, 0, 1), THREE.AdditiveAnimationBlendMode);
    mixer.update(0);
    root.updateMatrixWorld(true);
    const skin = new THREE.Matrix4(), bind = new THREE.Matrix4(), transformed = new THREE.Box3();
    for (let part = 0; part < this.samplingMeshes.length; part++) {
      const mesh = this.samplingMeshes[part]!, skinned = mesh as THREE.SkinnedMesh, palette = this.palettes[part]!;
      const data = palette.texture.image.data as Float32Array;
      for (let bone = 0; bone < palette.bones; bone++) {
        if (skinned.isSkinnedMesh) {
          bind.multiplyMatrices(mesh.matrixWorld, skinned.bindMatrixInverse);
          skin.multiplyMatrices(skinned.skeleton.bones[bone]!.matrixWorld, skinned.skeleton.boneInverses[bone]!);
          skin.premultiply(bind).multiply(skinned.bindMatrix);
        } else skin.copy(mesh.matrixWorld);
        skin.toArray(data, (frame * palette.bones + bone) * 16);
        transformed.copy(this.samplingBounds[part]!).applyMatrix4(skin);
        palette.bounds.union(transformed);
      }
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
    for (const part of this.parts) {
      part.geometry.boundingBox!.copy(part.palette.bounds);
      part.palette.bounds.getBoundingSphere(part.geometry.boundingSphere!);
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
    const bones = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh).skeleton.bones.length : 1;
    if (bones === 0) throw new Error(`AnimationLod has an empty skeleton: ${mesh.name}`);
    const texels = this.sampleCount * bones * 4;
    const width = Math.min(MAX_TEXTURE_SIZE, Math.max(4, THREE.MathUtils.ceilPowerOfTwo(Math.sqrt(texels))));
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
    const palette = { texture, bones, bounds: new THREE.Box3(), mirrored: mesh.matrixWorld.determinant() < 0, uploaded: false, dirtyFrames: new Set<number>() };
    texture.onUpdate = () => { palette.uploaded = true; palette.dirtyFrames.clear(); };
    return palette;
  }

  private createParts(mesh: THREE.Mesh, palette: Palette, materialFor: (source: THREE.Material) => THREE.Material): void {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const total = mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count;
    const groups = Array.isArray(mesh.material) && mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: total, materialIndex: 0 }];
    for (const group of groups) {
      const source = materials[group.materialIndex ?? 0];
      if (!source || !source.visible) continue;
      const geometry = mesh.geometry.clone();
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
      const start = Math.max(group.start, mesh.geometry.drawRange.start);
      const end = Math.min(group.start + group.count, mesh.geometry.drawRange.start + mesh.geometry.drawRange.count, total);
      geometry.setDrawRange(start, Math.max(0, end - start));
      if (!(mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        const vertexCount = geometry.getAttribute("position").count;
        const weights = new Float32Array(vertexCount * 4);
        for (let index = 0; index < vertexCount; index++) weights[index * 4] = 1;
        geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(vertexCount * 4), 4));
        geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
      }
      geometry.setAttribute("lodFrames", this.frames);
      geometry.setAttribute("lodPreviousFrames", this.previousFrames);
      geometry.boundingBox = palette.bounds.clone();
      geometry.boundingSphere = palette.bounds.getBoundingSphere(new THREE.Sphere());
      const material = ownedMaterial(materialFor(source));
      const depth = mesh.customDepthMaterial ? ownedMaterial(mesh.customDepthMaterial) : shadowMaterial(material, false);
      const distance = mesh.customDistanceMaterial ? ownedMaterial(mesh.customDistanceMaterial) : shadowMaterial(material, true);
      for (const pass of [material, depth, distance]) wrapMaterial(pass, palette);
      const part: Part = { source, geometry, material, depth, distance, mesh: null!, triangles: Math.floor(Math.max(0, end - start) / 3), palette };
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
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.customDepthMaterial = part.depth;
    mesh.customDistanceMaterial = part.distance;
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
      const next = this.makeMesh(part);
      next.instanceMatrix.array.set(part.mesh.instanceMatrix.array);
      next.instanceColor!.array.set(part.mesh.instanceColor!.array);
      part.mesh.removeFromParent();
      part.mesh.dispose();
      part.mesh = next;
      this.parent.add(next);
    }
  }
}
