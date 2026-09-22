import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
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
import { REGIONAL_TIER_ITEMS } from "../game/src/content/regionalTierEquipment.js";

const MAP_FIELDS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap",
] as const;
const TIERS = ["worn", "grithe", "corven", "kaldite", "emberite", "cindersteel", "nightglass"] as const;
const BODIES: readonly CharacterBody[] = ["male", "female"];
const KNIGHT_PARTS = ["helmet", "chest", "pauldron", "legs", "boots", "gloves"] as const;
const KNIGHT_VARIANTS = [
  { item: "worn_helm", parts: KNIGHT_PARTS },
  { item: "grithe_helm", parts: KNIGHT_PARTS },
  { item: "corven_helm", parts: KNIGHT_PARTS },
  { item: "kaldite_helm", parts: KNIGHT_PARTS },
  { item: "emberite_helm", parts: KNIGHT_PARTS },
  { item: "cindersteel_helm", parts: KNIGHT_PARTS },
  { item: "nightglass_helm", parts: KNIGHT_PARTS },
  { item: "nightmarshal_plate", parts: ["chest", "pauldron"] as const },
] as const;
const SHIELDS = [
  ["palewood_shield", "grithe_sword"],
  ["duskoak_shield", "corven_sword"],
  ["cairnpine_shield", "kaldite_sword"],
  ["cinderpine_shield", "emberite_sword"],
  ["teak_shield", "cindersteel_sword"],
  ["magic_shield", "nightglass_sword"],
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

function graph(material: THREE.Material): string {
  const values: unknown[] = [];
  (material as MeshStandardNodeMaterial).colorNode?.traverse(node => {
    const data = node as Node & { value?: unknown; op?: string; method?: string; scope?: string };
    const value = data.value instanceof THREE.Color ? data.value.toArray()
      : typeof data.value === "number" ? data.value : undefined;
    values.push([node.constructor.name, data.op, data.method, data.scope, value]);
  });
  return JSON.stringify(values);
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
    shader: graph(material),
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
  // Tier color nodes consume the authored vertex shading before re-dyeing it.
  expect(painted.vertexColors).toBe(false);
  expect(painted.transparent).toBe(source.transparent);
  expect(painted.opacity).toBe(source.opacity);
  expect(painted.alphaTest).toBe(source.alphaTest);
  expect(painted.side).toBe(source.side);
  for (const field of MAP_FIELDS) expect(painted[field], field).toBe(source[field]);
}


const REGIONAL_ITEM_IDS = new Set(REGIONAL_TIER_ITEMS.map(({ id }) => id));
const KNIGHT_APPEARANCES = BODIES.flatMap(body => GEAR_APPEARANCE_IDS
  .filter(itemId => !REGIONAL_ITEM_IDS.has(itemId)).flatMap(itemId => (
  gearAppearanceParts(itemId, body).filter(part => part.assetId.startsWith(`outfit_${body}_knight_`))
)));
const TOOL_APPEARANCES = TIERS.flatMap(tier => ["pickaxe", "hatchet"].map(kind => (
  gatheringToolAppearance(`${tier}_${kind}`)!
)));
const SWORD_APPEARANCES = [...TIERS.map(tier => gearAppearance(`${tier}_sword`)!), gearAppearance("chainbound_sword")!];

describe("restored equipment metal materials", () => {
  it("covers seven complete Knight tiers and the two Nightmarshal chest parts on both bodies", () => {
    expect(KNIGHT_APPEARANCES).toHaveLength(2 * (7 * KNIGHT_PARTS.length + 2));
    const variants = KNIGHT_VARIANTS.map(row => ({ ...row, tint: gearAppearance(row.item)!.tint }));
    expect(new Set(variants.map(row => row.tint)).size).toBe(8);
    for (const body of BODIES) {
      const expected = variants.flatMap(row => row.parts.map(part => `outfit_${body}_knight_${part}:${row.tint}`));
      const actual = KNIGHT_APPEARANCES.filter(part => part.assetId.startsWith(`outfit_${body}_knight_`))
        .map(part => `${part.assetId}:${part.tint}`);
      expect(actual.sort(), body).toEqual(expected.sort());
    }
  });

  it("never attaches a scarf to melee equipment on either body", () => {
    for (const body of BODIES) {
      for (const itemId of GEAR_APPEARANCE_IDS) {
        const parts = gearAppearanceParts(itemId, body);
        const knightParts = parts.filter(part => part.assetId.startsWith(`outfit_${body}_knight_`));
        if (knightParts.length === 0) continue;
        expect(parts.some(part => part.assetId.endsWith("_scarf")), `${body} ${itemId}`).toBe(false);
      }
    }
  });

  it("preserves authored surface data for all sword, tool and Knight tiers", () => {
    for (const appearance of [...SWORD_APPEARANCES, ...TOOL_APPEARANCES, ...KNIGHT_APPEARANCES]) {
      const source = fixtureMaterial(appearance.attach === "skin" ? "MI_Knight" : "MI_Trim_Props_Vertex");
      const before = materialState(source);
      const painted = paint(source, appearance);
      expectAuthoredSurface(painted, source);
      expect(graph(painted), appearance.assetId).not.toBe(graph(source));
      expect(painted.userData.gearColorTreatment).toEqual({ kind: "metal", tint: appearance.tint, reference: appearance.attach === "skin" ? 0.22 : 0.10 });
      expect(materialState(source), appearance.assetId).toEqual(before);
    }
  });

  it("gives each tier a distinct merge and shader identity while preserving repeatability", () => {
    for (const appearances of [SWORD_APPEARANCES, TOOL_APPEARANCES.filter(part => part.assetId === "corealm_axe_1"),
      ...BODIES.map(body => KNIGHT_APPEARANCES.filter(part => part.assetId === `outfit_${body}_knight_chest`))]) {
      const source = fixtureMaterial();
      const painted = appearances.map(appearance => paint(source, appearance));
      expect(new Set(painted.map(material => `${material.name}|${material.color.getHexString()}`)).size).toBe(appearances.length);
      expect(new Set(painted.map(graph)).size).toBe(appearances.length);
      for (const [index, material] of painted.entries()) {
        const repeated = paint(source, appearances[index]!);
        expect(repeated.userData.gearColorTreatment).toEqual(material.userData.gearColorTreatment);
        expect(graph(repeated)).toBe(graph(material));
      }
    }
  });

  it("keeps one compatible shader and merge identity across a Knight tier's modular parts", () => {
    for (const body of BODIES) {
      for (const variant of KNIGHT_VARIANTS) {
        const tint = gearAppearance(variant.item)!.tint;
        const source = fixtureMaterial("MI_Knight");
        const appearances = KNIGHT_APPEARANCES.filter(appearance => appearance.tint === tint
          && appearance.assetId.startsWith(`outfit_${body}_knight_`));
        expect(appearances.map(part => part.assetId).sort(), `${body} ${variant.item}`)
          .toEqual(variant.parts.map(part => `outfit_${body}_knight_${part}`).sort());
        const painted = appearances.map(appearance => paint(source, appearance));
        expect(painted).toHaveLength(variant.parts.length);
        expect(new Set(painted.map(material => `${material.name}|${material.color.getHexString()}`)).size).toBe(1);
        expect(new Set(painted.map(graph)).size).toBe(1);
        expect(new Set(painted.map(graph)).size).toBe(1);
      }
    }
  });

  it("uses the restored metallic mask and authored vertex shading in its color graph", () => {
    const painted = paint(fixtureMaterial(), gearAppearance("corven_sword")!);
    const result = graph(painted);
    expect(result).toContain("VertexColorNode");
    expect(result).toContain("metalness");
    expect(result).toContain("smoothstep");
    expect(result).toContain("pow");
    expect(result).toContain("color");
    const nodes = painted as unknown as MeshStandardNodeMaterial;
    expect(nodes.colorNode).not.toBeNull();
    expect(nodes.roughnessNode).toBeNull();
    expect(nodes.metalnessNode).toBeNull();
    expect(nodes.normalNode).toBeNull();
  });

  it("requires a restored metallic mask and leaves other equipment treatments outside the metal pass", () => {
    for (const appearance of [...SWORD_APPEARANCES, ...TOOL_APPEARANCES, ...KNIGHT_APPEARANCES]) {
      const source = fixtureMaterial();
      source.metalnessMap = null;
      const painted = paint(source, appearance);
      expect(painted.userData.gearColorTreatment?.kind).not.toBe("metal");
      expect(painted.userData.gearColorTreatment?.kind).not.toBe("metal");
    }
    for (const itemId of [
      "kaldite_dagger", "emberite_dagger", "tideworn_sword", "mossbound_staff",
      "basic_wooden_staff", "cinderpine_wand", "marchhide_robe", "charhide_boots",
    ]) {
      const source = fixtureMaterial();
      const before = materialState(source);
      const painted = paint(source, gearAppearance(itemId)!);
      expect(painted.userData.gearColorTreatment?.kind, itemId).not.toBe("metal");
      expect(painted.userData.gearColorTreatment?.kind, itemId).not.toBe("metal");
      expect(source.metalnessMap).not.toBeNull();
      expect(materialState(source)).toEqual(before);
    }
    for (const role of ["leather", "gem"]) {
      const source = fixtureMaterial();
      source.userData["equipmentRole"] = role;
      expect(paint(source, gearAppearance("corven_sword")!).userData.gearColorTreatment?.kind, role).not.toBe("metal");
    }
  });

  it.each(SHIELDS)("applies the reviewed %s finish without changing source materials or grip geometry", (shieldId, swordId) => {
    const appearance = gearAppearance(shieldId)!;
    expect(appearance.assetId).toMatch(/^corealm_shield_[1-4]$/);
    // Tier metadata is shared; the reviewed shield finish can use its own palette.
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
    const geometry = mesh.geometry;
    applyGearAppearance(mesh, appearance);
    const [metal, boards, grip] = mesh.material;
    const unchanged = shieldId === "cinderpine_shield";
    const plated = shieldId === "cairnpine_shield" || shieldId === "magic_shield";
    expect(mesh.geometry).toBe(geometry);
    if (unchanged) {
      expect(metal!.color.getHex()).toBe(appearance.tint);
      expect(boards!.color.getHex()).toBe(authored[1]);
      expect(grip!.color.getHex()).toBe(authored[2]);
      expect(mesh.material.every(material => material.userData.iconWeaponPalette === undefined)).toBe(true);
    } else {
      expect(new Set(mesh.material.map(material => material.color.getHex())).size).toBe(3);
      for (const material of mesh.material) {
        expect(material.userData.iconWeaponPalette).toBe(shieldId);
        expect(material.color.getHex()).not.toBe(authored[0]);
        expect(material.emissive.getHex()).toBe(0);
        expect(material.emissiveIntensity).toBe(0);
      }
      expect(metal!.metalness).toBeGreaterThan(0);
      expect(boards!.userData.equipmentRole).toBe(plated ? "metal" : "wood");
      expect(boards!.metalness).toBe(plated ? metal!.metalness : 0);
      if (plated) expect(boards!.color.b).toBeGreaterThan(boards!.color.r);
      expect(grip!.userData.equipmentRole).toBe("leather");
      expect(grip!.metalness).toBe(0);
      expect(grip!.roughness).toBeGreaterThan(metal!.roughness);
    }
    for (const material of mesh.material) {
      expect(material.userData.gearColorTreatment?.kind).not.toBe("metal");
      expect(material.userData.gearColorTreatment?.kind).not.toBe("metal");
    }
    for (const [index, material] of mesh.material.entries()) {
      expect(material).not.toBe(sources[index]);
      expect(material.normalScale.toArray()).toEqual(sources[index]!.normalScale.toArray());
      for (const field of MAP_FIELDS) {
        expect(material[field], field).toBe(plated && index === 1 && field === "map" ? null : sources[index]![field]);
      }
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
      expect((material as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
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
        expect(material.userData.gearColorTreatment?.tint).toBe(appearance.tint);
      }
      expect(sourceMaterials.map(materialState)).toEqual(before);
    }
  });
});
