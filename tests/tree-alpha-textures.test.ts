import { TREE_SPECIES, treeAssetIds } from "../game/src/content/treeSpecies.js";
import { NodeIO } from "@gltf-transform/core";
import { KHRMeshQuantization } from "@gltf-transform/extensions";
import sharp from "sharp";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyCorealmSurfaceMaterials, type CorealmSurfaceTextures } from "../game/src/render/corealmSurfaceMaterials.js";
import { MaterialLibrary } from "../game/src/render/materials.js";
import { createArtDirectedMaterial } from "../game/src/render/artDirection.js";

describe("production tree cutouts", () => {
  it("preserves red maple saturation through the production organic treatment", () => {
    const map = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ name: "Leaves_Corealm_broadleaf_maple_cutout", map });
    const treated = createArtDirectedMaterial(source, "foliage") as THREE.MeshStandardMaterial;
    const shader = { uniforms: {}, vertexShader: "", fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    treated.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(treated.map).toBe(map);
    expect(shader.fragmentShader).toContain("mix( vec3( organicLuma ), diffuseColor.rgb, 1.000 )");
    expect(shader.fragmentShader).not.toContain("diffuseColor.rgb, 0.720");
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
    expect(final.customProgramCacheKey()).toContain("magic-tree-v3");
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
    const wind = library.wind(library.organic(treated, "foliage"), 0.035) as THREE.MeshStandardMaterial;
    expect(wind.alphaToCoverage).toBe(true);
    for (const material of [wind, library.windShadow(wind, 0.035, "depth"), library.windShadow(wind, 0.035, "distance")]) {
      expect((material as THREE.MeshStandardMaterial).map).toBe(map);
      expect(material.alphaTest).toBe(0.45);
      expect(material.transparent).toBe(false);
      expect(material.depthWrite).toBe(true);
      // Shadow maps are not multisampled. Keep the source alpha-test silhouette there.
      expect(material.alphaToCoverage).toBe(material === wind);
    }
    library.dispose(); geometry.dispose(); source.dispose(); treated.dispose(); map.dispose();
  });
});
