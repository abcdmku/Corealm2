import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  applyGearAppearance,
  gatheringToolAppearance,
  gearAppearance,
  gearAppearanceParts,
  GEAR_APPEARANCE_IDS,
  type CharacterBody,
  type GearAppearance,
} from "../game/src/render/equipmentVisuals.js";

const MAP_FIELDS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap",
] as const;
const TIERS = ["worn", "grithe", "corven", "kaldite", "emberite"] as const;
const BODIES: readonly CharacterBody[] = ["male", "female"];
const KNIGHT_PARTS = ["helmet", "chest", "pauldron", "scarf", "legs", "boots", "gloves"] as const;
const SHIELDS = [
  ["palewood_shield", "grithe_sword"],
  ["duskoak_shield", "corven_sword"],
  ["cairnpine_shield", "kaldite_sword"],
  ["cinderpine_shield", "emberite_sword"],
] as const;

function fixtureMaterial(name = "MI_Trim_Props_Vertex"): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    name,
    color: 0xbaa78f,
    emissive: 0x17202b,
    emissiveIntensity: 0.31,
    roughness: 0.79,
    metalness: 0.86,
    normalScale: new THREE.Vector2(0.63, 0.91),
    vertexColors: true,
    transparent: true,
    opacity: 0.87,
    alphaTest: 0.12,
    side: THREE.DoubleSide,
  });
  for (const field of MAP_FIELDS) material[field] = new THREE.Texture();
  return material;
}

function paint(source: THREE.MeshStandardMaterial, appearance: GearAppearance): THREE.MeshStandardMaterial {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), source);
  applyGearAppearance(mesh, appearance);
  return mesh.material;
}

function compile(material: THREE.Material): string {
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
  } as Parameters<THREE.Material["onBeforeCompile"]>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader.fragmentShader;
}

function materialState(material: THREE.MeshStandardMaterial): unknown {
  return {
    name: material.name,
    color: material.color.toArray(),
    emissive: material.emissive.toArray(),
    emissiveIntensity: material.emissiveIntensity,
    roughness: material.roughness,
    metalness: material.metalness,
    normalScale: material.normalScale.toArray(),
    vertexColors: material.vertexColors,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
    maps: MAP_FIELDS.map(field => material[field]?.uuid),
    userData: structuredClone(material.userData),
    shader: compile(material),
    cacheKey: material.customProgramCacheKey(),
  };
}

function expectAuthoredSurface(painted: THREE.MeshStandardMaterial, source: THREE.MeshStandardMaterial): void {
  expect(painted).not.toBe(source);
  expect(painted.color.toArray()).toEqual(source.color.toArray());
  expect(painted.emissive.toArray()).toEqual(source.emissive.toArray());
  expect(painted.emissiveIntensity).toBe(source.emissiveIntensity);
  expect(painted.roughness).toBe(source.roughness);
  expect(painted.metalness).toBe(source.metalness);
  expect(painted.normalScale.toArray()).toEqual(source.normalScale.toArray());
  expect(painted.vertexColors).toBe(source.vertexColors);
  expect(painted.transparent).toBe(source.transparent);
  expect(painted.opacity).toBe(source.opacity);
  expect(painted.alphaTest).toBe(source.alphaTest);
  expect(painted.side).toBe(source.side);
  for (const field of MAP_FIELDS) expect(painted[field], field).toBe(source[field]);
}

function glslColour(tint: number): string {
  return `vec3(${new THREE.Color(tint).toArray().map(value => value.toFixed(6)).join(", ")})`;
}

const KNIGHT_APPEARANCES = BODIES.flatMap(body => GEAR_APPEARANCE_IDS.flatMap(itemId => (
  gearAppearanceParts(itemId, body).filter(part => part.assetId.startsWith(`outfit_${body}_knight_`))
)));
const TOOL_APPEARANCES = TIERS.flatMap(tier => ["pickaxe", "hatchet"].map(kind => (
  gatheringToolAppearance(`${tier}_${kind}`)!
)));
const SWORD_APPEARANCES = TIERS.map(tier => gearAppearance(`${tier}_sword`)!);

