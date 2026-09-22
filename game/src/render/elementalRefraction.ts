import * as THREE from 'three/webgpu';
import { Fn, abs, atan, clamp, colorSpaceToWorking, dot, float, length, max, mix, normalize, positionView, pow, renderOutput, screenUV, sin, cos, smoothstep, texture, uniform, varying, vec2, vec3, vec4 } from 'three/tsl';
import { authoredFlow, clockUniform, matterNoise3 } from './elementalNodes.js';
import { inverseACES } from './biomeSky.js';
import { prepareShaderMeshes } from './shaderPreparation.js';

const REFRACTION_LAYER = 29;
const sources = new Set<THREE.Mesh>();
const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
placeholder.needsUpdate = true;
/** All refracting surfaces sample the same captured world frame. */
export const elementalRefractionScene = texture(placeholder);
export const elementalRefractionViewport = uniform(new THREE.Vector2(1, 1));
export const elementalRefractionExposure = uniform(1);
export const refractionDisplayColor = (hdr: THREE.Node) => renderOutput(hdr, THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace).rgb;
export const refractionHDRColor = (display: THREE.Node<"vec3">) => {
  // The upstream ColorSpaceNode declaration loses the input width; conversion retains RGB.
  const linear = colorSpaceToWorking(display, THREE.SRGBColorSpace) as unknown as THREE.Node<"vec3">;
  return inverseACES(linear, elementalRefractionExposure);
};

export function registerElementalRefraction(mesh: THREE.Mesh): () => void {
  mesh.layers.set(REFRACTION_LAYER); sources.add(mesh);
  return () => sources.delete(mesh);
}

export function isElementalRefractionObject(object: THREE.Object3D): boolean {
  return (object as THREE.Mesh).isMesh === true && object.layers.isEnabled(REFRACTION_LAYER);
}

export interface ElementalRefractionOptions {
  clock?: { value: number };
  liquid: boolean;
  strength: number;
  flowMode?: number;
  positionNode: THREE.Node<"vec3">;
  normalNode: THREE.Node<"vec3">;
  localNode: THREE.Node<"vec3">;
  alphaNode: THREE.Node<"float">;
  seedNode?: THREE.Node<"float">;
  viewNode?: THREE.Node<"vec3">;
  coverageNode?: THREE.Node<"float">;
}

/** Native spatial refraction, with authored turbulent flow and the existing liquid/air response. */
export function createElementalRefractionMaterial(options: ElementalRefractionOptions): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  material.name = options.liquid ? 'Elemental liquid refraction' : 'Elemental air refraction';
  material.positionNode = options.positionNode;
  const time = clockUniform(options.clock), local = varying(vec3(options.localNode));
  const normal = normalize(varying(vec3(options.normalNode))), view = normalize(vec3(options.viewNode ?? positionView.negate()));
  const alpha = varying(float(options.alphaNode)), seed = varying(float(options.seedNode ?? float(0)));
  const flowMode = options.flowMode ?? 0, liquid = options.liquid;
  material.fragmentNode = Fn(() => {
    let p = local.mul(3.2).add(vec3(seed, time.mul(liquid ? -2.7 : -1.6), time.mul(.3)));
    if (flowMode === 2) p = vec3(length(local.xz).mul(9), atan(local.z, local.x).mul(2).sub(time.mul(4)), local.y.mul(7));
    let flowingUv = vec2(atan(local.z, local.x).div(6.2831853).mul(2), local.y.mul(1.4));
    if (flowMode === 2) flowingUv = vec2(length(local.xz).mul(2).sub(time.mul(.16)), atan(local.z, local.x).div(6.2831853).mul(3).add(length(local.xz).mul(1.8)));
    if (!liquid && flowMode > .5) flowingUv = vec2(local.y.mul(2), atan(local.z, local.x).mul(.65).sub(local.y.mul(4)).sub(time.mul(.35)));
    const n = authoredFlow(flowingUv, time.mul(1.5), seed), n2 = matterNoise3(p.mul(2.03).add(4.1));
    const face = abs(dot(normal, view)), edge = pow(float(1).sub(face), 2);
    const wave = sin(local.y.mul(18).add(local.x.mul(5)).sub(time.mul(8)).add(n.mul(4)));
    const bend = normal.xy.mul(wave.mul(.7).add(.3)).add(vec2(n.sub(.5), n2.sub(.5)).mul(liquid ? 2.6 : 1.4));
    let coverage = alpha.mul(smoothstep(0, .15, face));
    if (liquid && flowMode > 2.5) coverage = coverage.mul(mix(1, smoothstep(.10, .46, n), smoothstep(.28, .76, local.y))).mul(float(1).sub(smoothstep(.80, .98, local.y)));
    if (liquid && flowMode === 1) coverage = coverage.mul(float(1).sub(smoothstep(.88, 1.03, abs(local.x)).mul(float(1).sub(smoothstep(.05, .45, n)))));
    if (options.coverageNode) coverage = coverage.mul(float(options.coverageNode));
    // WebGPU screen UV is top-down; convert the former fragment-coordinate bend accordingly.
    const shift = bend.mul(vec2(1, -1)).mul(options.strength).mul(coverage).div(elementalRefractionViewport);
    const refracted = refractionDisplayColor(elementalRefractionScene.sample(clamp(screenUV.add(shift), vec2(.002), vec2(.998)))).toVar();
    if (liquid) {
      const crest = smoothstep(.32, .85, local.y).mul(smoothstep(.32, .66, n));
      const flowingNormal = normalize(normal.add(vec3(sin(local.y.mul(15).sub(time.mul(6)).add(n.mul(5))), cos(local.x.mul(12).add(time.mul(4)).add(n.mul(3))), sin(local.z.mul(13).sub(time.mul(5)))).mul(.14)));
      const glint = pow(max(0, dot(flowingNormal, normalize(vec3(-.3, .8, .5)))), 22);
      const water = mix(vec3(.012, .065, .29), vec3(.04, .42, .78), smoothstep(.05, .7, n).mul(.7).add(face.mul(.15)));
      refracted.assign(mix(refracted.mul(vec3(.45, .84, 1)), water, edge.mul(.18).add(.58)));
      refracted.addAssign(vec3(.04, .19, .23).mul(smoothstep(.35, .68, n)).mul(face.mul(.65).add(.35)));
      refracted.addAssign(vec3(.63, .86, .95).mul(glint).mul(.8));
      const caustic = pow(sin(n.mul(32).add(local.y.mul(9)).sub(time.mul(5))).mul(.5).add(.5), 16);
      refracted.addAssign(vec3(.035, .20, .24).mul(caustic).mul(face.mul(.5).add(.35)));
      refracted.assign(mix(refracted, vec3(.73, .93, .97), crest.mul(.8)));
      if (flowMode > 2.5) refracted.assign(mix(refracted, vec3(.77, .94, .97), smoothstep(.50, .94, local.y).mul(smoothstep(.13, .5, n)).mul(.85)));
    } else {
      const leading = pow(float(1).sub(face), 2.7).mul(smoothstep(-.25, .65, local.z).mul(.65).add(.35));
      const vapor = flowMode > .5 ? smoothstep(.1, .62, n).mul(.55) : float(0);
      refracted.assign(mix(refracted, vec3(.045, .065, .095), vapor));
      refracted.assign(mix(refracted, vec3(.79, .91, .96), leading.mul(n.mul(.24).add(.10))));
      refracted.addAssign(vec3(.018, .023, .024).mul(edge).mul(n.mul(.75).add(.25)));
    }
    return vec4(refractionHDRColor(refracted), coverage);
  })();
  return material;
}

