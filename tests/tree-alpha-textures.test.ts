import { TREE_SPECIES, treeAssetIds } from "../game/src/content/treeSpecies.js";
import { NodeIO } from "@gltf-transform/core";
import { KHRMeshQuantization } from "@gltf-transform/extensions";
import sharp from "sharp";
import * as THREE from "three";
import type { MeshStandardNodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { applyCorealmSurfaceMaterials, type CorealmSurfaceTextures } from "../game/src/render/corealmSurfaceMaterials.js";
import { MaterialLibrary } from "../game/src/render/materials.js";
import { createArtDirectedMaterial } from "../game/src/render/artDirection.js";

describe("production tree cutouts", () => {
  it("keeps registered albedo, normal and roughness maps on authored surface node graphs", () => {
    const maps = () => ({ albedo: new THREE.Texture(), normal: new THREE.Texture(), roughness: new THREE.Texture(),
      meanLinearRgb: [0.2, 0.3, 0.1] as const, tileMetres: 2.4 });
    const textures: CorealmSurfaceTextures = { bark: maps(), stone: maps(), leaf: maps() };
    for (const [name, family] of [
      ["Bark_Corealm", "bark"], ["Corealm weathered strata", "stone"],
      ["Leaves_Corealm_needle", "leaf"], ["Leaves_Corealm_grass", "leaf"],
    ] as const) {
      const source = new THREE.MeshStandardMaterial({ name, vertexColors: true });
      const geometry = new THREE.PlaneGeometry();
      const mesh = new THREE.Mesh(geometry, source);
      applyCorealmSurfaceMaterials(mesh, textures);
      const material = mesh.material as unknown as MeshStandardNodeMaterial;
      expect(material.isMeshStandardNodeMaterial).toBe(true);
      expect(material.map).toBe(textures[family].albedo);
      expect(material.normalMap).toBe(textures[family].normal);
      expect(material.roughnessMap).toBe(textures[family].roughness);
      expect(material.colorNode).not.toBeNull();
      expect(material.vertexColors).toBe(true);
      expect(source.map).toBeNull();
      if (family === "leaf") {
        expect(material.normalNode).not.toBeNull();
        expect(material.roughnessNode).not.toBeNull();
      }
      material.dispose(); source.dispose(); geometry.dispose();
    }
    for (const family of Object.values(textures)) {
      family.albedo.dispose(); family.normal.dispose(); family.roughness.dispose();
    }
  });

  it("preserves red maple saturation through the production organic treatment", () => {
    const map = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ name: "Leaves_Corealm_broadleaf_maple_cutout", map });
    const treated = createArtDirectedMaterial(source, "foliage") as MeshStandardNodeMaterial;
    expect(treated.map).toBe(map);
    expect(treated.isMeshStandardNodeMaterial).toBe(true);
    expect(treated.roughnessNode).not.toBeNull();
    expect(treated.color.equals(source.color)).toBe(true);
    source.dispose(); treated.dispose(); map.dispose();
  });
  it("preserves authored bark albedo and relief through the production surface and organic passes", () => {
    const map = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ name: "Bark_Corealm", map });
    source.userData.corealmBarkRelief = true;
    source.userData.corealmMagicTree = true;
    const geometry = new THREE.CylinderGeometry();
    const mesh = new THREE.Mesh(geometry, source);
    const textures = {} as CorealmSurfaceTextures;
    applyCorealmSurfaceMaterials(mesh, textures);
    const treated = mesh.material;
    expect(treated.map).toBe(map);
    expect(treated.bumpMap).toBe(map);
    expect(treated.bumpScale).toBe(.035);
    expect(treated.userData.corealmMagicTree).toBe(true);
    const library = new MaterialLibrary();
    const final = library.organic(treated, "bark") as THREE.MeshStandardMaterial;
    expect(final.map).toBe(map);
    expect(final.bumpMap).toBe(map);
    expect((final as unknown as MeshStandardNodeMaterial).emissiveNode).not.toBeNull();
    applyCorealmSurfaceMaterials(mesh, textures);
    expect(mesh.material).toBe(treated);
    library.dispose(); geometry.dispose(); source.dispose(); treated.dispose(); map.dispose();
  });

  it("exports masked RGBA branch sprays on curved eight-triangle cards across every tree species", async () => {
    const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
    for (const id of TREE_SPECIES.flatMap(treeAssetIds)) {
      const doc = await io.read(`game/public/assets/models/corealm/nature/${id}.glb`);
      const mesh = doc.getRoot().listMeshes()[0]!;
      const leaves = mesh.listPrimitives().find(p => p.getMaterial()!.getName().endsWith("_cutout"))!;
      expect(leaves).toBeDefined();
      const material = leaves.getMaterial()!;
      expect(material.getAlphaMode()).toBe("MASK");
      expect(material.getAlphaCutoff()).toBe(0.32);
      expect(material.getDoubleSided()).toBe(true);
      const { data, info } = await sharp(material.getBaseColorTexture()!.getImage()!).raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height, info.channels]).toEqual([1024, 1024, 4]);
      let solid = 0, empty = 0;
      for (let i = 3; i < data.length; i += 4) { if (data[i]! > 128) solid++; else empty++; }
      expect(solid).toBeGreaterThan(10000);
      expect(empty).toBeGreaterThan(10000);
      const sprays = mesh.getExtras().corealmLeafSprays as number[][];
      expect(sprays.every(row => row[1] === 8)).toBe(true);
      expect(leaves.getIndices()!.getCount() / 3).toBe(sprays.length * 8);
    }
  });

  it("smooths colour cutouts through material clones while keeping depth-writing wind shadows", () => {
    const map = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ name: "Leaves_Corealm_broadleaf_cutout", map, alphaTest: 0.45, side: THREE.DoubleSide });
    const root = new THREE.Group();
    const geometry = new THREE.PlaneGeometry();
    const mesh = new THREE.Mesh(geometry, source);
    root.add(mesh);
    applyCorealmSurfaceMaterials(root, {} as CorealmSurfaceTextures);
    const treated = mesh.material as THREE.MeshStandardMaterial;
    expect(treated).not.toBe(source);
    expect(source.alphaToCoverage).toBe(false);
    expect(treated.alphaToCoverage).toBe(true);
    expect(treated.map).toBe(map);
    expect(map.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(map.magFilter).toBe(THREE.LinearFilter);
    expect(map.generateMipmaps).toBe(true);
    expect(map.anisotropy).toBe(8);
    const version = map.version;
    applyCorealmSurfaceMaterials(root, {} as CorealmSurfaceTextures);
    expect(mesh.material).toBe(treated);
    expect(map.version).toBe(version);
    const library = new MaterialLibrary();
    const wind = library.wind(library.organic(treated, "foliage"), 0.035) as MeshStandardNodeMaterial;
    expect(wind.alphaToCoverage).toBe(true);
    expect(wind.map).toBe(map);
    expect(wind.alphaTest).toBe(0.45);
    expect(wind.transparent).toBe(false);
    expect(wind.depthWrite).toBe(true);
    expect(wind.positionNode).not.toBeNull();
    expect(wind.alphaTestNode).not.toBeNull();
    library.dispose(); geometry.dispose(); source.dispose(); treated.dispose(); map.dispose();
  });
});