describe("restored equipment metal materials", () => {
  it("covers every Knight part for both bodies at each authored tier", () => {
    expect(KNIGHT_APPEARANCES).toHaveLength(2 * 4 * KNIGHT_PARTS.length);
    for (const body of BODIES) {
      for (const part of KNIGHT_PARTS) {
        const appearances = KNIGHT_APPEARANCES.filter(appearance => appearance.assetId === `outfit_${body}_knight_${part}`);
        expect(new Set(appearances.map(appearance => appearance.tint)).size, `${body} ${part}`).toBe(4);
      }
    }
  });

  it("preserves authored surface data for all sword, tool and Knight tiers", () => {
    for (const appearance of [...SWORD_APPEARANCES, ...TOOL_APPEARANCES, ...KNIGHT_APPEARANCES]) {
      const source = fixtureMaterial(appearance.attach === "skin" ? "MI_Knight" : "MI_Trim_Props_Vertex");
      const before = materialState(source);
      const painted = paint(source, appearance);
      expectAuthoredSurface(painted, source);
      expect(compile(painted), appearance.assetId).not.toBe(compile(source));
      expect(compile(painted), appearance.assetId).toContain(glslColour(appearance.tint!));
      expect(materialState(source), appearance.assetId).toEqual(before);
    }
  });

  it("gives each tier a distinct merge and shader identity while preserving repeatability", () => {
    for (const appearances of [SWORD_APPEARANCES, TOOL_APPEARANCES.filter(part => part.assetId === "corealm_axe_1"),
      ...BODIES.map(body => KNIGHT_APPEARANCES.filter(part => part.assetId === `outfit_${body}_knight_chest`))]) {
      const source = fixtureMaterial();
      const painted = appearances.map(appearance => paint(source, appearance));
      expect(new Set(painted.map(material => `${material.name}|${material.color.getHexString()}`)).size).toBe(appearances.length);
      expect(new Set(painted.map(material => material.customProgramCacheKey())).size).toBe(appearances.length);
      for (const [index, material] of painted.entries()) {
        const repeated = paint(source, appearances[index]!);
        expect(repeated.customProgramCacheKey()).toBe(material.customProgramCacheKey());
        expect(compile(repeated)).toBe(compile(material));
      }
    }
  });

  it("keeps one compatible shader and merge identity across a Knight tier's modular parts", () => {
    for (const body of BODIES) {
      for (const tint of new Set(KNIGHT_APPEARANCES.map(appearance => appearance.tint))) {
        const source = fixtureMaterial("MI_Knight");
        const appearances = KNIGHT_APPEARANCES.filter(appearance => appearance.tint === tint
          && appearance.assetId.startsWith(`outfit_${body}_knight_`));
        const painted = appearances.map(appearance => paint(source, appearance));
        expect(painted).toHaveLength(KNIGHT_PARTS.length);
        expect(new Set(painted.map(material => `${material.name}|${material.color.getHexString()}`)).size).toBe(1);
        expect(new Set(painted.map(material => material.customProgramCacheKey())).size).toBe(1);
        expect(new Set(painted.map(compile)).size).toBe(1);
      }
    }
  });

  it("captures authored map colour before vertex tint and applies correction after the metallic mask", () => {
    const shader = compile(paint(fixtureMaterial(), gearAppearance("corven_sword")!));
    const orderedStages = [
      "#include <map_fragment>",
      "vec3 gearMetalSource = diffuseColor.rgb;",
      "#include <color_fragment>",
      "gearMetalSource *= dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));",
      "#include <metalnessmap_fragment>",
      "float gearMetalMask = smoothstep(0.20, 0.70, metalnessFactor);",
      "float gearMetalLuma = dot(gearMetalSource, vec3(0.2126, 0.7152, 0.0722));",
      "vec3 gearMetalHighlight = max(gearMetalColour - vec3(0.78), vec3(0.0));",
      "+ 0.17 * gearMetalHighlight / (vec3(0.17) + gearMetalHighlight);",
      "diffuseColor.rgb = mix(diffuseColor.rgb, gearMetalColour, gearMetalMask);",
      "#include <lights_physical_fragment>",
      "#include <lights_fragment_begin>",
    ];
    let previous = -1;
    for (const marker of orderedStages) {
      const index = shader.indexOf(marker);
      expect(index, marker).toBeGreaterThan(previous);
      expect(shader.indexOf(marker, index + marker.length), `${marker} must occur once`).toBe(-1);
      previous = index;
    }

    // Both Three vertex-colour modes must retain scalar shading, while the original
    // diffuseColor still contains vertex chroma for the nonmetal side of the final mix.
    expect(shader).toMatch(/#if defined\(USE_COLOR\) \|\| defined\(USE_COLOR_ALPHA\)\s+gearMetalSource \*= dot\(vColor\.rgb, vec3\(0\.2126, 0\.7152, 0\.0722\)\);\s+#endif/);
    expect(shader).toMatch(/gearMetalColour = vec3\([^)]+\) \* 0\.72 \* gearMetalWear\s+\* gearMetalSource \/ max\(gearMetalLuma, 0\.001\)/);
    const correction = shader.slice(shader.indexOf("float gearMetalMask"), shader.indexOf("#include <normal_fragment_begin>"));
    expect(correction).not.toMatch(/gearMetalWear\s*=\s*clamp\(/);
    expect(correction).not.toContain("min(gearMetalColour, vec3(0.95))");
    expect(correction).not.toMatch(/(?:roughnessFactor|metalnessFactor|totalEmissiveRadiance|normal)\s*[*+/\-]?=/);
    expect(correction.match(/diffuseColor\.rgb\s*=/g)).toHaveLength(1);
  });

  it("requires a restored metallic mask and leaves other equipment treatments outside the metal pass", () => {
    for (const appearance of [...SWORD_APPEARANCES, ...TOOL_APPEARANCES, ...KNIGHT_APPEARANCES]) {
      const source = fixtureMaterial();
      source.metalnessMap = null;
      const painted = paint(source, appearance);
      expect(compile(painted)).not.toContain("gearMetalSource");
      expect(painted.customProgramCacheKey()).not.toContain("metal-tier:");
    }
    for (const itemId of [
      "kaldite_dagger", "emberite_dagger", "tideworn_sword", "mossbound_staff",
      "basic_wooden_staff", "cinderpine_wand", "marchhide_robe", "charhide_boots",
    ]) {
      const source = fixtureMaterial();
      const before = materialState(source);
      const painted = paint(source, gearAppearance(itemId)!);
      expect(compile(painted), itemId).not.toContain("gearMetalSource");
      expect(painted.customProgramCacheKey(), itemId).not.toContain("metal-tier:");
      expect(source.metalnessMap).not.toBeNull();
      expect(materialState(source)).toEqual(before);
    }
    for (const role of ["leather", "gem"]) {
      const source = fixtureMaterial();
      source.userData["equipmentRole"] = role;
      expect(compile(paint(source, gearAppearance("corven_sword")!)), role).not.toContain("gearMetalSource");
    }
  });

  it.each(SHIELDS)("tints only the iron on %s and leaves its board and grip authored", (shieldId, swordId) => {
    // The Corealm boards separate wood, metal and leather into their own materials, so the tier
    // colour reaches the rim and boss while the planks and the rear handgrip keep what they were
    // authored with. The old imported board had one vertex-coloured trim material shared across all
    // three, which is why its tier tint used to turn the rim pink and the grip near-black.
    const appearance = gearAppearance(shieldId)!;
    expect(appearance.assetId).toMatch(/^corealm_shield_[1-4]$/);
    // The sword of the same tier carries the same metal colour, which is what ties a kit together.
    expect(appearance.tint).toBe(gearAppearance(swordId)!.tint);
    const sources = [
      fixtureMaterial("corealm-weapon-metal"),
      fixtureMaterial("corealm-weapon-wood"),
      fixtureMaterial("corealm-weapon-leather"),
    ];
    for (const [index, role] of ["metal", "wood", "leather"].entries()) {
      sources[index]!.userData["equipmentRole"] = role;
      // These originals carry no metalness map, so the imported metal shader treatment must not run.
      sources[index]!.metalnessMap = null;
    }
    const authored = sources.map(material => material.color.getHex());
    const before = sources.map(materialState);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), sources);
    applyGearAppearance(mesh, appearance);
    const [metal, boards, grip] = mesh.material;
    expect(metal!.color.getHex(), "rim and boss take the tier metal").toBe(appearance.tint);
    expect(boards!.color.getHex(), "planks stay authored").toBe(authored[1]);
    expect(grip!.color.getHex(), "handgrip stays authored").toBe(authored[2]);
    for (const material of mesh.material) {
      expect(compile(material)).not.toContain("gearMetalSource");
      expect(material.customProgramCacheKey()).not.toContain("metal-tier:");
    }
    for (const [index, material] of mesh.material.entries()) {
      expect(material).not.toBe(sources[index]);
      for (const field of MAP_FIELDS) expect(material[field], field).toBe(sources[index]![field]);
    }
    expect(sources.map(materialState)).toEqual(before);
  });
});

