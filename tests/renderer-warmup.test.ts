import * as THREE from "three";
import { expect, it } from "vitest";
import { Renderer } from "../game/src/render/renderer.js";

it("prepares screen and linear refraction programs without losing custom material hooks", () => {
  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial();
  material.defines = { MATTER_KIND: 2 };
  material.customProgramCacheKey = () => "authored-wind";
  material.onBeforeCompile = shader => { shader.vertexShader += "// authored wind"; };
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 1);
  mesh.setColorAt(0, new THREE.Color(1, .5, .25));
  scene.add(mesh);
  const originalTarget = null;
  let target: THREE.WebGLRenderTarget | null = originalTarget;
  const calls: { offscreen: boolean; transparent: boolean; key: string; vertex: string }[] = [];
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene, camera: new THREE.PerspectiveCamera(), warmupMaterials: [],
    renderer: {
      getRenderTarget: () => target,
      setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next; },
      compile: () => scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const current = object.material as THREE.Material;
        expect(current.defines).toEqual(material.defines);
        expect((object as THREE.InstancedMesh).instanceColor).toBe(mesh.instanceColor);
        const shader = { vertexShader: "", fragmentShader: "", uniforms: {} };
        current.onBeforeCompile(shader as never, {} as never);
        calls.push({ offscreen: target !== null, transparent: current.transparent,
          key: current.customProgramCacheKey(), vertex: shader.vertexShader });
      }),
    },
  }) as Renderer;
  renderer.warmup({ transparentVariants: [mesh] });
  expect(calls).toHaveLength(4);
  expect(calls.filter(call => call.offscreen)).toHaveLength(2);
  expect(calls.every(call => call.key === "authored-wind" && call.vertex.includes("authored wind"))).toBe(true);
  expect(target).toBe(originalTarget);
  expect(scene.children).toEqual([mesh]);
  mesh.geometry.dispose();material.dispose();
});


it("skips only a fully covering procedural sky's background and restores scene state", () => {
  const scene = new THREE.Scene();
  const background = new THREE.Color(0x123456);scene.background = background;
  const sky = { enabled: true, mesh: new THREE.Mesh() };scene.add(sky.mesh);
  const seen: unknown[] = [];
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render: () => seen.push(scene.background) },
    playerSilhouette: { render() {} }, screenAntialiasing: { render() {} },
    elementalRefraction: { render() {} },
    magicGlow: { render() {}, renderBase(renderer: { render(): void }) { renderer.render(); } },
    biomeAtmosphere: { sky, render() {} },
  }) as Renderer;
  renderer.drawFrame();
  expect(seen.at(-1)).toBeNull();expect(scene.background).toBe(background);
  sky.mesh.visible = false;renderer.drawFrame();expect(seen.at(-1)).toBe(background);
  sky.mesh.visible = true;scene.remove(sky.mesh);renderer.drawFrame();expect(seen.at(-1)).toBe(background);
});

it("prepares hidden real effect meshes before drawing the base and glow passes", async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), root = new THREE.Group();
  root.visible = false;
  const material = new THREE.MeshBasicMaterial();
  material.customProgramCacheKey = () => "production-effect";
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 3);
  mesh.visible = false; mesh.count = 0;
  const light = new THREE.PointLight();
  root.add(mesh); scene.add(root, light);
  const unrelated = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshStandardMaterial());
  scene.add(unrelated);
  const geometry = mesh.geometry, parent = mesh.parent;
  const initialTarget = new THREE.WebGLRenderTarget(16, 16);
  let target: THREE.WebGLRenderTarget | null = initialTarget;
  let cubeFace = 2, mipLevel = 1;
  const calls: { object: THREE.Mesh; scene: THREE.Scene; output: number | null; material: THREE.Material | THREE.Material[] }[] = [];
  const order: string[] = [], queries = new Map<object, number>();
  const programs: { program: object; getUniforms(): void; getAttributes(): void }[] = [];
  let disposed = false;
  const fake = {
    info: { programs },
    getRenderTarget: () => target,
    getActiveCubeFace: () => cubeFace,
    getActiveMipmapLevel: () => mipLevel,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null, face = 0, level = 0) => {
      target = next; cubeFace = face; mipLevel = level;
    },
    getContext: () => ({
      getExtension: () => ({ COMPLETION_STATUS_KHR: 123 }),
      getProgramParameter: (program: object) => {
        const count = (queries.get(program) ?? 0) + 1;
        queries.set(program, count);
        return count > 1;
      },
    }),
    compile: (view: THREE.Object3D, viewCamera: THREE.Camera, targetScene: THREE.Scene) => {
      expect(viewCamera).toBe(camera);
      view.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        calls.push({ object, scene: targetScene, output: target?.texture.type ?? null, material: object.material });
      });
      if (target) target.addEventListener("dispose", () => { disposed = true; });
      const index = programs.length;
      const program = {};
      programs.push({ program,
        getUniforms: () => { expect(queries.get(program)).toBe(2); order.push(`uniforms-${index}`); },
        getAttributes: () => order.push(`attributes-${index}`),
      });
    },
    render: () => { order.push("base"); },
  };
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene, camera, renderer: fake,
    biomeAtmosphere: { sky: { enabled: false } },
    magicGlow: {
      renderBase: () => fake.render(),
      prepare: (actualRenderer: unknown, actualScene: THREE.Scene, actualCamera: THREE.Camera) => {
        expect(actualRenderer).toBe(fake); expect(actualScene).toBe(scene); expect(actualCamera).toBe(camera);
        order.push("glow");
      },
    },
  }) as Renderer;
  try {
    await renderer.prepareEffects(root);
    expect(calls).toEqual([
      { object: mesh, scene, output: null, material },
      { object: mesh, scene, output: THREE.HalfFloatType, material },
    ]);
    expect(order).toEqual(["uniforms-0", "attributes-0", "uniforms-1", "attributes-1", "base", "glow"]);
    expect(target).toBe(initialTarget); expect(disposed).toBe(true);
    expect(cubeFace).toBe(2); expect(mipLevel).toBe(1);
    expect(mesh.parent).toBe(parent); expect(mesh.geometry).toBe(geometry); expect(mesh.material).toBe(material);
    expect(mesh.visible).toBe(false); expect(mesh.count).toBe(0); expect(root.visible).toBe(false);
    expect(scene.children).toEqual([root, light, unrelated]);
  } finally {
    initialTarget.dispose(); geometry.dispose(); material.dispose();
    unrelated.geometry.dispose(); (unrelated.material as THREE.Material).dispose();
  }
});

