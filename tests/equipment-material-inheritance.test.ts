import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyGearAppearance, gearAppearance } from "../game/src/render/equipmentVisuals.js";

describe("equipment source shader inheritance", () => {
  it("keeps an authored wooden haft independent from its metal tool tier", () => {
    const material = new THREE.MeshStandardMaterial({ color: 0x765438, roughness: 0.74 });
    material.userData.equipmentRole = "wood";
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    applyGearAppearance(mesh, { assetId: "axe", slot: "mainHand", attach: "bone", tint: 0xffffff });
    expect(mesh.material.color.getHex()).toBe(0x765438);
    expect(mesh.material.roughness).toBe(0.74);
    mesh.geometry.dispose(); mesh.material.dispose(); material.dispose();
  });
  it.each(["grithe_cuirass", "marchhide_robe", "basic_wooden_staff"])(
    "keeps authored shader work and cache identity when applying %s", (itemId) => {
      const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
      source.metalnessMap = new THREE.Texture();
      source.userData.surfaceRevision = "hammered-v2";
      source.onBeforeCompile = function (shader) {
        shader.uniforms.authoredSurface = { value: this.userData.surfaceRevision };
        shader.fragmentShader += "\n// authored-surface";
      };
      source.customProgramCacheKey = function () { return this.userData.surfaceRevision; };
      const sourceHook = source.onBeforeCompile;
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), source);
      applyGearAppearance(mesh, gearAppearance(itemId)!);
      const painted = mesh.material;
      const shader = {
        vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader,
        uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
      } as Parameters<THREE.Material["onBeforeCompile"]>[0];
      painted.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.uniforms.authoredSurface?.value).toBe("hammered-v2");
      expect(shader.fragmentShader).toContain("// authored-surface");
      expect(shader.fragmentShader).toMatch(/gearMetal|gearTier|gearWood/);
      expect(painted.customProgramCacheKey()).toContain("hammered-v2|");
      expect(painted).not.toBe(source);
      expect(source.onBeforeCompile).toBe(sourceHook);
      expect(source.customProgramCacheKey()).toBe("hammered-v2");
      expect(source.color.getHex()).toBe(0xffffff);
      painted.dispose();
      mesh.geometry.dispose();
      source.metalnessMap.dispose();
      source.dispose();
    },
  );
});