/** Load production material definitions and geometry. Image decoding is outside this unit gate. */
class MetadataTextureLoader extends THREE.TextureLoader {
  override load(
    url: string,
    onLoad?: (texture: THREE.Texture<HTMLImageElement>) => void,
    _onProgress?: (event: ProgressEvent) => void,
    _onError?: (error: unknown) => void,
  ): THREE.Texture<HTMLImageElement> {
    const texture = new THREE.Texture<HTMLImageElement>();
    texture.userData["sourceUrl"] = url;
    queueMicrotask(() => onLoad?.(texture));
    return texture;
  }
}

async function loadAuthoredAsset(assetId: string): Promise<THREE.Group> {
  const folder = assetId.startsWith("outfit_") ? "outfit" : "weapon";
  const data = new Uint8Array(await readFile(`game/public/assets/models/${folder}/${assetId}.glb`));
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.(?:png|jpe?g)$/i, new MetadataTextureLoader(manager));
  return (await new GLTFLoader(manager).parseAsync(data.buffer, "")).scene;
}

function materials(object: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const result: THREE.MeshStandardMaterial[] = [];
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
      result.push(material as THREE.MeshStandardMaterial);
    }
  });
  return result;
}

describe("shipped equipment material definitions", () => {
  beforeAll(() => vi.stubGlobal("self", { URL }));
  afterAll(() => vi.unstubAllGlobals());

  it.each([
    "pickaxe",
    ...BODIES.flatMap(body => KNIGHT_PARTS.map(part => `outfit_${body}_knight_${part}`)),
  ])("retains the actual authored material and shared textures in %s", async assetId => {
    const source = await loadAuthoredAsset(assetId);
    const sourceMaterials = materials(source);
    expect(sourceMaterials.length).toBeGreaterThan(0);
    const before = sourceMaterials.map(materialState);
    for (const material of sourceMaterials) {
      expect(material.map).toBeInstanceOf(THREE.Texture);
      expect(material.normalMap).toBeInstanceOf(THREE.Texture);
      expect(material.metalnessMap).toBeInstanceOf(THREE.Texture);
      expect(material.roughnessMap).toBe(material.metalnessMap);
      expect(material.metalnessMap!.userData["sourceUrl"]).toMatch(/textures\/imported\/.*\.png$/);
    }
    source.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        expect(material.vertexColors).toBe(child.geometry.hasAttribute("color"));
      }
    });
    const appearances = [...SWORD_APPEARANCES, ...TOOL_APPEARANCES, ...KNIGHT_APPEARANCES]
      .filter(appearance => appearance.assetId === assetId);
    expect(appearances.length).toBeGreaterThanOrEqual(4);
    for (const appearance of appearances) {
      const attached = source.clone(true);
      applyGearAppearance(attached, appearance);
      const painted = materials(attached);
      expect(painted).toHaveLength(sourceMaterials.length);
      for (const [index, material] of painted.entries()) {
        expectAuthoredSurface(material, sourceMaterials[index]!);
        expect(compile(material)).toContain(glslColour(appearance.tint!));
      }
      expect(sourceMaterials.map(materialState)).toEqual(before);
    }
  });
});
