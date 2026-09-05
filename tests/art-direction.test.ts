import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  artSurfaceRoleForMaterial,
  createArtDirectedMaterial,
  type ArtSurfaceRole,
} from "../game/src/render/artDirection.js";

function shaderInput(): Parameters<THREE.Material["onBeforeCompile"]>[0] {
  return {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as Parameters<THREE.Material["onBeforeCompile"]>[0];
}

describe("shared organic art treatment", () => {
  it("recognizes organic source families without grading eyes, petals or unrelated props", () => {
    for (const name of ["Leaves", "Leaves_NormalTree", "Leaves_Pine@wind:0.055", "Grass", "grass-sprite", "MI_Vine"]) {
      expect(artSurfaceRoleForMaterial(name), name).toBe("foliage");
    }
    expect(artSurfaceRoleForMaterial("Bark_DeadTree")).toBe("bark");
    expect(artSurfaceRoleForMaterial("animal_cattle_mat")).toBe("hide");
    expect(artSurfaceRoleForMaterial("boss_miniboss_galeskin_mat")).toBe("hide");
    for (const name of ["boss_rhino_air_mat", "boss_rhino_earth_mat@art:elemental-hide", "boss_rhino_water_mat"]) {
      expect(artSurfaceRoleForMaterial(name), name).toBe("elemental-hide");
    }
    for (const name of ["Flowers", "MI_Eyes", "Mushrooms", "MI_WoodTrim", "miniboss_sword_material", "GrassPaint", "animal_eye"]) {
      expect(artSurfaceRoleForMaterial(name), name).toBeNull();
    }
  });

  it("preserves authored texture, cutout and emissive data without changing the source", () => {
    const map = new THREE.Texture();
    const alphaMap = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const emissiveMap = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({
      color: 0x9e775c, map, alphaMap, normalMap, emissiveMap,
      roughness: 0.65, metalness: 0.2, alphaTest: 0.42, alphaToCoverage: true,
      side: THREE.DoubleSide, emissive: 0x79edff, emissiveIntensity: 1.35,
    });
    source.name = "boss_rhino_air_mat";
    source.userData["ownedBy"] = "asset-registry";
    const before = source.toJSON();
    const sourceCompile = source.onBeforeCompile;
    const sourceProgramKey = source.customProgramCacheKey;
    const derived = createArtDirectedMaterial(source, "hide") as THREE.MeshStandardMaterial;

    expect(derived).not.toBe(source);
    for (const field of ["map", "alphaMap", "normalMap", "emissiveMap"] as const) {
      expect(derived[field]).toBe(source[field]);
    }
    expect(derived.color.getHex()).toBe(source.color.getHex());
    expect(derived.emissive.getHex()).toBe(source.emissive.getHex());
    expect(derived.emissiveIntensity).toBe(1.35);
    expect(derived.alphaTest).toBe(0.42);
    expect(derived.alphaToCoverage).toBe(true);
    expect(derived.side).toBe(THREE.DoubleSide);
    expect(derived.roughness).toBeGreaterThan(source.roughness);
    expect(derived.metalness).toBe(0);
    expect(source.toJSON()).toEqual(before);
    expect(source.onBeforeCompile).toBe(sourceCompile);
    expect(source.customProgramCacheKey).toBe(sourceProgramKey);
  });

  it("retains inherited shader hooks, uniforms and cache identity", () => {
    const source = new THREE.MeshStandardMaterial();
    const time = { value: 3.5 };
    let receivedSource = false;
    source.onBeforeCompile = function (shader) {
      receivedSource = this === source;
      shader.uniforms["sourceTime"] = time;
      shader.vertexShader += "\n// inherited rooted wind";
    };
    source.customProgramCacheKey = () => "source-wind-and-palette-v2";
    const derived = createArtDirectedMaterial(source, "foliage");
    const shader = shaderInput();
    derived.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect(receivedSource).toBe(true);
    expect(shader.uniforms["sourceTime"]).toBe(time);
    expect(shader.vertexShader).toContain("inherited rooted wind");
    expect(derived.customProgramCacheKey()).toContain("source-wind-and-palette-v2");
    expect(derived.customProgramCacheKey()).not.toBe(createArtDirectedMaterial(source, "bark").customProgramCacheKey());
  });

  it("does not apply a role twice to an already treated material", () => {
    const source = new THREE.MeshStandardMaterial();
    for (const role of ["foliage", "bark", "hide", "elemental-hide"] satisfies ArtSurfaceRole[]) {
      const derived = createArtDirectedMaterial(source, role);
      expect(createArtDirectedMaterial(derived, role)).toBe(derived);
    }
  });

  it("reduces elemental rhino glow while retaining its emission texture and ordinary hide response", () => {
    const source = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: new THREE.Texture(), emissiveMap: new THREE.Texture(),
      emissive: 0x83bd50, emissiveIntensity: 1.5, roughness: 0.86,
    });
    source.name = "boss_rhino_earth_mat";
    const original = source.toJSON();
    const derived = createArtDirectedMaterial(source, "elemental-hide") as THREE.MeshStandardMaterial;
    expect(derived.emissiveIntensity).toBeLessThan(source.emissiveIntensity);
    expect(derived.emissiveMap).toBe(source.emissiveMap);
    expect(derived.emissive.getHex()).toBe(source.emissive.getHex());
    expect(derived.map).toBe(source.map);
    expect(derived.roughness).toBeGreaterThanOrEqual(source.roughness);
    expect(createArtDirectedMaterial(derived, "elemental-hide")).toBe(derived);
    expect(source.toJSON()).toEqual(original);

    const ordinary = createArtDirectedMaterial(source, "hide") as THREE.MeshStandardMaterial;
    expect(ordinary.emissiveIntensity).toBe(source.emissiveIntensity);
  });

  it("keeps the understory shoulder separate from canopy and grass shader programs", () => {
    const variants = ["Leaves", "Leaves_NormalTree", "Grass", "grass-sprite"].map((name) => {
      const source = new THREE.MeshStandardMaterial();
      source.name = name;
      const material = createArtDirectedMaterial(source, "foliage");
      return { material };
    });
    const [understory, canopy, grass, sprite] = variants;
    expect(understory!.material.customProgramCacheKey()).not.toBe(canopy!.material.customProgramCacheKey());
    expect(canopy!.material.customProgramCacheKey()).not.toBe(grass!.material.customProgramCacheKey());
    expect(grass!.material.customProgramCacheKey()).toBe(sprite!.material.customProgramCacheKey());
  });

  it("leaves non-PBR effects alone and rejects an incompatible source shader explicitly", () => {
    const effect = new THREE.MeshBasicMaterial();
    expect(createArtDirectedMaterial(effect, "foliage")).toBe(effect);
    const source = new THREE.MeshStandardMaterial();
    source.name = "custom-leaf";
    source.onBeforeCompile = (shader) => { shader.fragmentShader = "void main() {}"; };
    const derived = createArtDirectedMaterial(source, "foliage");
    expect(() => derived.onBeforeCompile(shaderInput(), {} as THREE.WebGLRenderer))
      .toThrow("Organic art treatment has no albedo insertion point: custom-leaf");
  });
});
