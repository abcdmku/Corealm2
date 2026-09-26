import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { materialColor, uniform } from "three/tsl";
import { applyGearAppearance, gearAppearance } from "../game/src/render/equipmentVisuals.js";

function graphContains(root: Node | null, expected: Node): boolean {
  let found = false;
  root?.traverse(node => { if (node === expected) found = true; });
  return found;
}

describe("equipment source node inheritance", () => {
  it.each([7, 8, 10])('keeps authored weapon materials unchanged under the rank %i aura', upgradeRank => {
    const material = new MeshStandardNodeMaterial({ color: 0x183049, metalness: .8, roughness: .3 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.1, 1.5, .05), material);
    const colorNode = material.colorNode, emissiveNode = material.emissiveNode;
    applyGearAppearance(mesh, { assetId: 'corealm_item_nightglass_sword', slot: 'mainHand', attach: 'bone', upgradeRank });
    expect(mesh.material).toBe(material);
    expect(material.color.getHex()).toBe(0x183049);
    expect(material.colorNode).toBe(colorNode);
    expect(material.emissiveNode).toBe(emissiveNode);
    expect(material.userData.upgradeGlow).toBeUndefined();
    expect(mesh.children.some(child => child.name === 'upgrade-filament')).toBe(true);
    mesh.geometry.dispose(); material.dispose();
  });

  it("keeps an authored wooden haft independent from its metal tool tier", () => {
    const material = new MeshStandardNodeMaterial({ color: 0x765438, roughness: 0.74 });
    material.userData.equipmentRole = "wood";
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    applyGearAppearance(mesh, { assetId: "axe", slot: "mainHand", attach: "bone", tint: 0xffffff });
    expect(mesh.material.color.getHex()).toBe(0x765438);
    expect(mesh.material.roughness).toBe(0.74);
    expect(mesh.material.isNodeMaterial).toBe(true);
    mesh.geometry.dispose(); mesh.material.dispose(); material.dispose();
  });

  it.each(["grithe_cuirass", "legacy_ranger", "marchhide_robe", "tideworn_sword"])(
    "keeps authored surface nodes and live uniform references when applying %s", itemId => {
      const source = new MeshStandardNodeMaterial({ color: 0xffffff });
      source.metalnessMap = new THREE.Texture();
      const wear = uniform(0.75);
      const authored = materialColor.rgb.mul(wear);
      source.colorNode = authored;
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), source);
      const appearance = itemId === "legacy_ranger"
        ? { assetId: "outfit_male_ranger_chest", slot: "body" as const, attach: "skin" as const, tint: 0x416f9d }
        : gearAppearance(itemId)!;
      applyGearAppearance(mesh, appearance);
      const painted = mesh.material;
      expect(painted).not.toBe(source);
      expect(painted.isNodeMaterial).toBe(true);
      expect(graphContains(painted.colorNode, authored)).toBe(true);
      expect(graphContains(painted.colorNode, wear)).toBe(true);
      expect(source.colorNode).toBe(authored);
      wear.value = 0.4;
      expect(graphContains(painted.colorNode, wear)).toBe(true);
      expect(source.color.getHex()).toBe(0xffffff);
      expect(painted.normalMap).toBe(source.normalMap);
      expect(painted.metalnessMap).toBe(source.metalnessMap);
      painted.dispose(); mesh.geometry.dispose(); source.metalnessMap.dispose(); source.dispose();
    },
  );

  it("preserves an untouched surface graph when a part needs only a base color change", () => {
    const source = new MeshStandardNodeMaterial({ color: 0xffffff });
    source.colorNode = materialColor.rgb.mul(uniform(0.85));
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), source);
    applyGearAppearance(mesh, gearAppearance("palewood_staff")!);
    expect(mesh.material.colorNode).toBe(source.colorNode);
    expect(mesh.material).not.toBe(source);
    mesh.material.dispose(); mesh.geometry.dispose(); source.dispose();
  });
});
