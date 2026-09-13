import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Document, NodeIO, type Material, type Texture, type TextureInfo } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsClearcoat, KHRMaterialsTransmission, KHRMaterialsIOR, KHRMaterialsVolume, KHRTextureTransform } from "@gltf-transform/extensions";
import { weld } from "@gltf-transform/functions";
import sharp from "sharp";
import { ALL_ITEMS } from "../../game/src/content/items.js";
import type { AssetEntry } from "../../game/src/render/assets.js";
import { metadata, type ItemModelAuthor } from "./contracts.js";
import { attachItemSkin } from "./skin.js";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const arg = (flag: string) => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
const authorName = arg("--author");
if (!authorName || !/^[a-z0-9-]+$/.test(authorName)) throw new Error("Use --author <module-name>");
const sourcePath = path.resolve("tools/item-models/authors", `${authorName}.ts`);
const out = path.resolve(arg("--out") ?? `art/item-models/candidates/${authorName}`);
const relative = path.relative(path.resolve("art/item-models/candidates"), out);
if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Candidate output must stay in art/item-models/candidates");
const module = await import(pathToFileURL(sourcePath).href) as { author: ItemModelAuthor };
const author = module.author;
if (!author?.ids?.length || new Set(author.ids).size !== author.ids.length) throw new Error("Invalid author catalog");
const pack = { id: "corealm-icon-item-models", name: "Corealm item models from approved artwork", author: "Corealm", license: "LicenseRef-Corealm-Original", source: "tools/item-models/build.ts", generatorSha256: hash(await readFile("tools/item-models/build.ts")) };
const records = [];
const sourceSha256 = hash(await readFile(sourcePath));

