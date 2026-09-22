import * as THREE from "three";
import type { MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from "three/webgpu";
import { bool, cameraPosition, clamp, distance, dot, float, floor, fract, max, mix, positionView,
  reference, screenCoordinate, screenSize, vec2 } from "three/tsl";
import { cloneNodeMaterial } from "./nodeMaterials.js";

const MARKER = "corealmFoliageOcclusion";
const FOOT_HEIGHT = 0.28;
const HEAD_HEIGHT = 1.58;
const BODY_RADIUS = 0.58;

/** A superset of every interpolated reveal circle, including float32 upload rounding. */
export function foliageRevealBounds(foot: THREE.Vector4, head: THREE.Vector4, output: THREE.Vector4): THREE.Vector4 {
  const radius = Math.max(foot.w, head.w);
  const padding = 1 + Math.max(Math.abs(foot.x), Math.abs(foot.y), Math.abs(head.x), Math.abs(head.y), radius) * 1e-6;
  return output.set(Math.min(foot.x, head.x) - radius - padding, Math.min(foot.y, head.y) - radius - padding,
    Math.max(foot.x, head.x) + radius + padding, Math.max(foot.y, head.y) + radius + padding);
}

/** One uniform set per material library. Updating it never walks meshes or changes material keys. */
export class FoliageOcclusion {
  readonly uniforms = {
    uCorealmFoliageRevealEnabled: { value: 0 },
    // xy are drawing-buffer pixels; z is positive camera depth; w is projected body radius.
    uCorealmFoliageRevealFoot: { value: new THREE.Vector4() },
    uCorealmFoliageRevealHead: { value: new THREE.Vector4() },
    uCorealmFoliageRevealCamera: { value: new THREE.Vector3() },
    uCorealmFoliageRevealBoundsEnabled: { value: 0 },
    uCorealmFoliageRevealBounds: { value: new THREE.Vector4() },
  };

  private readonly point = new THREE.Vector3();
  private readonly viewPoint = new THREE.Vector3();
  private valid = false;

  /** Call after the gameplay camera's world matrix is current. Reuse both input vectors. */
  update(
    camera: THREE.Camera,
    feet: THREE.Vector3,
    drawingBufferSize: THREE.Vector2,
    enabled = true,
  ): void {
    const finite = Number.isFinite(feet.x) && Number.isFinite(feet.y) && Number.isFinite(feet.z)
      && Number.isFinite(drawingBufferSize.x) && Number.isFinite(drawingBufferSize.y);
    this.valid = finite && drawingBufferSize.x > 0 && drawingBufferSize.y > 0;
    if (this.valid) {
      this.uniforms.uCorealmFoliageRevealCamera.value.setFromMatrixPosition(camera.matrixWorld);
      this.valid = this.project(camera, feet, FOOT_HEIGHT, drawingBufferSize,
        this.uniforms.uCorealmFoliageRevealFoot.value)
        && this.project(camera, feet, HEAD_HEIGHT, drawingBufferSize,
          this.uniforms.uCorealmFoliageRevealHead.value);
      if (this.valid) foliageRevealBounds(this.uniforms.uCorealmFoliageRevealFoot.value,
        this.uniforms.uCorealmFoliageRevealHead.value, this.uniforms.uCorealmFoliageRevealBounds.value);
    }
    this.setEnabled(enabled);
  }

  /** Disable for map captures and hidden-player views; enabling cannot revive an invalid pose. */
  setEnabled(enabled: boolean): void {
    this.uniforms.uCorealmFoliageRevealEnabled.value = enabled && this.valid ? 1 : 0;
  }

  get enabled(): boolean {
    return this.uniforms.uCorealmFoliageRevealEnabled.value > 0;
  }

  /** Default-off diagnostic candidate; the existing capsule and dither remain unchanged. */
  setBoundsOptimization(enabled: boolean): void {
    this.uniforms.uCorealmFoliageRevealBoundsEnabled.value = enabled ? 1 : 0;
  }

  /** Read-only presentation evidence. This does not claim a tree actually overlaps these pixels. */
  snapshot(): { enabled: boolean; foot: number[]; head: number[]; boundsOptimization: boolean; bounds: number[] } {
    return {
      enabled: this.enabled,
      foot: this.uniforms.uCorealmFoliageRevealFoot.value.toArray(),
      head: this.uniforms.uCorealmFoliageRevealHead.value.toArray(),
      boundsOptimization: this.uniforms.uCorealmFoliageRevealBoundsEnabled.value > 0.5,
      bounds: this.uniforms.uCorealmFoliageRevealBounds.value.toArray(),
    };
  }

  private project(
    camera: THREE.Camera,
    feet: THREE.Vector3,
    height: number,
    size: THREE.Vector2,
    output: THREE.Vector4,
  ): boolean {
    this.point.copy(feet);
    this.point.y += height;
    this.viewPoint.copy(this.point).applyMatrix4(camera.matrixWorldInverse);
    const depth = -this.viewPoint.z;
    if (!Number.isFinite(depth) || depth <= 0.1) return false;
    this.point.project(camera);
    const perspective = camera.projectionMatrix.elements[15] === 0;
    const radius = BODY_RADIUS * Math.abs(camera.projectionMatrix.elements[5]!)
      * size.y * 0.5 / (perspective ? depth : 1);
    if (!Number.isFinite(this.point.x) || !Number.isFinite(this.point.y) || !Number.isFinite(radius)) return false;
    output.set((this.point.x + 1) * size.x * 0.5, (this.point.y + 1) * size.y * 0.5, depth, radius);
    return true;
  }
}

/**
 * Caller owns caching/disposal and selects tree foliage or bark, excluding grass and animal hides.
 * The source's alpha, depth writing, textures, instancing and wind stay intact. Only its standard
 * colour mask changes; the shadow mask keeps the complete tree silhouette.
 * The camera-position guard also leaves map and other offscreen cameras untouched.
 */
export function createFoliageOcclusionMaterial(
  source: THREE.Material,
  state: FoliageOcclusion,
): THREE.Material {
  const standard = source as THREE.MeshStandardMaterial;
  const lit = standard.isMeshStandardMaterial
    || (source as MeshStandardNodeMaterial).isMeshStandardNodeMaterial
    || (source as MeshPhysicalNodeMaterial).isMeshPhysicalNodeMaterial;
  if (!lit || source.userData[MARKER] === true) return source;

  const derived = cloneNodeMaterial(source);
  derived.name = `${source.name || source.type}@foliage-reveal`;
  derived.userData[MARKER] = true;

  const enabled = reference("value", "float", state.uniforms.uCorealmFoliageRevealEnabled);
  const foot = reference("value", "vec4", state.uniforms.uCorealmFoliageRevealFoot);
  const head = reference("value", "vec4", state.uniforms.uCorealmFoliageRevealHead);
  const revealCamera = reference("value", "vec3", state.uniforms.uCorealmFoliageRevealCamera);
  const boundsEnabled = reference("value", "float", state.uniforms.uCorealmFoliageRevealBoundsEnabled);
  const bounds = reference("value", "vec4", state.uniforms.uCorealmFoliageRevealBounds);
  // TSL uses top-left screen coordinates on both backends. Projection uniforms use bottom-left.
  const pixel = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y));
  const axis = head.xy.sub(foot.xy);
  const t = clamp(dot(pixel.sub(foot.xy), axis).div(max(dot(axis, axis), 0.0001)), 0, 1);
  const centre = mix(foot.xy, head.xy, t);
  const radius = mix(foot.w, head.w, t);
  const depth = float(1).div(mix(float(1).div(foot.z), float(1).div(head.z), t));
  const noise = fract(fract(dot(floor(pixel), vec2(0.06711056, 0.00583715))).mul(52.9829189));
  const insideBounds = pixel.x.greaterThanEqual(bounds.x).and(pixel.y.greaterThanEqual(bounds.y))
    .and(pixel.x.lessThanEqual(bounds.z)).and(pixel.y.lessThanEqual(bounds.w));
  const reveal = enabled.greaterThan(0.5).and(distance(cameraPosition, revealCamera).lessThan(0.01))
    .and(boundsEnabled.lessThan(0.5).or(insideBounds))
    .and(positionView.z.negate().lessThan(depth.sub(0.12)))
    .and(distance(pixel, centre).lessThan(radius.mul(noise.mul(0.22).add(0.78))));

  // The opening is only a colour-pass mask. Shadow silhouettes keep the original mask.
  derived.maskShadowNode = derived.maskShadowNode ?? derived.maskNode ?? bool(true);
  derived.maskNode = derived.maskNode ? bool(derived.maskNode).and(reveal.not()) : reveal.not();
  return derived;
}
