/** CPU-only candidate exporter. It does not promote the public manifest. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import sharp from 'sharp';
import { derivativePack } from './packs.mjs';
import { applyGaitMetadata } from './gait-metadata.mjs';
import { externalizeGlbMaterialTextures } from '../lib/shared-material-textures.ts';

async function runtimeTexture(file, flipY) {
  let pipeline = sharp(file).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
  if (flipY) pipeline = pipeline.flip();
  return pipeline.png().toBuffer();
}
import { buildHumanoid } from './humanoids.mjs';
import { buildUndead } from './undead.mjs';
import { buildMythic } from './mythic.mjs';
import { buildWholeInsect } from './whole-insects/index.mjs';

const families = {
  humanoid: ['goblin_scout','goblin_archer','goblin_shaman','orc_warrior','orc_berserker','orc_warlord','gnoll_hunter','gnoll_brute','gnoll_chieftain','lizardman_scout','lizardman_guard','lizardman_shaman'],
  undead: ['skeleton_soldier','skeleton_archer','skeleton_mage','zombie','plague_zombie','grave_ghoul','wraith','banshee','revenant','stone_golem','iron_golem','fire_golem'],
  mythic: ['harpy','cliff_harpy','storm_harpy','gargoyle','obsidian_gargoyle','ancient_gargoyle','minotaur','labyrinth_guardian','elder_minotaur','imp','horned_demon','abyssal_demon'],
};
export const BESTIARY_IDS = ['goblin_scout','goblin_archer','goblin_shaman','skeleton_soldier','skeleton_archer','skeleton_mage','zombie','plague_zombie','grave_ghoul','wraith','banshee','revenant','stone_golem','iron_golem','fire_golem','webweaver_spider','marsh_wasp'];
export function buildBestiary(id) {
  const result = ['webweaver_spider','marsh_wasp'].includes(id) ? buildWholeInsect(id) : families.humanoid.includes(id) ? buildHumanoid(id)
    : families.undead.includes(id) ? buildUndead(id)
    : families.mythic.includes(id) ? buildMythic(id) : null;
  if (!result) throw new Error(`Unknown RPG bestiary ID ${id}`);
  const helpers = [];
  result.object.traverse(node => { if (node.isLight || node.isCamera || node.isLine || node.isPoints) helpers.push(node); });
  for (const node of helpers) node.removeFromParent();
  const materials = new Set();
  result.object.traverse(node => { if (node.isMesh) for (const mat of Array.isArray(node.material) ? node.material : [node.material]) materials.add(mat); });
  // Existing renderer contract: authored creature colours use the animal_ prefix.
  // Without this, enemy tier dyes replace 45% of every skin/cloth/stone colour.
  for (const mat of materials) if (!mat.name.startsWith('animal_')) mat.name = `animal_rpg_${id}_${mat.name}`;
  return result;
}

/** Rigid authored parts become weighted meshes sharing one articulated skeleton.
 * This preserves the original transform clips while using the production skinning path.
 * Organic joint blending still needs visual review; no deformation quality is inferred here.
 */
export function skinArticulated(object) {
  let alreadySkinned = false;
  object.traverse(node => { if (node.isSkinnedMesh) alreadySkinned = true; });
  if (alreadySkinned) return cloneRig(object);
  object.updateMatrixWorld(true);
  const container = new THREE.Group(); container.name = 'bestiary_asset';
  const bones = [], byNode = new Map(), groups = new Map();
  function visit(node, parentBone) {
    let bone = parentBone;
    if (!node.isMesh) {
      bone = new THREE.Bone(); bone.name = node.name || `joint_${bones.length}`;
      bone.position.copy(node.position); bone.quaternion.copy(node.quaternion); bone.scale.copy(node.scale);
      (parentBone ?? container).add(bone); bones.push(bone); byNode.set(node, bone);
    }
    for (const child of node.children) visit(child, bone);
  }
  visit(object, null); container.updateMatrixWorld(true);
  object.traverse(node => {
    if (!node.isMesh) return;
    if (Array.isArray(node.material)) throw new Error(`Split multi-material source ${node.name} before export`);
    let parent = node.parent;
    while (parent && !byNode.has(parent)) parent = parent.parent;
    const joint = bones.indexOf(byNode.get(parent));
    if (joint < 0) throw new Error(`No joint for ${node.name}`);
    let geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    // Indexed and unindexed source builders are normalized before combining materials.
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const name of Object.keys(geometry.attributes)) if (!['position','normal','uv','color'].includes(name)) geometry.deleteAttribute(name);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const count = geometry.attributes.position.count;
    if (!geometry.attributes.color) geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { indices[i * 4] = joint; weights[i * 4] = 1; }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const rows = groups.get(node.material) ?? []; rows.push(geometry); groups.set(node.material, rows);
  });
  const skeleton = new THREE.Skeleton(bones); skeleton.calculateInverses();
  for (const [material, geometries] of groups) {
    const merged = mergeGeometries(geometries);
    if (!merged) throw new Error(`Cannot merge material ${material.name}`);
    const mesh = new THREE.SkinnedMesh(merged, material); mesh.name = `skin_${material.name || groups.size}`;
    container.add(mesh); mesh.bind(skeleton); mesh.frustumCulled = false;
  }
  container.updateMatrixWorld(true);
  return container;
}

