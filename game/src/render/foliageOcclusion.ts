import * as THREE from "three";

const MARKER = "corealmFoliageOcclusion";
const FRAGMENT_ANCHOR = "#include <alphatest_fragment>";
const FOOT_HEIGHT = 0.28;
const HEAD_HEIGHT = 1.58;
const BODY_RADIUS = 0.58;

const FRAGMENT_HEADER = `
uniform float uCorealmFoliageRevealEnabled;
uniform vec4 uCorealmFoliageRevealFoot;
uniform vec4 uCorealmFoliageRevealHead;
uniform vec3 uCorealmFoliageRevealCamera;
`;

const FRAGMENT_BODY = `
// A small opening around the player only removes foliage in front of the body.
// Pixel coordinates keep this independent of InstancedMesh/BatchedMesh transforms and wind.
if ( uCorealmFoliageRevealEnabled > 0.5
  && distance( cameraPosition, uCorealmFoliageRevealCamera ) < 0.01 ) {
  vec2 revealAxis = uCorealmFoliageRevealHead.xy - uCorealmFoliageRevealFoot.xy;
  float revealT = clamp( dot( gl_FragCoord.xy - uCorealmFoliageRevealFoot.xy, revealAxis )
    / max( dot( revealAxis, revealAxis ), 0.0001 ), 0.0, 1.0 );
  vec2 revealCentre = mix( uCorealmFoliageRevealFoot.xy, uCorealmFoliageRevealHead.xy, revealT );
  float revealRadius = mix( uCorealmFoliageRevealFoot.w, uCorealmFoliageRevealHead.w, revealT );
  // Perspective-correct depth along the projected body segment, in camera-space metres.
  float revealDepth = 1.0 / mix( 1.0 / uCorealmFoliageRevealFoot.z,
    1.0 / uCorealmFoliageRevealHead.z, revealT );
  if ( vViewPosition.z < revealDepth - 0.12 ) {
    float revealNoise = fract( 52.9829189 * fract( dot( floor( gl_FragCoord.xy ),
      vec2( 0.06711056, 0.00583715 ) ) ) );
    float revealEdge = revealRadius * ( 0.78 + 0.22 * revealNoise );
    if ( distance( gl_FragCoord.xy, revealCentre ) < revealEdge ) discard;
  }
}
`;

/** One uniform set per material library. Updating it never walks meshes or changes material keys. */
export class FoliageOcclusion {
  readonly uniforms = {
    uCorealmFoliageRevealEnabled: { value: 0 },
    // xy are drawing-buffer pixels; z is positive camera depth; w is projected body radius.
    uCorealmFoliageRevealFoot: { value: new THREE.Vector4() },
    uCorealmFoliageRevealHead: { value: new THREE.Vector4() },
    uCorealmFoliageRevealCamera: { value: new THREE.Vector3() },
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

  /** Read-only presentation evidence. This does not claim a tree actually overlaps these pixels. */
  snapshot(): { enabled: boolean; foot: number[]; head: number[] } {
    return {
      enabled: this.enabled,
      foot: this.uniforms.uCorealmFoliageRevealFoot.value.toArray(),
      head: this.uniforms.uCorealmFoliageRevealHead.value.toArray(),
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
 * colour shader changes; Three's separate shadow/depth materials keep the complete tree silhouette.
 * The camera-position guard also leaves map and other offscreen cameras untouched.
 */
export function createFoliageOcclusionMaterial(
  source: THREE.Material,
  state: FoliageOcclusion,
): THREE.Material {
  const standard = source as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial || source.userData[MARKER] === true) return source;

  const derived = standard.clone();
  const inheritedCompile = source.onBeforeCompile;
  const inheritedProgramKey = source.customProgramCacheKey.bind(source);
  derived.name = `${source.name || source.type}@foliage-reveal`;
  derived.userData[MARKER] = true;
  derived.onBeforeCompile = (shader, renderer) => {
    inheritedCompile.call(source, shader, renderer);
    if (!shader.fragmentShader.includes(FRAGMENT_ANCHOR)) {
      throw new Error(`Foliage reveal has no alpha insertion point: ${source.name || source.type}`);
    }
    Object.assign(shader.uniforms, state.uniforms);
    shader.fragmentShader = `${FRAGMENT_HEADER}\n${shader.fragmentShader}`.replace(
      FRAGMENT_ANCHOR,
      `${FRAGMENT_ANCHOR}\n${FRAGMENT_BODY}`,
    );
  };
  derived.customProgramCacheKey = () => `${inheritedProgramKey()}|corealm-foliage-reveal-v1`;
  return derived;
}
