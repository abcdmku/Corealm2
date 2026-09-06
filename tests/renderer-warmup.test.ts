import * as THREE from "three";
import { expect, it } from "vitest";
import { Renderer } from "../game/src/render/renderer.js";

it("prepares screen and linear refraction programs without losing custom material hooks", () => {
  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial();
  material.customProgramCacheKey = () => "authored-wind";
  material.onBeforeCompile = shader => { shader.vertexShader += "// authored wind"; };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
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
    biomeAtmosphere: { sky, render() {} },
  }) as Renderer;
  renderer.drawFrame();
  expect(seen.at(-1)).toBeNull();expect(scene.background).toBe(background);
  sky.mesh.visible = false;renderer.drawFrame();expect(seen.at(-1)).toBe(background);
  sky.mesh.visible = true;scene.remove(sky.mesh);renderer.drawFrame();expect(seen.at(-1)).toBe(background);
});

