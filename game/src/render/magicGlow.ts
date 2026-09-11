import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const roots = new Set<THREE.Object3D>();
export function registerMagicGlow(root: THREE.Object3D): () => void {
  roots.add(root);
  return () => roots.delete(root);
}

/** Lit surfaces contribute only their emission to bloom, preserving their shaded depth. */
export function isolateMagicEmission(material: THREE.Material): void {
  const emission = { value: 0 };
  material.userData["magicEmissionPass"] = emission;
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${cacheKey}|magic-emission`;
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    shader.uniforms["magicEmissionPass"] = emission;
    shader.fragmentShader =
      `uniform float magicEmissionPass;\n${shader.fragmentShader}`.replace(
        "#include <opaque_fragment>",
        "if(magicEmissionPass > .5) outgoingLight=totalEmissiveRadiance;\n#include <opaque_fragment>",
      );
  };
}

/** HDR emission with a soft bloom pyramid. The ordinary scene supplies occlusion only.
 * The daylight frame, sky and DOM remain outside the emission buffer.
 */
export class MagicGlow {
  enabled = true;
  private readonly size = new THREE.Vector2();
  private readonly clearColour = new THREE.Color();
  private target: THREE.WebGLRenderTarget | null = null;
  private frame: THREE.FramebufferTexture | null = null;
  private bloom: UnrealBloomPass | null = null;
  private readonly quad: FullScreenQuad;
  private readonly composite = new THREE.ShaderMaterial({
    name: "Magic glow composite",
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
    uniforms: {
      frame: { value: null },
      glow: { value: null },
      strength: { value: 0.48 },
    },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `uniform sampler2D frame,glow;uniform float strength;varying vec2 vUv;
      void main(){vec4 base=texture2D(frame,vUv);vec3 energy=max(vec3(0.),texture2D(glow,vUv).rgb)*strength;
        float peak=max(energy.r,max(energy.g,energy.b));
        vec3 halo=energy/max(.001,peak)*(1.0-exp(-peak));vec3 linear=pow(max(base.rgb,vec3(0.)),vec3(2.2));
        vec3 colour=linear+(1.0-linear)*halo;gl_FragColor=vec4(pow(colour,vec3(1.0/2.2)),base.a);}`,
  });
  private activeMeshes = 0;
  private rendered = false;
  constructor() {
    this.quad = new FullScreenQuad(this.composite);
  }
  /** Pure energy is composed once from HDR; shaded matter remains in the base scene. */
  renderBase(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): void {
    const hidden: THREE.Object3D[] = [];
    if (this.enabled)
      for (const root of roots)
        root.traverseVisible((object) => {
          if (object.userData["magicGlowOnly"]) {
            hidden.push(object);
            object.visible = false;
          }
        });
    try {
      renderer.render(scene, camera);
    } finally {
      for (const object of hidden) object.visible = true;
    }
  }
  snapshot() {
    return {
      enabled: this.enabled,
      activeMeshes: this.activeMeshes,
      rendered: this.rendered,
      hdr: true,
      width: this.target?.width ?? 0,
      height: this.target?.height ?? 0,
    };
  }
  /** Prepare the real HDR and bloom passes before the first gameplay effect is visible. */
  prepare(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const activeMeshes = this.activeMeshes, rendered = this.rendered;
    try {
      this.draw(renderer, scene, camera, new Set());
    } finally {
      this.activeMeshes = activeMeshes;
      this.rendered = rendered;
    }
  }
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): void {
    this.activeMeshes = 0;
    this.rendered = false;
    if (!this.enabled || !roots.size) return;
    const selected = new Set<THREE.Object3D>();
    for (const root of roots) {
      let owner: THREE.Object3D = root;
      while (owner.parent) owner = owner.parent;
      if (owner !== scene) continue;
      root.traverseVisible((object) => {
        if (object.userData["magicGlow"]) selected.add(object);
      });
    }
    this.activeMeshes = selected.size;
    if (!selected.size) return;
    this.draw(renderer, scene, camera, selected);
  }
  private draw(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    selected: ReadonlySet<THREE.Object3D>,
  ): void {
    renderer.getDrawingBufferSize(this.size);
    if (
      !this.target ||
      this.target.width !== this.size.x ||
      this.target.height !== this.size.y
    ) {
      this.target?.dispose();
      this.frame?.dispose();
      this.target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
        type: THREE.HalfFloatType,
        depthBuffer: true,
        samples: 4,
      });
      this.target.texture.name = "Magic HDR emission";
      this.frame = new THREE.FramebufferTexture(this.size.x, this.size.y);
      this.frame.colorSpace = THREE.NoColorSpace;
      this.bloom ??= new UnrealBloomPass(this.size, 1.25, 0.65, 0.75);
      this.bloom.setSize(this.size.x, this.size.y);
      this.composite.uniforms["frame"]!.value = this.frame;
      this.composite.uniforms["glow"]!.value = this.target.texture;
    }
    const previousTarget = renderer.getRenderTarget(),
      previousCubeFace = renderer.getActiveCubeFace(),
      previousMipmapLevel = renderer.getActiveMipmapLevel(),
      autoClear = renderer.autoClear,
      autoReset = renderer.info.autoReset;
    const shadowAuto = renderer.shadowMap.autoUpdate,
      shadowNeeds = renderer.shadowMap.needsUpdate;
    const background = scene.background,
      clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColour);
    const muted = new Map<THREE.Material, boolean>();
    const emissionUniforms = new Map<{ value: number }, number>();
    for (const object of selected) {
      const material = (object as THREE.Mesh).material;
      for (const mat of Array.isArray(material) ? material : [material]) {
        const uniform = mat?.userData["magicEmissionPass"] as
          | { value: number }
          | undefined;
        if (uniform && !emissionUniforms.has(uniform)) {
          emissionUniforms.set(uniform, uniform.value);
          uniform.value = 1;
        }
      }
    }
    // Retaining each opaque material's alpha test, skinning and displacement gives real occlusion.
    scene.traverseVisible((object) => {
      if (selected.has(object)) return;
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      for (const mat of Array.isArray(material) ? material : [material])
        if (!muted.has(mat)) {
          muted.set(mat, mat.colorWrite);
          mat.colorWrite = false;
        }
    });
    try {
      renderer.copyFramebufferToTexture(this.frame!);
      scene.background = null;
      renderer.setClearColor(0, 0);
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.info.autoReset = false;
      renderer.autoClear = true;
      renderer.setRenderTarget(this.target);
      renderer.clear();
      renderer.render(scene, camera);
      this.bloom!.render(renderer, this.target!, this.target!, 0, false);
      renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
      renderer.autoClear = false;
      this.quad.render(renderer);
      this.rendered = true;
    } finally {
      for (const [uniform, value] of emissionUniforms) uniform.value = value;
      for (const [material, colorWrite] of muted)
        material.colorWrite = colorWrite;
      scene.background = background;
      renderer.setClearColor(this.clearColour, clearAlpha);
      renderer.shadowMap.autoUpdate = shadowAuto;
      renderer.shadowMap.needsUpdate = shadowNeeds;
      renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
    }
  }
  dispose(): void {
    this.target?.dispose();
    this.frame?.dispose();
    this.bloom?.dispose();
    this.composite.dispose();
    this.quad.dispose();
  }
}
