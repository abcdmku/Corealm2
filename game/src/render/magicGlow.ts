import * as THREE from "three/webgpu";
import { emissive, output, uniform, mix, vec4, vec3, texture, uv, smoothstep, max, float } from "three/tsl";
import { prepareShaderMeshes } from "./shaderPreparation.js";

const roots = new Set<THREE.Object3D>();
export function writesGlowOcclusion(material: THREE.Material | THREE.Material[]): boolean {
  return (Array.isArray(material) ? material : [material]).some(mat => mat.visible && (mat.depthWrite || mat.stencilWrite));
}
export function registerMagicGlow(root: THREE.Object3D): () => void {
  roots.add(root);
  return () => roots.delete(root);
}

/** Keep the normal lit surface in the base pass and use only its emission in the HDR pass. */
export function isolateMagicEmission(material: THREE.Material): void {
  const nodeMaterial = material as THREE.NodeMaterial;
  const emission = uniform(0);
  material.userData['magicEmissionPass'] = emission;
  nodeMaterial.outputNode = mix(nodeMaterial.outputNode ?? output, vec4(emissive, output.a), emission);
}

function target(name: string): THREE.RenderTarget {
  const result = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  result.texture.name = name;
  return result;
}
function fullscreen(name: string, fragmentNode: THREE.Node): THREE.QuadMesh {
  const material = new THREE.NodeMaterial({ depthTest: false, depthWrite: false, toneMapped: false });
  material.name = name;
  material.fragmentNode = fragmentNode;
  return new THREE.QuadMesh(material);
}