for (const id of author.ids) {
  const item = ALL_ITEMS.find(item => item.id === id);
  if (!item) throw new Error(`Unknown item ${id}`);
  const group = author.build(id);
  const meta = metadata(group);
  if (meta.itemId !== id) throw new Error(`Wrong model ID ${id}`);
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group, true), size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw new Error(`Invalid bounds ${id}`);
  if (Math.min(size.x, size.y, size.z) <= 0.0001) throw new Error(`Model has no meaningful volume ${id}`);
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene(id);
  doc.getRoot().setDefaultScene(scene);
  const textures = new Map<THREE.Texture, Texture>();
  async function texture(source: THREE.Texture): Promise<Texture> {
    const existing = textures.get(source); if (existing) return existing;
    if (!(source instanceof THREE.DataTexture)) throw new Error(`${id}: author textures must be DataTexture`);
    const image = source.image;
    if (!(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)) throw new Error(`${id}: texture pixels must be byte data`);
    const channels = image.data.length / (image.width * image.height);
    if (![1, 2, 3, 4].includes(channels)) throw new Error(`${id}: invalid texture channels`);
    const pixels = Buffer.from(image.data);
    if (source.colorSpace === THREE.LinearSRGBColorSpace) {
      // glTF color textures store sRGB bytes, regardless of the author's working space.
      for (let offset = 0; offset < pixels.length; offset += channels) {
        for (let channel = 0; channel < Math.min(3, channels); channel++) {
          const linear = pixels[offset + channel]! / 255;
          pixels[offset + channel] = Math.round(255 * (linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055));
        }
      }
    }
    const png = await sharp(pixels, {
      raw: { width: image.width, height: image.height, channels: channels as 1 | 2 | 3 | 4 },
    }).png().toBuffer();
    const result = doc.createTexture(source.name || `texture-${textures.size}`).setImage(png).setMimeType("image/png");
    textures.set(source, result); return result;
  }
  const materials = new Map<THREE.MeshStandardMaterial, Material>();
  function textureSampling(info: TextureInfo, source: THREE.Texture): void {
    info.setWrapS(source.wrapS === THREE.RepeatWrapping ? 10497 : source.wrapS === THREE.MirroredRepeatWrapping ? 33648 : 33071)
      .setWrapT(source.wrapT === THREE.RepeatWrapping ? 10497 : source.wrapT === THREE.MirroredRepeatWrapping ? 33648 : 33071);
    if (source.rotation || source.center.lengthSq()) throw new Error(`${id}: bake rotated/centered texture transforms explicitly`);
    if (source.repeat.x !== 1 || source.repeat.y !== 1 || source.offset.lengthSq()) {
      info.setExtension("KHR_texture_transform", doc.createExtension(KHRTextureTransform).createTransform()
        .setScale(source.repeat.toArray()).setOffset(source.offset.toArray()));
    }
  }
  async function material(source: THREE.MeshStandardMaterial): Promise<Material> {
    const existing = materials.get(source); if (existing) return existing;
    const result = doc.createMaterial(source.name || `material-${materials.size}`)
      .setBaseColorFactor([source.color.r, source.color.g, source.color.b, source.opacity])
      .setMetallicFactor(source.metalness).setRoughnessFactor(source.roughness)
      .setEmissiveFactor(source.emissive.toArray().map(v => v * source.emissiveIntensity) as [number, number, number])
      .setDoubleSided(source.side === THREE.DoubleSide).setExtras({ ...source.userData, iconAuthored: true });
    if (source.transparent) result.setAlphaMode("BLEND");
    else if (source.alphaTest > 0) result.setAlphaMode("MASK").setAlphaCutoff(source.alphaTest);
    if (source.map) {
      result.setBaseColorTexture(await texture(source.map));
      textureSampling(result.getBaseColorTextureInfo()!, source.map);
    }
    if (source.normalMap) {
      result.setNormalTexture(await texture(source.normalMap)).setNormalScale(source.normalScale.x);
      textureSampling(result.getNormalTextureInfo()!, source.normalMap);
    }
    if (source.bumpMap) throw new Error(`${id}: convert bumpMap to a tangent normalMap for GLB export`);
    if (source.roughnessMap || source.metalnessMap) {
      const rough = source.roughnessMap, metal = source.metalnessMap;
      for (const map of [rough, metal]) if (map && !(map instanceof THREE.DataTexture)) throw new Error(`${id}: ORM maps must be DataTexture`);
      const basis = (rough ?? metal) as THREE.DataTexture;
      const { width, height } = basis.image;
      const packed = new Uint8Array(width * height * 4);
      const sample = (map: THREE.Texture | null, offset: number, channel: number): number => {
        if (!map) return 255;
        const image = (map as THREE.DataTexture).image;
        if (image.width !== width || image.height !== height) throw new Error(`${id}: ORM map sizes differ`);
        const channels = image.data!.length / (width * height);
        return Number(image.data![offset * channels + Math.min(channel, channels - 1)]);
      };
      for (let pixel = 0; pixel < width * height; pixel++) {
        packed[pixel * 4] = 255;
        packed[pixel * 4 + 1] = sample(rough, pixel, 1);
        packed[pixel * 4 + 2] = sample(metal, pixel, 2);
        packed[pixel * 4 + 3] = 255;
      }
      const orm = new THREE.DataTexture(packed, width, height, THREE.RGBAFormat);
      orm.name = `${source.name}-metallic-roughness`;
      result.setMetallicRoughnessTexture(await texture(orm));
      textureSampling(result.getMetallicRoughnessTextureInfo()!, basis);
    }
    if (source.emissiveMap) {
      result.setEmissiveTexture(await texture(source.emissiveMap));
      textureSampling(result.getEmissiveTextureInfo()!, source.emissiveMap);
    }
    if (source instanceof THREE.MeshPhysicalMaterial) {
      if (source.clearcoat > 0) result.setExtension("KHR_materials_clearcoat", doc.createExtension(KHRMaterialsClearcoat).createClearcoat().setClearcoatFactor(source.clearcoat).setClearcoatRoughnessFactor(source.clearcoatRoughness));
      if (source.transmission > 0) result.setExtension("KHR_materials_transmission", doc.createExtension(KHRMaterialsTransmission).createTransmission().setTransmissionFactor(source.transmission));
      if (source.ior !== 1.5) result.setExtension("KHR_materials_ior", doc.createExtension(KHRMaterialsIOR).createIOR().setIOR(source.ior));
      if (source.thickness > 0) result.setExtension("KHR_materials_volume", doc.createExtension(KHRMaterialsVolume).createVolume()
        .setThicknessFactor(source.thickness).setAttenuationDistance(source.attenuationDistance).setAttenuationColor(source.attenuationColor.toArray() as [number, number, number]));
    }
    materials.set(source, result); return result;
  }
  const parts = new Map<string, { source: THREE.MeshStandardMaterial; part?: string; bone?: string; deform?: string; geometries: THREE.BufferGeometry[]; names: string[] }>();
  group.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    let geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
    if (geometry.index) { const old = geometry; geometry = geometry.toNonIndexed(); old.dispose(); }
    if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
    if (!geometry.hasAttribute("uv")) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 2), 2));
    if (!geometry.hasAttribute("color")) {
      const colors = new Float32Array(geometry.getAttribute("position").count * 3).fill(1);
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    }
    for (const name of Object.keys(geometry.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) geometry.deleteAttribute(name);
    const slices = Array.isArray(child.material) ? geometry.groups : [{ start: 0, count: geometry.getAttribute("position").count, materialIndex: 0 }];
    if (!slices.length) throw new Error(`${id}: material array needs geometry groups`);
    for (const slice of slices) {
      const source = Array.isArray(child.material) ? child.material[slice.materialIndex ?? 0] : child.material;
      if (!(source instanceof THREE.MeshStandardMaterial)) throw new Error(`${id}: use PBR materials`);
      const piece = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "uv", "color"]) {
        const attribute = geometry.getAttribute(name);
        const values = new Float32Array(attribute.array.slice(slice.start * attribute.itemSize, (slice.start + slice.count) * attribute.itemSize));
        if (name === "color" && !source.vertexColors) values.fill(1);
        piece.setAttribute(name, new THREE.Float32BufferAttribute(values, attribute.itemSize));
      }
      const part = child.userData["itemModelPart"] as string | undefined;
      if (part && part !== "tackle") throw new Error(`${id}: unknown itemModelPart ${part}`);
      const bone = child.userData["itemModelBone"] as string | undefined;
      const deform = child.userData["itemModelDeform"] as string | undefined;
      if (deform && deform !== "skirt" && deform !== "native-hand") throw new Error(`${id}: unknown deformation ${deform}`);
      if (bone && deform) throw new Error(`${id}: a part cannot be both rigid and cloth`);
      if (bone && !meta.wearable) throw new Error(`${id}: rigid skin bone requires wearable geometry`);
      const key = `${source.uuid}:${part ?? ""}:${bone ?? ""}:${deform ?? ""}`;
      const row = parts.get(key) ?? { source, part, bone, deform, geometries: [], names: [] };
      row.geometries.push(piece); row.names.push(child.name); parts.set(key, row);
    }
    geometry.dispose();
  });
  let triangles = 0;
  for (const row of parts.values()) {
    const source = row.source;
    const geometry = mergeGeometries(row.geometries);
    if (!geometry) throw new Error(`${id}: incompatible attributes in material group`);
    const primitive = doc.createPrimitive().setMaterial(await material(source));
    for (const [name, semantic, type] of [["position", "POSITION", "VEC3"], ["normal", "NORMAL", "VEC3"], ["uv", "TEXCOORD_0", "VEC2"], ["color", "COLOR_0", "VEC3"]] as const) {
      const attribute = geometry.getAttribute(name);
      primitive.setAttribute(semantic, doc.createAccessor(name).setType(type).setArray(new Float32Array(attribute.array)).setBuffer(buffer));
    }
    triangles += geometry.getAttribute("position").count / 3;
    scene.addChild(doc.createNode(source.name).setMesh(doc.createMesh(source.name).addPrimitive(primitive)).setExtras({ sourceParts: row.names, ...(row.part ? { itemModelPart: row.part } : {}), ...(row.bone ? { itemModelBone: row.bone } : {}), ...(row.deform ? { itemModelDeform: row.deform } : {}) }));
    geometry.dispose(); row.geometries.forEach(g => g.dispose());
  }
  if (!triangles || triangles > 150000) throw new Error(`${id}: triangle budget ${triangles}`);
  scene.setExtras({ itemModel: meta });
  if (meta.wearable) await attachItemSkin(doc, id);
  await doc.transform(weld());
  const glb = await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc);
  const assetId = `corealm_item_${id}`, file = `models/items/${id}.glb`;
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await writeFile(path.join(out, file), glb);
  const regionTags: Record<string, string> = { body: "torso", hands: "arms", legs: "legs", feet: "feet", head: "head" };
  const entry: AssetEntry = { id: assetId, file, pack: pack.id, category: meta.wearable ? "outfit" : "prop", is: "item", tags: ["item-model", "icon-authored", id, ...(meta.wearable && item.equip ? [regionTags[item.equip.slot]!] : [])], bytes: glb.byteLength,
    itemModel: { itemId: id, wearable: meta.wearable, grip: meta.grip, focus: meta.focus, fishing: meta.fishing, bodyCoverage: meta.bodyCoverage },
    size: { x: size.x, y: size.y, z: size.z }, base: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z }, animations: [], materials: [...materials.values()].map(m => m.getName()) };
  records.push({ ...entry, itemId: id, status: "pending", sha256: hash(glb), sourceSha256, referenceSha256: hash(await readFile(path.resolve(meta.reference))), metadata: meta, triangles, drawCalls: parts.size });
  console.log(`${id}: ${triangles} triangles, ${materials.size} materials, ${glb.byteLength} bytes`);
}
await writeFile(path.join(out, "catalogue.json"), JSON.stringify({ version: 1, status: "pending", pack, assets: records }, null, 2));
