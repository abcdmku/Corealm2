/** Stage original weapon candidates. Never writes the served catalogue. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRMaterialsClearcoat } from "@gltf-transform/extensions";
import { weld } from "@gltf-transform/functions";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import sharp from "sharp";
import { buildEquipmentWeapon, type WeaponForm, type WeaponGrade } from "../game/src/render/equipmentWeapons.js";
import type { AssetEntry } from "../game/src/render/assets.js";

export const EQUIPMENT_FORMS: readonly WeaponForm[] = ["sword", "dagger", "axe", "shield", "staff", "wand"];
export async function buildWeaponCandidate(form: WeaponForm, grade: WeaponGrade): Promise<{ glb: Uint8Array; entry: AssetEntry; gripCenter: number[]; sha256: string }> {
  const group = buildEquipmentWeapon(form, grade), id = `corealm_${form}_${grade + 1}`;
  group.updateMatrixWorld(true);
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene(id);
  doc.getRoot().setDefaultScene(scene);
  const rows = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>();
  group.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material as THREE.MeshStandardMaterial;
    let geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
    if (geometry.index) { const indexed = geometry; geometry = indexed.toNonIndexed(); indexed.dispose(); }
    const list = rows.get(material) ?? []; list.push(geometry); rows.set(material, list);
  });
  for (const [source, parts] of rows) {
    const geometry = mergeGeometries(parts)!;
    const material = doc.createMaterial(source.name).setBaseColorFactor([source.color.r, source.color.g, source.color.b, 1])
      .setMetallicFactor(source.metalness).setRoughnessFactor(source.roughness).setExtras({ equipmentRole: source.userData.equipmentRole });
    if (source instanceof THREE.MeshPhysicalMaterial && source.clearcoat > 0) material.setExtension("KHR_materials_clearcoat",
      doc.createExtension(KHRMaterialsClearcoat).createClearcoat().setClearcoatFactor(source.clearcoat).setClearcoatRoughnessFactor(source.clearcoatRoughness));
    if (source.map instanceof THREE.DataTexture) {
      const image = source.map.image;
      if (!image.data) throw new Error(`Missing pixels for ${source.map.name}`);
      const png = await sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer();
      material.setBaseColorTexture(doc.createTexture(source.map.name).setImage(png).setMimeType("image/png"));
      material.getBaseColorTextureInfo()!.setWrapS(10497).setWrapT(10497);
    }
    const primitive = doc.createPrimitive().setMaterial(material);
    for (const [name, semantic, type] of [["position", "POSITION", "VEC3"], ["normal", "NORMAL", "VEC3"], ["color", "COLOR_0", "VEC3"], ["uv", "TEXCOORD_0", "VEC2"]] as const) {
      const attribute = geometry.getAttribute(name);
      if (attribute) primitive.setAttribute(semantic, doc.createAccessor(name).setType(type).setArray(new Float32Array(attribute.array)).setBuffer(buffer));
    }
    scene.addChild(doc.createNode(source.name).setMesh(doc.createMesh(source.name).addPrimitive(primitive)));
    geometry.dispose(); parts.forEach(part => part.dispose());
  }
  await doc.transform(weld());
  const glb = await new NodeIO().registerExtensions([KHRMaterialsClearcoat]).writeBinary(doc);
  const bounds = new THREE.Box3().setFromObject(group), size = bounds.getSize(new THREE.Vector3());
  const entry: AssetEntry = { id, file: `models/corealm/equipment/${id}.glb`, pack: "corealm-original-equipment", category: "weapon", is: form,
    tags: [form, "equipment", "original", "candidate"], bytes: glb.byteLength,
    size: { x: size.x, y: size.y, z: size.z }, base: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
    animations: [], materials: doc.getRoot().listMaterials().map(m => m.getName()) };
  group.traverse(child => { if (child instanceof THREE.Mesh) child.geometry.dispose(); });
  for (const material of rows.keys()) { material.map?.dispose(); material.dispose(); }
  return { glb, entry, gripCenter: group.userData.gripCenter as number[], sha256: createHash("sha256").update(glb).digest("hex") };
}

async function main(): Promise<void> {
  const out = path.resolve(process.argv[2] ?? "art/rebuild/candidates/2026-09-05/equipment-v1");
  if (out.toLowerCase().includes(`${path.sep}game${path.sep}public`)) throw new Error("Equipment candidates cannot write game/public");
  const entries = [];
  for (const form of EQUIPMENT_FORMS) for (const grade of [0, 1, 2, 3] as const) {
    const { glb, ...row } = await buildWeaponCandidate(form, grade);
    const destination = path.join(out, row.entry.file);
    await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, glb); entries.push(row);
  }
  await writeFile(path.join(out, "catalogue.json"), JSON.stringify({ status: "unreviewed-candidate",
    pack: { id: "corealm-original-equipment", name: "Corealm original equipment", author: "Corealm", license: "LicenseRef-Corealm-Original", source: "tools/build-corealm-equipment.ts" },
    assets: entries.map(row => ({ ...row.entry, sha256: row.sha256, gripCenter: row.gripCenter })),
  }, null, 2));
  await writeFile(path.join(out, "held-catalogue.json"), JSON.stringify({
    status: "browser-only-native-grip-aliases",
    pack: { id: "corealm-original-equipment", name: "Corealm original equipment", author: "Corealm", license: "LicenseRef-Corealm-Original", source: "tools/build-corealm-equipment.ts" },
    assets: entries.filter(row => ["corealm_sword_1", "corealm_axe_1"].includes(row.entry.id))
      .map(row => ({ ...row.entry, id: row.entry.is, sha256: row.sha256, gripCenter: row.gripCenter })),
  }, null, 2));
  process.stdout.write(`${entries.length} weapon candidates staged in ${out}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