class NodeFileReader {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
}

export async function exportBestiary(ids = BESTIARY_IDS, out = 'art/rebuild/candidates/finish-bestiary', { append = false, factory = buildBestiary, measureAfterExport = false } = {}) {
  globalThis.FileReader ??= NodeFileReader;
  await mkdir(path.join(out, 'models'), { recursive: true });
  const previous = append ? JSON.parse(await readFile(path.join(out, 'catalog.json'), 'utf8')) : null;
  const assets = (previous?.assets ?? []).filter(asset => !ids.includes(asset.id.replace(/^creature_/, '')));
  const packs = new Map((previous?.packs ?? []).map(pack => [pack.id, pack]));
  const sharedTextures = new Map((previous?.sharedTextures ?? []).map(texture => [texture.file, texture]));
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
  for (const id of ids) {
    const { object, clips, meta } = await factory(id);
    const sourceProvenance = meta.provenance ?? meta.sourceProvenance;
    const sourcePack = derivativePack(sourceProvenance);
    packs.set(sourcePack.id, sourcePack);
    const skinned = skinArticulated(object);
    const bytes = new Uint8Array(await new GLTFExporter().parseAsync(skinned, { binary: true, animations: clips, onlyVisible: false }));
    const doc = await io.readBinary(bytes);
    for (const binding of meta.textureBindings ?? []) {
      const material = doc.getRoot().listMaterials().find(m => m.getName() === `animal_rpg_${id}_${binding.materialName}` || m.getName() === binding.materialName);
      if (!material) throw new Error(`${id}: no exported texture material ${binding.materialName}`);
      if (binding.baseColorPath) {
        const imageBytes = await runtimeTexture(binding.baseColorPath, binding.flipY);
        const texture = doc.createTexture(`${id}_${binding.materialName}_albedo`).setImage(new Uint8Array(imageBytes)).setMimeType('image/png');
        material.setBaseColorTexture(texture);
      }
      if (binding.normalPath) {
        const imageBytes = await runtimeTexture(binding.normalPath, binding.flipY);
        const texture = doc.createTexture(`${id}_${binding.materialName}_normal`).setImage(new Uint8Array(imageBytes)).setMimeType('image/png');
        material.setNormalTexture(texture);
      }
      if (binding.aoPath) {
        const imageBytes = await runtimeTexture(binding.aoPath, binding.flipY);
        const texture = doc.createTexture(`${id}_${binding.materialName}_occlusion`).setImage(new Uint8Array(imageBytes)).setMimeType('image/png');
        material.setOcclusionTexture(texture).setOcclusionStrength(binding.aoStrength ?? 1);
        material.getOcclusionTextureInfo().setTexCoord(binding.aoTexCoord ?? 0);
      }
      if (binding.emissivePath) {
        const imageBytes = await runtimeTexture(binding.emissivePath, binding.flipY);
        const texture = doc.createTexture(`${id}_${binding.materialName}_emissive`).setImage(new Uint8Array(imageBytes)).setMimeType('image/png');
        const strength = binding.emissiveStrength ?? 1;
        if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error(`${id}: emissive factor requires standard glTF range 0–1`);
        material.setEmissiveTexture(texture).setEmissiveFactor([strength, strength, strength]);
        material.getEmissiveTextureInfo().setTexCoord(binding.emissiveTexCoord ?? 0);
      }
      if (binding.metallicRoughnessPath) {
        const imageBytes = await runtimeTexture(binding.metallicRoughnessPath, binding.flipY);
        const texture = doc.createTexture(`${id}_${binding.materialName}_metallic_roughness`).setImage(new Uint8Array(imageBytes)).setMimeType('image/png');
        material.setMetallicRoughnessTexture(texture);
      }
    }
    await doc.transform(dedup(), prune());
    const shared = externalizeGlbMaterialTextures(await io.writeBinary(doc), `models/creature/creature_${id}.glb`);
    const binary = shared.glb;
    for (const texture of shared.textures) {
      if (sharedTextures.has(texture.file)) continue;
      await mkdir(path.dirname(path.join(out, texture.file)), { recursive: true });
      await writeFile(path.join(out, texture.file), texture.bytes);
      sharedTextures.set(texture.file, { file: texture.file, bytes: texture.bytes.length, sha256: texture.sha256, mimeType: texture.mimeType });
    }
    // Prime actual Idle deformation. Imported skin bind matrices can report a
    // tiny bind-pose bound before the animation mixer updates their world pose.
    const boundsMixer = new THREE.AnimationMixer(skinned);
    boundsMixer.clipAction(clips.find(clip => clip.name === 'Idle')).play();
    boundsMixer.setTime(0); skinned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(skinned, true), size = box.getSize(new THREE.Vector3());
    boundsMixer.stopAllAction(); boundsMixer.uncacheRoot(skinned);
    const required = ['Idle','Walk','Run','Attack','Hit','HitLeft','HitRight','Death'];
    for (const name of required) if (!clips.some(clip => clip.name === name && clip.duration > 0)) throw new Error(`${id}: missing ${name}`);
    const triangles = doc.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
    const entry = {
      id: `creature_${id}`, file: `models/creature/creature_${id}.glb`, candidateFile: `models/creature/creature_${id}.glb`,
      pack: sourcePack.id, category: 'character', is: id.replaceAll('_',' '), tags: ['creature','rpg',id],
      bytes: binary.byteLength, sha256: createHash('sha256').update(binary).digest('hex'),
      size: { x: size.x, y: size.y, z: size.z }, base: { x: box.min.x, y: box.min.y, z: box.min.z }, groundY: box.min.y,
      triangles, animations: clips.map(c => c.name), materials: doc.getRoot().listMaterials().map(m => m.getName()),
      walkClipSeconds: clips.find(c => c.name === 'Walk').duration, runClipSeconds: clips.find(c => c.name === 'Run').duration,
      attackSeconds: clips.find(c => c.name === 'Attack').duration,
      contactNormalized: meta.contactNormalized ?? meta.attackContactPhase ?? meta.attackContact ?? .45,
      sourceProvenance: meta.provenance ?? meta.sourceProvenance ?? { author: 'Corealm', license: 'Original project asset', generators: ['tools/rpg-bestiary/'], sourceInventory: 'source-inventory.json' },
      metadata: { ...meta, runtimeTexturePolicy: { maxDimension: 2048, sharedByEncodedSha256: true, originalsPreserved: true } }, acceptance: { exported: true, labAccepted: false, worldIntegrated: false },
    };
    if(measureAfterExport)entry.metadata.gaitMeasurement={status:'pending-exact-source-measurement',visualContactAccepted:false};
    else applyGaitMetadata(entry);
    await mkdir(path.dirname(path.join(out, entry.candidateFile)), { recursive: true });
    await writeFile(path.join(out, entry.candidateFile), binary); assets.push(entry);
    console.log(JSON.stringify({ id, bytes: entry.bytes, triangles, bones: doc.getRoot().listSkins()[0]?.listJoints().length }));
    skinned.traverse(node => { if (node.isMesh) node.geometry.dispose(); });
  }
  await writeFile(path.join(out, 'catalog.json'), JSON.stringify({
    packs: [...packs.values()],
    sharedTextures: [...sharedTextures.values()],
    files: Object.fromEntries(assets.map(asset => [asset.id, asset.candidateFile])), assets,
  }, null, 2) + '\n');
  return assets;
}

if (process.argv[1]?.replaceAll('\\','/').endsWith('/rpg-bestiary/build.mjs')) await exportBestiary(process.argv.slice(2).length ? process.argv.slice(2) : BESTIARY_IDS);