/** One world-color copy followed by depth-tested pressure and liquid surfaces. */
export class ElementalRefraction {
  enabled = true;
  private frame: THREE.FramebufferTexture | null = null;
  private readonly size = new THREE.Vector2();
  private rendered = false;
  private activeMeshes = 0;
  snapshot() {
    return { enabled: this.enabled, rendered: this.rendered, activeMeshes: this.activeMeshes,
      copies: this.rendered ? 1 : 0, width: this.frame?.image.width ?? 0, height: this.frame?.image.height ?? 0 };
  }
  async compile(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, root: THREE.Object3D,
    batchSize = 1, outputTarget?: THREE.RenderTarget): Promise<void> {
    const meshes: THREE.Mesh[] = [];
    root.traverse(object => { if (isElementalRefractionObject(object)) meshes.push(object as THREE.Mesh); });
    if (!meshes.length) return;
    const refractionCamera = camera.clone();
    refractionCamera.layers.set(REFRACTION_LAYER);
    await prepareShaderMeshes(renderer, scene, refractionCamera, meshes, { renderTarget: outputTarget ?? renderer.getRenderTarget(), batchSize });
  }
  render(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    this.rendered = false; this.activeMeshes = 0;
    if (!this.enabled) return;
    for (const mesh of sources) {
      let owner: THREE.Object3D = mesh, visible = true;
      while (owner.parent) { visible &&= owner.visible; owner = owner.parent; }
      if (owner === scene && visible && owner.visible) this.activeMeshes += 1;
    }
    if (!this.activeMeshes) return;
    renderer.getDrawingBufferSize(this.size);
    if (!this.frame || this.frame.image.width !== this.size.x || this.frame.image.height !== this.size.y) {
      this.frame?.dispose(); this.frame = new THREE.FramebufferTexture(this.size.x, this.size.y);
      this.frame.name = 'Elemental refraction scene color'; this.frame.colorSpace = THREE.NoColorSpace;
      this.frame.minFilter = this.frame.magFilter = THREE.LinearFilter;
    }
    elementalRefractionScene.value = this.frame;
    elementalRefractionViewport.value.copy(this.size);
    elementalRefractionExposure.value = renderer.toneMappingExposure;
    const mask = camera.layers.mask, background = scene.background, autoClear = renderer.autoClear, autoReset = renderer.info.autoReset;
    try {
      renderer.copyFramebufferToTexture(this.frame); camera.layers.set(REFRACTION_LAYER); scene.background = null;
      renderer.autoClear = false; renderer.info.autoReset = false;
      renderer.render(scene, camera); this.rendered = true;
    } finally {
      camera.layers.mask = mask; scene.background = background;
      renderer.autoClear = autoClear; renderer.info.autoReset = autoReset;
    }
  }
  dispose(): void { this.frame?.dispose(); }
}
