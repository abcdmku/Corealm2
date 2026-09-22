import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { bool, positionLocal, vec3 } from "three/tsl";
import { ensureNodeMaterial } from "../game/src/render/nodeMaterials.js";
import { createFoliageOcclusionMaterial, FoliageOcclusion } from "../game/src/render/foliageOcclusion.js";

function cameraAt(distance: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 200);
  camera.position.set(0, 1, distance);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  return camera;
}

function descendants(root: Node | null): Node[] {
  const nodes: Node[] = [];
  root?.traverse(node => nodes.push(node));
  return nodes;
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

  it("preserves texture cutouts, depth writing, colour and vertex graphs while sharing reveal state", () => {
    const source = new THREE.MeshStandardMaterial({
      map: new THREE.Texture(), alphaTest: 0.4, alphaToCoverage: true,
      transparent: false, depthWrite: true, side: THREE.DoubleSide,
    });
    source.name = "Leaves";
    const art = ensureNodeMaterial(source);
    art.colorNode = vec3(0.3, 0.7, 0.2);
    art.positionNode = positionLocal.add(vec3(0.1, 0, 0));
    const state = new FoliageOcclusion();
    const before = source.toJSON();
    const derived = createFoliageOcclusionMaterial(art, state) as MeshStandardNodeMaterial;
    expect(source.toJSON()).toEqual(before);
    expect(derived.map).toBe(source.map);
    expect(derived.alphaTest).toBe(0.4);
    expect(derived.alphaToCoverage).toBe(true);
    expect(derived.transparent).toBe(false);
    expect(derived.depthWrite).toBe(true);
    expect(derived.side).toBe(THREE.DoubleSide);
    expect(derived.colorNode).toBe(art.colorNode);
    expect(derived.positionNode).toBe(art.positionNode);
    const nodes = descendants(derived.maskNode);
    const references = nodes.filter(node => "object" in node).map(node => (node as Node & { object: unknown }).object);
    expect(references).toContain(state.uniforms.uCorealmFoliageRevealFoot);
    expect(references).toContain(state.uniforms.uCorealmFoliageRevealHead);
    expect(references).toContain(state.uniforms.uCorealmFoliageRevealEnabled);
    const mask = derived.maskNode;
    const shadowMask = derived.maskShadowNode;
    state.update(cameraAt(10), new THREE.Vector3(), new THREE.Vector2(1200, 600));
    expect(state.uniforms.uCorealmFoliageRevealCamera.value.toArray()).toEqual([0, 1, 10]);
    expect(derived.maskNode).toBe(mask);
    expect(derived.maskShadowNode).toBe(shadowMask);
    expect(createFoliageOcclusionMaterial(derived, state)).toBe(derived);
  });

  it("preserves existing masks in colour and shadow passes without applying reveal to shadows", () => {
    const state = new FoliageOcclusion();
    const source = new MeshStandardNodeMaterial();
    const mask = bool(true);
    source.maskNode = mask;
    const derived = createFoliageOcclusionMaterial(source, state) as MeshStandardNodeMaterial;
    expect(derived.maskShadowNode).toBe(mask);
    expect(derived.maskNode).not.toBe(mask);
    expect(descendants(derived.maskNode)).toContain(mask);
    const explicitShadowMask = bool(false);
    source.maskShadowNode = explicitShadowMask;
    expect((createFoliageOcclusionMaterial(source, state) as MeshStandardNodeMaterial).maskShadowNode).toBe(explicitShadowMask);
  });

  it("leaves shadow/depth materials alone and rejects unported colour shaders", () => {
    const state = new FoliageOcclusion();
    for (const source of [new THREE.MeshDepthMaterial(), new THREE.MeshDistanceMaterial(), new THREE.MeshBasicMaterial()]) {
      expect(createFoliageOcclusionMaterial(source, state)).toBe(source);
    }
    const source = new THREE.MeshStandardMaterial();
    source.onBeforeCompile = (shader) => { shader.fragmentShader = "void main() {}"; };
    expect(() => createFoliageOcclusionMaterial(source, state)).toThrow("unported onBeforeCompile");
  });
});
