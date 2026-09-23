import * as THREE from "three/webgpu";
import { emissive, output, uniform, mix, vec4, vec3, texture, uv, smoothstep, max, float } from "three/tsl";
import { prepareShaderMeshes } from "./shaderPreparation.js";
import { cloneNodeMaterial } from "./nodeMaterials.js";

const roots = new Set<THREE.Object3D>();

type PreparedMesh = {
  geometry: THREE.BufferGeometry;
  materials: { material: THREE.Material; version: number }[];
};

export interface MagicGlowPreparation {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly renderTarget: THREE.RenderTarget;
  readonly context: string;
  readonly meshes: ReadonlyMap<THREE.Object3D, PreparedMesh>;
}

type OcclusionPreparationDiagnostic = {
  backend: "native" | "webgl-fallback";
  candidateProxies: number;
  preparedProxies: number;
  deduplicatedProxies: number;
};

function preparationContext(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, target: THREE.RenderTarget): string {
  const lights: string[] = [];
  scene.traverseVisible(object => {
    if ((object as THREE.Light).isLight && object.layers.test(camera.layers)) lights.push(`${object.uuid}:${object.castShadow}`);
  });
  return [camera.layers.mask, renderer.toneMapping, renderer.outputColorSpace, renderer.shadowMap.enabled, renderer.shadowMap.type,
    scene.fog?.constructor.name, scene.environment?.uuid, scene.overrideMaterial?.uuid, scene.overrideMaterial?.version,
    target.samples, target.depthBuffer, target.stencilBuffer, target.textures.length, target.texture.type,
    target.texture.format, target.texture.colorSpace, ...lights].join(':');
}

/** Capture before base preparation; pass the token only after that preparation succeeds. */
export function captureMagicGlowPreparation(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera,
  renderTarget: THREE.RenderTarget, objects: readonly THREE.Object3D[]): MagicGlowPreparation {
  const meshes = new Map<THREE.Object3D, PreparedMesh>();
  for (const object of objects) {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) meshes.set(mesh, { geometry: mesh.geometry,
      materials: (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => ({ material, version: material.version })) });
  }
  return { renderer, scene, camera, renderTarget, meshes, context: preparationContext(renderer, scene, camera, renderTarget) };
}

function samePreparedMesh(object: THREE.Mesh, prepared: MagicGlowPreparation | undefined): boolean {
  const saved = prepared?.meshes.get(object);
  if (!saved || saved.geometry !== object.geometry) return false;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.length === saved.materials.length && materials.every((material, index) => {
    const previous = saved.materials[index]!;
    return material === previous.material && material.version === previous.version;
  });
}

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
  nodeMaterial.outputNode = mix((nodeMaterial.outputNode as THREE.Node<"vec4"> | null) ?? output, vec4(emissive, output.a), emission);
}

