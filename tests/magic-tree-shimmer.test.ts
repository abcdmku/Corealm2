import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MaterialLibrary } from "../game/src/render/materials.js";

describe("magic tree shimmer", () => {
  it("animates both bark and leaf emission through the production clock while preserving cutout and wind hooks", () => {
    const library = new MaterialLibrary();
    for (const role of ["bark", "foliage"] as const) {
      const source = new THREE.MeshStandardMaterial({ name: role === "bark" ? "Bark_Corealm" : "Leaves_Corealm_broadleaf_magic_cutout", alphaTest: role === "foliage" ? .32 : 0 });
      source.userData.corealmMagicTree = true;
      const material = library.organic(source, role);
      expect(library.organic(source, role)).toBe(material);
      const animated = role === "foliage" ? library.wind(material, .035) : material;
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
      animated.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.fragmentShader).toContain("totalEmissiveRadiance += magicRadiance");
      expect(shader.uniforms.uMagicTreeLeaf!.value).toBe(role === "foliage" ? 1 : 0);
      expect(shader.vertexShader).toContain("vMagicTreePosition = position");
      expect(animated.alphaTest).toBe(source.alphaTest);
      expect(animated.transparent).toBe(false);
      library.setTime(3.5);
      expect(shader.uniforms.uMagicTreeTime!.value).toBe(3.5);
      library.setTime(7);
      expect(shader.uniforms.uMagicTreeTime!.value).toBe(7);
      if (role === "foliage") expect(shader.uniforms.uCorealmWindTime!.value).toBe(7);
      source.dispose();
    }
    library.dispose();
  });

  it("keeps ordinary tree materials free of the magic shader", () => {
    const library = new MaterialLibrary();
    const source = new THREE.MeshStandardMaterial({ name: "Bark_Corealm" });
    const material = library.organic(source, "bark");
    expect(material.customProgramCacheKey()).not.toContain("magic-tree");
    source.dispose(); library.dispose();
  });
});
