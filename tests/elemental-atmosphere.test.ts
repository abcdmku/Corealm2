import { Group } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { ElementalAtmosphere } from "../game/src/render/elementalAtmosphere.js";
import { lowerToWgsl } from "./helpers/wgsl.js";

describe("elemental atmosphere node materials", () => {
  it.each(["fire", "wind", "dust", "smoke"] as const)("lowers the full %s volume to WGSL", kind => {
    const atmosphere = new ElementalAtmosphere(new Group(), kind);
    try {
      expect(atmosphere.mesh.material).toBeInstanceOf(MeshBasicNodeMaterial);
      const shader = lowerToWgsl(atmosphere.mesh);
      expect(shader.fragment).toContain(`i < ${kind === "fire" ? 96 : 18}`);
      expect(shader.fragment).toContain("continue;");
      expect(shader.fragment).toContain("break;");
      expect(shader.fragment).toContain("discard;");
      if (kind === "fire") {
        expect(shader.fragment).toContain("texture_3d<f32>");
        expect(shader.fragment).toContain("textureSampleLevel(");
        const emission = atmosphere.mesh.material.userData["magicEmissionPass"];
        expect(emission.isUniformNode).toBe(true);
        emission.value = 1;
        expect(atmosphere.mesh.material.userData["magicEmissionPass"].value).toBe(1);
      } else {
        expect(shader.fragment).toMatch(/fn atmosphereNoise\s*\(/);
      }
    } finally {
      atmosphere.dispose();
    }
  });
});
