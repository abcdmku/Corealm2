import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compileShadowMeshes } from "../game/src/render/shaderPreparation.js";
import { SpellVfx } from "../game/src/render/spellVfx.js";

function retainedMaterials() {
  const clones = new Map<THREE.Material, THREE.Material>();
  const hooks = new Map<THREE.Material, THREE.Material["onBeforeCompile"]>();
  return {
    clones, hooks,
    compile: (source: THREE.Material) => {
      let clone = clones.get(source);
      if (!clone) {
        clone = source.clone();
        clone.onBeforeCompile = source.onBeforeCompile.bind(source);
        clone.customProgramCacheKey = source.customProgramCacheKey.bind(source);
        clones.set(source, clone); hooks.set(clone, clone.onBeforeCompile);
      }
      return clone;
    },
    dispose: () => { for (const clone of clones.values()) clone.dispose(); },
  };
}

describe("shared shadow shader preparation", () => {
  it("executes every hidden Earth depth hook using real meshes and restores their surface materials", () => {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const visibleLights = [new THREE.DirectionalLight(), new THREE.PointLight()];
    const hidden = new THREE.Group(); hidden.visible = false; hidden.add(new THREE.SpotLight());
    scene.add(...visibleLights, hidden);
    scene.fog = new THREE.Fog(0xabcdef, 1, 10);
    scene.environment = new THREE.Texture(); scene.background = new THREE.Color(0xabcdef);
    const vfx = new SpellVfx({ parent: scene, camera, groundHeightAt: () => 0 });
    const meshes: THREE.Mesh[] = [];
    vfx.preparationRoot().traverse(object => {
      if ((object as THREE.Mesh).isMesh && (object as THREE.Mesh).customDepthMaterial) meshes.push(object as THREE.Mesh);
    });
    const originals = new Map(meshes.map(mesh => [mesh, { material: mesh.material, depth: mesh.customDepthMaterial, parent: mesh.parent }]));
    const compiled = new Map<string, { vertex: string; uniforms: Record<string, unknown> }>();
    const materials = retainedMaterials(), fallback = new THREE.MeshDepthMaterial();
    const allVisibleLights: THREE.Object3D[] = [];
    scene.traverseVisible(object => { if ((object as THREE.Light).isLight) allVisibleLights.push(object); });
    const renderer = {
      compile: (view: THREE.Object3D, viewCamera: THREE.Camera, shadowScene: THREE.Scene) => {
        expect(viewCamera).toBe(camera);
        expect(shadowScene.fog).toBeNull(); expect(shadowScene.environment).toBeNull(); expect(shadowScene.background).toBeNull();
        const lights: THREE.Object3D[] = [];
        shadowScene.traverseVisible(object => { if ((object as THREE.Light).isLight) lights.push(object); });
        expect(lights).toEqual(allVisibleLights);
        view.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          const original = originals.get(object)!;
          expect(object.parent).toBe(original.parent); expect(object.visible).toBe(false);
          const depth = object.material as THREE.MeshDepthMaterial;
          expect(depth).not.toBe(original.depth);
          expect(depth.depthPacking).toBe(THREE.RGBADepthPacking);
          expect(depth.customProgramCacheKey()).toBe(original.depth!.customProgramCacheKey());
          const shader = { vertexShader: THREE.ShaderLib.depth.vertexShader,
            fragmentShader: THREE.ShaderLib.depth.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> };
          depth.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, renderer);
          compiled.set(object.name, { vertex: shader.vertexShader, uniforms: shader.uniforms });
        });
      },
    } as unknown as THREE.WebGLRenderer;
    try {
      expect(meshes).toHaveLength(9);
      compileShadowMeshes(renderer, scene, camera, meshes, materials.compile, fallback);
      expect(compiled.size).toBe(meshes.length);
      for (const name of ["elemental-basic-pebble", "elemental-flint-connected-fracture", "elemental-siege-connected-fracture"]) {
        expect(compiled.get(name)!.vertex).toContain("fractureTurn");
        expect(compiled.get(name)!.uniforms).toHaveProperty("shatterTime");
        expect(compiled.get(name)!.uniforms).toHaveProperty("fractureFade");
      }
      for (let index = 0; index < 5; index++) {
        const shader = compiled.get(`elemental-mountain-fracture-outcrop-${index}`)!;
        expect(shader.vertex).toContain("rockInverseModel");
        expect(shader.uniforms).toHaveProperty("rockCollapse");
        expect(shader.uniforms).toHaveProperty("fractureFade");
      }
      expect(compiled.get("elemental-fault-travelling-ridge")!.uniforms).toHaveProperty("faultFront");
      for (const [mesh, original] of originals) {
        expect(mesh.material).toBe(original.material); expect(mesh.customDepthMaterial).toBe(original.depth);
      }
      for (const clone of materials.clones.values()) expect(clone.onBeforeCompile).toBe(materials.hooks.get(clone));
    } finally { materials.dispose(); fallback.dispose(); vfx.dispose(); scene.environment.dispose(); }
  });

  it("copies surface shadow parameters, skips non-casters, and restores material arrays on compile failure", () => {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const texture = new THREE.Texture(), planes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 2)];
    const surfaces = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide].map(side => new THREE.MeshStandardMaterial({
      side, map: texture, alphaMap: texture, alphaTest: 0.3, displacementMap: texture,
      displacementScale: 0.7, displacementBias: -0.2, clippingPlanes: planes, clipShadows: true, clipIntersection: true, wireframe: true,
    }));
    surfaces[1]!.alphaToCoverage = true; surfaces[2]!.shadowSide = THREE.FrontSide;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), surfaces), skipped = new THREE.Mesh();
    mesh.castShadow = true; scene.add(mesh, skipped);
    const materials = retainedMaterials(), fallback = new THREE.MeshDepthMaterial();
    let calls = 0;
    const renderer = {
      compile: (view: THREE.Object3D) => view.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        expect(object).toBe(mesh);
        const depth = object.material as THREE.MeshDepthMaterial;
        expect(depth.side).toBe([THREE.BackSide, THREE.FrontSide, THREE.FrontSide][calls]);
        expect(depth.alphaTest).toBe(calls === 1 ? 0.5 : 0.3);
        expect(depth.map).toBe(texture); expect(depth.alphaMap).toBe(texture); expect(depth.displacementMap).toBe(texture);
        expect(depth.displacementScale).toBe(0.7); expect(depth.displacementBias).toBe(-0.2);
        expect(depth.clippingPlanes).toBe(planes); expect(depth.clipShadows).toBe(true);
        expect(depth.clipIntersection).toBe(true); expect(depth.wireframe).toBe(true);
        calls++;
        if (calls === 3) throw new Error("shadow compile failed");
      }),
    } as unknown as THREE.WebGLRenderer;
    try {
      expect(() => compileShadowMeshes(renderer, scene, camera, [skipped, mesh], materials.compile, fallback)).toThrow("shadow compile failed");
      expect(calls).toBe(3); expect(mesh.material).toBe(surfaces);
      expect(mesh.parent).toBe(scene); expect(skipped.parent).toBe(scene);
    } finally {
      materials.dispose(); fallback.dispose(); texture.dispose(); mesh.geometry.dispose();
      for (const surface of surfaces) surface.dispose();
      skipped.geometry.dispose(); (skipped.material as THREE.Material).dispose();
    }
  });
});
