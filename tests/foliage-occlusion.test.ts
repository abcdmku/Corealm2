import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createArtDirectedMaterial } from "../game/src/render/artDirection.js";
import { createFoliageOcclusionMaterial, FoliageOcclusion } from "../game/src/render/foliageOcclusion.js";

function cameraAt(distance: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 200);
  camera.position.set(0, 1, distance);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  return camera;
}

function shaderInput(): Parameters<THREE.Material["onBeforeCompile"]>[0] {
  return {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as Parameters<THREE.Material["onBeforeCompile"]>[0];
}

describe("foliage player reveal", () => {
  it("projects the body in drawing-buffer pixels and scales with resolution and camera distance", () => {
    const state = new FoliageOcclusion();
    const camera = cameraAt(10);
    const feet = new THREE.Vector3();
    const size = new THREE.Vector2(1200, 600);
    state.update(camera, feet, size);
    const first = state.snapshot();
    expect(first.enabled).toBe(true);
    expect(first.foot[0]).toBeCloseTo(600);
    expect(first.head[0]).toBeCloseTo(600);
    expect(first.foot[1]).toBeLessThan(300);
    expect(first.head[1]).toBeGreaterThan(300);
    expect(first.foot[2]).toBe(10);
    expect(first.head[2]).toBe(10);
    expect(first.foot[3]).toBeGreaterThan(30);
    state.update(camera, feet, size.clone().multiplyScalar(2));
    const retina = state.snapshot();
    for (const index of [0, 1, 3]) {
      expect(retina.foot[index]).toBeCloseTo(first.foot[index]! * 2);
      expect(retina.head[index]).toBeCloseTo(first.head[index]! * 2);
    }
    state.update(cameraAt(20), feet, size);
    expect(state.snapshot().foot[3]).toBeCloseTo(first.foot[3]! / 2);
    expect(feet.toArray()).toEqual([0, 0, 0]);
  });

  it("disables invalid, behind-camera and hidden-player poses without replacing uniform objects", () => {
    const state = new FoliageOcclusion();
    const foot = state.uniforms.uCorealmFoliageRevealFoot;
    const camera = cameraAt(10);
    const size = new THREE.Vector2(1200, 600);
    state.update(camera, new THREE.Vector3(), size);
    state.setEnabled(false);
    expect(state.enabled).toBe(false);
    state.setEnabled(true);
    expect(state.enabled).toBe(true);
    state.update(camera, new THREE.Vector3(), size, false);
    expect(state.enabled).toBe(false);
    for (const [feet, viewport] of [
      [new THREE.Vector3(0, 0, 20), size],
      [new THREE.Vector3(Number.NaN, 0, 0), size],
      [new THREE.Vector3(), new THREE.Vector2(0, 0)],
    ] as const) {
      state.update(camera, feet, viewport);
      state.setEnabled(true);
      expect(state.enabled).toBe(false);
    }
    expect(state.uniforms.uCorealmFoliageRevealFoot).toBe(foot);
  });

  it("preserves texture cutouts, opaque depth writing, art and vertex animation while sharing uniforms", () => {
    const source = new THREE.MeshStandardMaterial({
      map: new THREE.Texture(), alphaTest: 0.4, alphaToCoverage: true,
      transparent: false, depthWrite: true, side: THREE.DoubleSide,
    });
    source.name = "Leaves";
    source.customProgramCacheKey = () => "source-wind-v2";
    source.onBeforeCompile = (shader) => { shader.vertexShader += "\n// inherited wind"; };
    const art = createArtDirectedMaterial(source, "foliage");
    const state = new FoliageOcclusion();
    const before = source.toJSON();
    const derived = createFoliageOcclusionMaterial(art, state) as THREE.MeshStandardMaterial;
    const shader = shaderInput();
    derived.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(source.toJSON()).toEqual(before);
    expect(derived.map).toBe(source.map);
    expect(derived.alphaTest).toBe(0.4);
    expect(derived.alphaToCoverage).toBe(true);
    expect(derived.transparent).toBe(false);
    expect(derived.depthWrite).toBe(true);
    expect(derived.side).toBe(THREE.DoubleSide);
    expect(shader.vertexShader).toBe(`${THREE.ShaderLib.standard.vertexShader}\n// inherited wind`);
    expect(shader.uniforms["uCorealmFoliageRevealFoot"]).toBe(state.uniforms.uCorealmFoliageRevealFoot);
    expect(derived.customProgramCacheKey()).toContain("source-wind-v2");
    expect(derived.customProgramCacheKey()).toContain(art.customProgramCacheKey());
    const programKey = derived.customProgramCacheKey();
    state.update(cameraAt(10), new THREE.Vector3(), new THREE.Vector2(1200, 600));
    expect(state.uniforms.uCorealmFoliageRevealCamera.value.toArray()).toEqual([0, 1, 10]);
    expect(derived.customProgramCacheKey()).toBe(programKey);
    expect(createFoliageOcclusionMaterial(derived, state)).toBe(derived);
  });

  it("leaves shadow/depth materials alone and reports an incompatible colour shader", () => {
    const state = new FoliageOcclusion();
    for (const source of [new THREE.MeshDepthMaterial(), new THREE.MeshDistanceMaterial(), new THREE.MeshBasicMaterial()]) {
      expect(createFoliageOcclusionMaterial(source, state)).toBe(source);
    }
    const source = new THREE.MeshStandardMaterial();
    source.onBeforeCompile = (shader) => { shader.fragmentShader = "void main() {}"; };
    const derived = createFoliageOcclusionMaterial(source, state);
    expect(() => derived.onBeforeCompile(shaderInput(), {} as THREE.WebGLRenderer))
      .toThrow("Foliage reveal has no alpha insertion point");
  });
});
