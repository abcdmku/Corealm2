import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  itemIconAppearance,
  type ItemIconAssetPart,
} from "../game/src/render/itemIconAppearances.js";
import { prepareItemIconAsset } from "../game/src/render/itemIconRenderer.js";

const LOG_IDS = [
  "palewood_log", "duskoak_log", "cairnpine_log", "cinderpine_log", "willow_log",
  "maple_log", "teak_log", "yew_log", "magic_log",
] as const;

const FISH_ASSETS = {
  silt_minnow: "fish_minnow",
  bramble_trout: "fish_trout",
  cragfin: "animal_perch",
  seared_minnow: "fish_minnow",
  burnt_minnow: "fish_minnow",
  seared_trout: "fish_trout",
  burnt_trout: "fish_trout",
  seared_cragfin: "animal_perch",
  burnt_cragfin: "animal_perch",
} as const;

function onlyAsset(itemId: Parameters<typeof itemIconAppearance>[0]): ItemIconAssetPart {
  const appearance = itemIconAppearance(itemId);
  expect(appearance.parts, itemId).toHaveLength(1);
  expect(appearance.parts[0]!.kind, itemId).toBe("asset");
  return appearance.parts[0] as ItemIconAssetPart;
}

describe("authored resource item icons", () => {
  it("does not misclassify the branch-shaped environment log as finished inventory art", () => {
    for (const itemId of LOG_IDS) {
      const parts = itemIconAppearance(itemId).parts;
      expect(parts, itemId).toHaveLength(1);
      expect(parts[0], itemId).toMatchObject({ kind: "primitive", primitive: "log" });
    }
  });

  it("keeps the matching authored fish silhouette across raw and cooked states", () => {
    for (const [itemId, assetId] of Object.entries(FISH_ASSETS)) {
      expect(onlyAsset(itemId).assetId, itemId).toBe(assetId);
    }
    for (const itemId of Object.keys(FISH_ASSETS).filter(id => id.startsWith("seared_"))) {
      expect(onlyAsset(itemId).surfaceTreatment, itemId).toBe("seared");
    }
    for (const itemId of Object.keys(FISH_ASSETS).filter(id => id.startsWith("burnt_"))) {
      expect(onlyAsset(itemId).surfaceTreatment, itemId).toBe("charred");
      expect(new THREE.Color(onlyAsset(itemId).colour).getHSL({ h: 0, s: 0, l: 0 }).l, itemId)
        .toBeGreaterThan(0.04);
    }
  });

  it("backs every selected source with a shipped GLB file", () => {
    const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as {
      assets: { id: string; file: string }[];
    };
    const entries = new Map(manifest.assets.map(entry => [entry.id, entry]));
    for (const assetId of ["fish_minnow", "fish_trout", "animal_perch"]) {
      const entry = entries.get(assetId);
      expect(entry, assetId).toBeDefined();
      const bytes = readFileSync(`game/public/assets/${entry!.file}`);
      expect(bytes.readUInt32LE(0), assetId).toBe(0x46546c67);
      expect(bytes.readUInt32LE(4), assetId).toBe(2);
      expect(bytes.readUInt32LE(8), assetId).toBe(bytes.length);
    }
  });

  it("applies cooked surface response to disposable clones", () => {
    const sourceMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.4 });
    const sourceGeometry = new THREE.BoxGeometry(1, 1, 1);
    const vertexCount = sourceGeometry.getAttribute("position").count;
    const sourceColours = new THREE.InterleavedBuffer(
      new Float32Array(Array.from({ length: vertexCount * 3 }, (_, index) => index % 6 < 3 ? 0.2 : 0.8)),
      3,
    );
    sourceGeometry.setAttribute("color", new THREE.InterleavedBufferAttribute(sourceColours, 3, 0));
    const source = new THREE.Group();
    source.add(new THREE.Mesh(sourceGeometry, sourceMaterial));

    const seared = prepareItemIconAsset(source, {
      kind: "asset", assetId: "fish_trout", colour: 0xb5774d, surfaceTreatment: "seared",
    });
    const charred = prepareItemIconAsset(source, {
      kind: "asset", assetId: "fish_trout", colour: 0x584035, surfaceTreatment: "charred", materialLift: 0.24,
    });
    const searedMaterial = (seared.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const charredMaterial = (charred.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const searedColours = (seared.children[0] as THREE.Mesh).geometry.getAttribute("color");

    expect(searedMaterial.roughness).toBe(0.76);
    expect(searedMaterial.metalness).toBe(0);
    expect(searedMaterial.color.getHex()).toBe(0xffffff);
    expect(searedColours.getX(0)).toBeGreaterThan(searedColours.getY(0));
    expect(sourceGeometry.getAttribute("color").getX(0)).toBeCloseTo(0.2);
    expect((seared.children[0] as THREE.Mesh).geometry).not.toBe(sourceGeometry);
    expect(charredMaterial.roughness).toBe(0.94);
    expect(charredMaterial.metalness).toBe(0);
    expect(charredMaterial.color.getHex()).toBe(0xffffff);
    expect(charredMaterial.emissive.getHex()).toBe(0x584035);
    expect(charredMaterial.emissiveIntensity).toBe(0.24);
    expect(sourceMaterial).toMatchObject({ roughness: 0.3, metalness: 0.4 });

    for (const object of [source, seared, charred]) object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
    });
  });
});