function target(name: string): THREE.RenderTarget {
  const result = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  result.texture.name = name;
  return result;
}
function fullscreen(name: string, fragmentNode: THREE.Node): THREE.QuadMesh {
  const material = Object.assign(new THREE.NodeMaterial(), { depthTest: false, depthWrite: false, toneMapped: false });
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
  private readonly blur: { quad: THREE.QuadMesh; input: ReturnType<typeof texture>; direction: THREE.UniformNode<"vec2", THREE.Vector2> }[];
  private readonly composite: THREE.QuadMesh;
  private readonly occlusionMaterials = new Map<THREE.Material, { version: number; material: THREE.Material }>();
  private readonly occlusionObjects = new WeakMap<THREE.Object3D, THREE.Object3D>();
  private lastOcclusionPreparation: OcclusionPreparationDiagnostic = {
    backend: "native", candidateProxies: 0, preparedProxies: 0, deduplicatedProxies: 0,
  };
  private frameTarget: THREE.RenderTarget | null = null;
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
    let halo: THREE.Node<"vec3"> = vec3(0);
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
    this.frameTarget = outputTarget ?? renderer.getRenderTarget();
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
      width: this.target.width, height: this.target.height,
      occlusionPreparation: { ...this.lastOcclusionPreparation } };
  }

  /** Only plain static meshes share a compiler variant. Keep per-object bindings separate. */
  private canShareOcclusionShader(mesh: THREE.Mesh): boolean {
    const binding = mesh as THREE.Mesh & {
      isSkinnedMesh?: boolean;
      isInstancedMesh?: boolean;
      isBatchedMesh?: boolean;
      skeleton?: object;
      instanceMatrix?: object;
      morphTexture?: object | null;
      morphTargetInfluences?: readonly number[];
    };
    return mesh.type === "Mesh"
      && !binding.isSkinnedMesh && !binding.isInstancedMesh && !binding.isBatchedMesh
      && !binding.skeleton && !binding.instanceMatrix && !binding.morphTexture
      && !binding.morphTargetInfluences?.length
      && Object.keys(mesh.geometry.morphAttributes).length === 0
      && mesh.onBeforeRender === THREE.Object3D.prototype.onBeforeRender
      && mesh.onAfterRender === THREE.Object3D.prototype.onAfterRender;
  }

  /** Repeated placements with the same geometry, materials and mesh features compile identically. */
  private deduplicateOcclusionProxies(objects: readonly THREE.Object3D[]): THREE.Object3D[] {
    const variants = new Map<THREE.BufferGeometry, Set<string>>();
    const materialIds = new WeakMap<THREE.Material, number>();
    let nextMaterialId = 1;
    const materialId = (material: THREE.Material): number => {
      let id = materialIds.get(material);
      if (id === undefined) { id = nextMaterialId++; materialIds.set(material, id); }
      return id;
    };
    const unique: THREE.Object3D[] = [];
    for (const object of objects) {
      const mesh = object as THREE.Mesh;
      if (!this.canShareOcclusionShader(mesh)) { unique.push(object); continue; }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const materialKey = materials.map(material => `${materialId(material)}:${material.version}`).join(",");
      const objectBindings = mesh as THREE.Mesh & {
        customDepthMaterial?: THREE.Material;
        customDistanceMaterial?: THREE.Material;
      };
      const shadowMaterials = [objectBindings.customDepthMaterial, objectBindings.customDistanceMaterial]
        .map(material => material ? `${materialId(material)}:${material.version}` : "-").join(",");
      const variant = [mesh.type, mesh.receiveShadow, mesh.castShadow, mesh.frustumCulled, mesh.renderOrder,
        shadowMaterials,
        materialKey, materials.length].join(":");
      let keys = variants.get(mesh.geometry);
      if (!keys) { keys = new Set(); variants.set(mesh.geometry, keys); }
      if (keys.has(variant)) continue;
      keys.add(variant);
      unique.push(object);
    }
    return unique;
  }

  private nativeDepthReuse(renderer: THREE.WebGPURenderer): boolean {
    return (renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend !== true;
  }

  /** Native emitters reuse the prepared world depth; fallback retains its separate depth pass. */
  async compileOcclusion(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, root: THREE.Object3D = scene,
    batchSize = 1, outputTarget?: THREE.RenderTarget, prepared?: MagicGlowPreparation): Promise<void> {
    const selected = this.select(scene), objects: THREE.Object3D[] = [];
    if (root !== scene) root.traverse(object => { if (object.userData.magicGlow) selected.add(object); });
    if (this.nativeDepthReuse(renderer)) {
      const output = outputTarget ?? this.frameTarget ?? renderer.getRenderTarget();
      if (!output) throw new Error('Native magic glow requires the main depth/stencil target');
      const reusable = prepared?.renderer === renderer && prepared.scene === scene && prepared.camera === camera
        && prepared.renderTarget === output && prepared.context === preparationContext(renderer, scene, camera, output) ? prepared : undefined;
      root.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh && mesh.material && selected.has(mesh) && mesh.layers.test(camera.layers) && !samePreparedMesh(mesh, reusable)) objects.push(mesh);
      });
      this.lastOcclusionPreparation = { backend: "native", candidateProxies: objects.length,
        preparedProxies: objects.length, deduplicatedProxies: 0 };
      // Actual draw identities and the main target's depth/stencil/sample format are reused.
      // Ordinary world geometry never enters the emission preparation queue.
      if (objects.length) await prepareShaderMeshes(renderer, scene, camera, objects, { renderTarget: output, batchSize });
      return;
    }
    const maskedMaterial = (source: THREE.Material): THREE.Material => {
      const cached = this.occlusionMaterials.get(source);
      if (cached?.version === source.version) return cached.material;
      cached?.material.dispose();
      const material = cloneNodeMaterial(source);
      material.colorWrite = false;
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
    const preparedObjects = this.deduplicateOcclusionProxies(objects);
    this.lastOcclusionPreparation = { backend: "webgl-fallback", candidateProxies: objects.length,
      preparedProxies: preparedObjects.length, deduplicatedProxies: objects.length - preparedObjects.length };
    await prepareShaderMeshes(renderer, scene, camera, preparedObjects, { renderTarget: this.target, batchSize });
  }

  /** Exercise the actual depth-aware bloom pyramid before the first visible spell. */
  async prepare(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, outputTarget?: THREE.RenderTarget,
    batchSize = 1, prepared?: MagicGlowPreparation): Promise<void> {
    const activeMeshes = this.activeMeshes, rendered = this.rendered;
    const output = outputTarget ?? this.frameTarget ?? renderer.getRenderTarget();
    this.frameTarget = output;
    await this.compileOcclusion(renderer, scene, camera, scene, batchSize, output ?? undefined, prepared);
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

  private mask(scene: THREE.Scene, selected: ReadonlySet<THREE.Object3D>, occluders: boolean): () => void {
    const muted = new Map<THREE.Material, boolean>(), skipped = new Map<THREE.Object3D, number>();
    const emissionUniforms = new Map<{ value: number }, number>();
    for (const object of selected) {
      const material = (object as THREE.Mesh).material;
      for (const mat of Array.isArray(material) ? material : [material]) {
        const emission = mat?.userData['magicEmissionPass'] as { value: number } | undefined;
        if (emission && !emissionUniforms.has(emission)) { emissionUniforms.set(emission, emission.value); emission.value = 1; }
      }
    }
    if (occluders) scene.traverseVisible(object => {
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
      // Native rendering attaches this color texture to the main target, so its holder
      // may never be initialized as a target. Dispose the texture explicitly on resize.
      this.target.texture.dispose(); this.target.texture.needsUpdate = true;
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
    const native = this.nativeDepthReuse(renderer);
    if (native && (!previous || !previous.depthBuffer || previous.textures.length !== 1))
      throw new Error('Native magic glow requires one main color attachment and retained scene depth');
    if (native && (previous!.samples !== this.target.samples || previous!.texture.type !== this.target.texture.type
      || previous!.texture.format !== this.target.texture.format))
      throw new Error('Magic emission must match the main target color format and MSAA samples');
    const baseTexture = previous?.texture;
    const renderObject = native ? renderer.getRenderObjectFunction() : null;
    const restore = this.mask(scene, selected, !native);
    try {
      renderer.copyFramebufferToTexture(this.frame);
      scene.background = null; renderer.setClearColor(0, 0);
      for (const { shadow } of shadows) { shadow.autoUpdate = false; shadow.needsUpdate = false; }
      renderer.info.autoReset = false;
      if (native) {
        // One target owns the MSAA depth/stencil attachment. Only color changes, and
        // r185 caches backend attachment descriptors by their color texture IDs.
        // This avoids shared-depth disposal/reallocation and preserves per-sample coverage.
        previous!.texture = this.target.texture;
        renderer.autoClear = false;
        renderer.clear(true, false, false);
        renderer.setRenderObjectFunction((...args) => {
          if (selected.has(args[0])) (renderObject ?? renderer.renderObject).apply(renderer, args);
        });
        try { renderer.render(scene, camera); }
        finally {
          renderer.setRenderObjectFunction(renderObject);
          previous!.texture = baseTexture!;
        }
      } else {
        renderer.autoClear = true;
        renderer.setRenderTarget(this.target); renderer.render(scene, camera);
      }
      renderer.autoClear = true;
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
      if (native) {
        renderer.setRenderObjectFunction(renderObject);
        previous!.texture = baseTexture!;
      }
      restore(); scene.background = background; renderer.setClearColor(this.clearColour, clearAlpha);
      for (const saved of shadows) { saved.shadow.autoUpdate = saved.autoUpdate; saved.shadow.needsUpdate = saved.needsUpdate; }
      renderer.setRenderTarget(previous, face, mip); renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset; renderer.toneMapping = toneMapping;
    }
  }

  dispose(): void {
    this.target.dispose(); this.target.texture.dispose(); this.frame.dispose(); this.bright.dispose();
    for (const { material } of this.occlusionMaterials.values()) material.dispose();
    this.occlusionMaterials.clear();
    for (const target of [...this.horizontal, ...this.vertical]) target.dispose();
    for (const quad of [this.highPass, ...this.blur.map(pass => pass.quad), this.composite]) {
      for (const material of Array.isArray(quad.material) ? quad.material : [quad.material]) material.dispose();
    }
  }
}