/** Selective HDR bloom. Ordinary geometry retains its own alpha, skinning and depth occlusion. */
export class MagicGlow {
  enabled = true;
  private readonly size = new THREE.Vector2();
  private readonly clearColour = new THREE.Color();
  private readonly target = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, samples: 4 });
  private frame = new THREE.FramebufferTexture(1, 1);
  private readonly frameNode = texture(this.frame);
  private readonly emissionNode = texture(this.target.texture);
  private readonly bright = target('Magic bloom bright');
  private readonly horizontal = Array.from({ length: 5 }, (_, i) => target(`Magic bloom horizontal ${i}`));
  private readonly vertical = Array.from({ length: 5 }, (_, i) => target(`Magic bloom vertical ${i}`));
  private readonly highPass: THREE.QuadMesh;
  private readonly blur: { quad: THREE.QuadMesh; input: ReturnType<typeof texture>; direction: ReturnType<typeof uniform<THREE.Vector2>> }[];
  private readonly composite: THREE.QuadMesh;
  private readonly occlusionMaterials = new Map<THREE.Material, { version: number; material: THREE.Material }>();
  private readonly occlusionObjects = new WeakMap<THREE.Object3D, THREE.Object3D>();
  private activeMeshes = 0;
  private rendered = false;

  constructor() {
    this.target.texture.name = 'Magic HDR emission';
    this.frame.colorSpace = THREE.NoColorSpace;
    const brightness = this.emissionNode.rgb.dot(vec3(.299, .587, .114));
    this.highPass = fullscreen('Magic bloom high pass', this.emissionNode.mul(smoothstep(.75, .76, brightness)));
    this.blur = [3, 5, 7, 9, 11].map((radius, index) => {
      const input = texture(this.bright.texture), direction = uniform(new THREE.Vector2());
      const sigma = radius / 3;
      const weights = Array.from({ length: radius }, (_, i) => .39894 * Math.exp(-.5 * i * i / (sigma * sigma)) / sigma);
      let sample = input.sample(uv()).rgb.mul(weights[0]!);
      let weight = weights[0]!;
      for (let i = 1; i < radius; i++) {
        const offset = direction.mul(i);
        sample = sample.add(input.sample(uv().add(offset)).rgb.add(input.sample(uv().sub(offset)).rgb).mul(weights[i]!));
        weight += weights[i]! * 2;
      }
      return { quad: fullscreen(`Magic bloom blur ${index}`, vec4(sample.div(weight), 1)), input, direction };
    });
    let halo = vec3(0);
    for (let i = 0; i < 5; i++) {
      const factor = 1 - i * .2, mixed = factor + (1.2 - 2 * factor) * .65;
      halo = halo.add(texture(this.vertical[i]!.texture).rgb.mul(mixed));
    }
    // Keep the emissive core and the five-scale halo, matching the selective HDR pass.
    const energy = max(vec3(0), this.emissionNode.rgb.add(halo.mul(1.25))).mul(.48);
    const peak = max(energy.r, max(energy.g, energy.b));
    const bounded = energy.div(max(.001, peak)).mul(float(1).sub(peak.negate().exp()));
    const base = this.frameNode;
    this.composite = fullscreen('Magic glow composite', vec4(base.rgb.add(float(1).sub(base.rgb).mul(bounded)), base.a));
  }

  async compile(renderer: THREE.WebGPURenderer, outputTarget?: THREE.RenderTarget): Promise<void> {
    const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    try {
      renderer.setRenderTarget(this.bright);
      await renderer.compileAsync(this.highPass, this.highPass.camera);
      for (let i = 0; i < this.blur.length; i++) {
        renderer.setRenderTarget(this.horizontal[i]!);
        await renderer.compileAsync(this.blur[i]!.quad, this.blur[i]!.quad.camera);
      }
      renderer.setRenderTarget(outputTarget ?? previous, face, mip);
      await renderer.compileAsync(this.composite, this.composite.camera);
    } finally { renderer.setRenderTarget(previous, face, mip); }
  }

  renderBase(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const hidden: THREE.Object3D[] = [];
    if (this.enabled) for (const root of roots) root.traverseVisible(object => {
      if (object.userData['magicGlowOnly']) { hidden.push(object); object.visible = false; }
    });
    try { renderer.render(scene, camera); }
    finally { for (const object of hidden) object.visible = true; }
  }

  snapshot() {
    return { enabled: this.enabled, activeMeshes: this.activeMeshes, rendered: this.rendered, hdr: true,
      width: this.target.width, height: this.target.height };
  }

  /** Prepare the HDR variants without mutating live material flags across an await. */
  async compileOcclusion(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, root: THREE.Object3D = scene): Promise<void> {
    const selected = this.select(scene), objects: THREE.Object3D[] = [];
    if (root !== scene) root.traverse(object => { if (object.userData.magicGlow) selected.add(object); });
    const maskedMaterial = (source: THREE.Material): THREE.Material => {
      const cached = this.occlusionMaterials.get(source);
      if (cached?.version === source.version) return cached.material;
      cached?.material.dispose();
      const data = source.userData;
      let material: THREE.Material;
      // Node graphs are shared; serializing live uniform references through userData is invalid.
      try { source.userData = {}; material = source.clone(); }
      finally { source.userData = data; }
      material.userData = { ...data }; material.colorWrite = false;
      this.occlusionMaterials.set(source, { version: source.version, material });
      return material;
    };
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material || !mesh.layers.test(camera.layers)) return;
      if (!selected.has(mesh) && !writesGlowOcclusion(mesh.material)) return;
      // Inherit geometry, skeleton, instances and live transforms without allocating duplicate
      // buffers or changing the real mesh's parent, material, visibility or layer during compilation.
      let proxy = this.occlusionObjects.get(mesh) as THREE.Mesh | undefined;
      if (!proxy) { proxy = Object.create(mesh) as THREE.Mesh; this.occlusionObjects.set(mesh, proxy); }
      proxy.material = selected.has(mesh) ? mesh.material : Array.isArray(mesh.material)
        ? mesh.material.map(maskedMaterial) : maskedMaterial(mesh.material);
      proxy.children = []; proxy.matrixWorldAutoUpdate = false;
      objects.push(proxy);
    });
    await prepareShaderMeshes(renderer, scene, camera, objects, { renderTarget: this.target });
  }

  /** Exercise the actual depth-aware bloom pyramid before the first visible spell. */
  async prepare(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, outputTarget?: THREE.RenderTarget): Promise<void> {
    const activeMeshes = this.activeMeshes, rendered = this.rendered;
    const output = outputTarget ?? renderer.getRenderTarget();
    await this.compileOcclusion(renderer, scene, camera);
    const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    try { renderer.setRenderTarget(output); this.draw(renderer, scene, camera, this.select(scene)); }
    finally { renderer.setRenderTarget(previous, face, mip); this.activeMeshes = activeMeshes; this.rendered = rendered; }
  }

  private select(scene: THREE.Scene): Set<THREE.Object3D> {
    const selected = new Set<THREE.Object3D>();
    for (const root of roots) {
      let owner: THREE.Object3D = root;
      while (owner.parent) owner = owner.parent;
      if (owner === scene) root.traverseVisible(object => { if (object.userData['magicGlow']) selected.add(object); });
    }
    return selected;
  }

  render(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    this.activeMeshes = 0; this.rendered = false;
    if (!this.enabled || !roots.size) return;
    const selected = this.select(scene);
    this.activeMeshes = selected.size;
    if (selected.size) this.draw(renderer, scene, camera, selected);
  }

  private mask(scene: THREE.Scene, selected: ReadonlySet<THREE.Object3D>): () => void {
    const muted = new Map<THREE.Material, boolean>(), skipped = new Map<THREE.Object3D, number>();
    const emissionUniforms = new Map<{ value: number }, number>();
    for (const object of selected) {
      const material = (object as THREE.Mesh).material;
      for (const mat of Array.isArray(material) ? material : [material]) {
        const emission = mat?.userData['magicEmissionPass'] as { value: number } | undefined;
        if (emission && !emissionUniforms.has(emission)) { emissionUniforms.set(emission, emission.value); emission.value = 1; }
      }
    }
    scene.traverseVisible(object => {
      if (selected.has(object)) return;
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      if (!writesGlowOcclusion(material)) { skipped.set(object, object.layers.mask); object.layers.mask = 0; return; }
      for (const mat of Array.isArray(material) ? material : [material]) {
        if (!muted.has(mat)) { muted.set(mat, mat.colorWrite); mat.colorWrite = false; }
      }
    });
    return () => {
      for (const [emission, value] of emissionUniforms) emission.value = value;
      for (const [material, value] of muted) material.colorWrite = value;
      for (const [object, value] of skipped) object.layers.mask = value;
    };
  }

  private draw(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, selected: ReadonlySet<THREE.Object3D>): void {
    renderer.getDrawingBufferSize(this.size);
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) {
      this.target.setSize(this.size.x, this.size.y);
      this.frame.dispose(); this.frame = new THREE.FramebufferTexture(this.size.x, this.size.y);
      this.frame.colorSpace = THREE.NoColorSpace; this.frameNode.value = this.frame;
      let width = Math.max(1, Math.round(this.size.x / 2)), height = Math.max(1, Math.round(this.size.y / 2));
      this.bright.setSize(width, height);
      for (let i = 0; i < 5; i++) {
        this.horizontal[i]!.setSize(width, height); this.vertical[i]!.setSize(width, height);
        width = Math.max(1, Math.round(width / 2)); height = Math.max(1, Math.round(height / 2));
      }
    }
    const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear, autoReset = renderer.info.autoReset, toneMapping = renderer.toneMapping;
    const shadows: { shadow: THREE.LightShadow; autoUpdate: boolean; needsUpdate: boolean }[] = [];
    scene.traverse(object => {
      const shadow = (object as THREE.DirectionalLight).shadow;
      if (shadow) shadows.push({ shadow, autoUpdate: shadow.autoUpdate, needsUpdate: shadow.needsUpdate });
    });
    const background = scene.background, clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColour);
    const restore = this.mask(scene, selected);
    try {
      renderer.copyFramebufferToTexture(this.frame);
      scene.background = null; renderer.setClearColor(0, 0);
      for (const { shadow } of shadows) { shadow.autoUpdate = false; shadow.needsUpdate = false; }
      renderer.info.autoReset = false; renderer.autoClear = true;
      renderer.setRenderTarget(this.target); renderer.render(scene, camera);
      renderer.setRenderTarget(this.bright); this.highPass.render(renderer);
      let input = this.bright;
      for (let i = 0; i < this.blur.length; i++) {
        const pass = this.blur[i]!, horizontal = this.horizontal[i]!, vertical = this.vertical[i]!;
        pass.input.value = input.texture; pass.direction.value.set(1 / horizontal.width, 0);
        renderer.setRenderTarget(horizontal); pass.quad.render(renderer);
        pass.input.value = horizontal.texture; pass.direction.value.set(0, 1 / vertical.height);
        renderer.setRenderTarget(vertical); pass.quad.render(renderer);
        input = vertical;
      }
      renderer.setRenderTarget(previous, face, mip); renderer.autoClear = false;
      renderer.toneMapping = THREE.NoToneMapping;
      this.composite.render(renderer); this.rendered = true;
    } finally {
      restore(); scene.background = background; renderer.setClearColor(this.clearColour, clearAlpha);
      for (const saved of shadows) { saved.shadow.autoUpdate = saved.autoUpdate; saved.shadow.needsUpdate = saved.needsUpdate; }
      renderer.setRenderTarget(previous, face, mip); renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset; renderer.toneMapping = toneMapping;
    }
  }

  dispose(): void {
    this.target.dispose(); this.frame.dispose(); this.bright.dispose();
    for (const { material } of this.occlusionMaterials.values()) material.dispose();
    this.occlusionMaterials.clear();
    for (const target of [...this.horizontal, ...this.vertical]) target.dispose();
    for (const quad of [this.highPass, ...this.blur.map(pass => pass.quad), this.composite]) quad.material.dispose();
  }
}
