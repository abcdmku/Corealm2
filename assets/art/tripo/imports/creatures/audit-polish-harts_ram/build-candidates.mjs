import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureTransform } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.js';
import { applyClip, duration, restorePose, storedPose } from '../../../../../../tools/creature-motion/pose.js';

const out = 'assets/art/tripo/imports/creatures/audit-polish-harts_ram';
const staged = 'assets/art/tripo/imports/creatures';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest = JSON.parse(await readFile(`${out}/source-manifest.json`, 'utf8'));
const builderSha256 = sha(await readFile(new URL(import.meta.url)));
await mkdir(`${out}/models`, { recursive: true });
await mkdir(`${out}/textures`, { recursive: true });

const specs = [
  {
    id: 'creature_crown_hart', source: `${out}/sources/creature_crown_hart.glb`,
    texture: `${out}/textures/creature_crown_hart-imagegen.png`,
    runtimeTexture: null, change: 'Native skinned antlers widened progressively up to 52% at upper tines and raised 12% above local Y 143.5; base below Y 143.5, deer body, skin weights and eight clips retained exactly. Existing detailed coat/antler map contributes restrained warm textured fill under dim lab lighting.',
    contactNormalized: .43, tier: 48,
  },
  {
    id: 'fairy_garden_hart_faeholme', source: `${out}/sources/starhorn-hart-candidate.glb`,
    texture: `${out}/textures/fairy_garden_hart_faeholme-imagegen.png`,
    runtimeTexture: `${out}/textures/fairy_garden_hart_faeholme-runtime.jpg`,
    change: 'Reused staged Starhorn sculpt: native antlers broadened toward tips and overall deer scale 1.16x; body, rig, weights and eight clips retained.',
    contactNormalized: .43, tier: 115,
  },
  {
    id: 'creature_cairn_bighorn', source: `${out}/sources/bighorn-candidate.glb`,
    texture: `${out}/textures/creature_cairn_bighorn-imagegen-fine.png`,
    runtimeTexture: null,
    change: 'Extended staged wool sculpt: coat-only rib and shoulder lateral bulk increased progressively to about 18% over production, upper fleece raised by at most 3 cm; horns, head, lower legs, hooves, rig and eight clips retained. New image-generated fine wool albedo replaces oversized swirl map; normal and roughness maps repeat 2.5x. Coat-only smooth tint removes source wave bands. Natural creature materials bypass generic enemy tier paint.',
    contactNormalized: .46, tier: 13,
  },
];

const assets = [], promotions = [], files = {};
for (const spec of specs) {
  const sourceBytes = await readFile(spec.source);
  const sourceDoc = await io.readBinary(sourceBytes);
  const sourceRoot = sourceDoc.getRoot();
  const sourceClips = sourceRoot.listAnimations().map(c => [c.getName(), duration(c)]);
  const sourceJoints = sourceRoot.listSkins().map(s => s.listJoints().map(j => j.getName()));
  if (sourceClips.length !== 8) throw new Error(`${spec.id}: expected eight native clips`);
  if (spec.id === 'creature_crown_hart') {
    const horns = sourceRoot.listNodes().find(n => n.getName() === 'deer_horns');
    const position = horns?.getMesh()?.listPrimitives()[0]?.getAttribute('POSITION');
    if (!horns?.getSkin() || position?.getCount() !== 397) throw new Error('Unexpected crown antler geometry/skin');
    const v = [];
    for (let i = 0; i < position.getCount(); i++) {
      position.getElement(i, v);
      const baseY = 143.5;
      const t = Math.max(0, Math.min(1, (v[1] - baseY) / (186.7349 - baseY)));
      v[0] *= 1 + .52 * t;
      if (v[1] > baseY) v[1] = baseY + (v[1] - baseY) * 1.12;
      position.setElement(i, v);
    }
    const material = sourceRoot.listMaterials()[0];
    material.setBaseColorFactor([1, .94, .86, 1]);
    material.setRoughnessFactor(.7);
    material.setEmissiveTexture(material.getBaseColorTexture());
    material.setEmissiveFactor([.18, .11, .07]);
    material.setName('animal_crown_hart_regal_coat_and_ivory_antlers');
  }
  if (spec.id === 'creature_cairn_bighorn') {
    const coat = sourceRoot.listMeshes()[0]?.listPrimitives().find(p => p.getMaterial()?.getName() === 'Sculpted_coat');
    const position = coat?.getAttribute('POSITION');
    const sourceColor = coat?.getAttribute('COLOR_0');
    if (!position || !sourceColor || sourceRoot.listSkins()[0]?.listJoints().length !== 26) throw new Error('Unexpected bighorn coat/rig');
    // COLOR_0 is shared by every source material. Split only the fleece accessor so the
    // horn, muzzle, eyes, hooves, and ears retain their authored color variation.
    const color = sourceDoc.createAccessor('Cairn bighorn neutral wool tint')
      .setType(sourceColor.getType()).setArray(Float32Array.from(sourceColor.getArray()))
      .setBuffer(sourceColor.getBuffer());
    coat.setAttribute('COLOR_0', color);
    const v = [];
    for (const i of new Set(coat.getIndices().getArray())) {
      position.getElement(i, v);
      const height = Math.max(0, Math.min(1, (v[1] - .55) / .35));
      const foreAft = Math.max(0, Math.min(1, (v[2] + .82) / .25, (.95 - v[2]) / .25));
      const mask = height * foreAft;
      position.setElement(i, [v[0] * (1 + .10 * mask), v[1] + .03 * mask, v[2]]);
      const torso = Math.max(0, Math.min(1, (v[1] - .35) / .6));
      const smoothTorso = torso * torso * (3 - 2 * torso);
      const warmth = .73 + .23 * smoothTorso;
      color.setElement(i, [warmth, warmth * .95, warmth * .88]);
    }
    const material = coat.getMaterial();
    const generatedFine = await readFile(spec.texture);
    const runtimeFine = await sharp(generatedFine).resize(1024, 1024, { kernel: 'lanczos3' })
      .jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();
    material.getBaseColorTexture().setImage(runtimeFine).setMimeType('image/jpeg')
      .setName('Image-generated fine natural bighorn wool');
    const transformExtension = sourceRoot.listExtensionsUsed().find(e => e.extensionName === 'KHR_texture_transform')
      ?? sourceDoc.createExtension(KHRTextureTransform);
    const woolScale = transformExtension.createTransform().setScale([2.5, 2.5]);
    for (const info of [material.getBaseColorTextureInfo(), material.getNormalTextureInfo(), material.getMetallicRoughnessTextureInfo()]) {
      if (info) info.setExtension('KHR_texture_transform', woolScale);
    }
    material.setRoughnessFactor(.84);
    material.setEmissiveTexture(material.getBaseColorTexture());
    material.getEmissiveTextureInfo().setExtension('KHR_texture_transform', woolScale);
    material.setEmissiveFactor([.12, .10, .075]);
    for (const sourceMaterial of sourceRoot.listMaterials()) sourceMaterial.setName(`animal_${sourceMaterial.getName()}`);
  }
  const pose = storedPose(sourceDoc);
  const bounds = deformedBounds(sourceDoc);
  const motion = {};
  for (const clip of sourceRoot.listAnimations()) {
    const seconds = duration(clip), samples = [];
    for (const f of [0, .25, .5, .75, 1]) {
      restorePose(pose);
      applyClip(clip, seconds * f);
      const b = deformedBounds(sourceDoc);
      samples.push({ fraction: f, minY: b.min[1], maxY: b.max[1] });
    }
    motion[clip.getName()] = { seconds, samples };
  }
  restorePose(pose);
  const clips = sourceRoot.listAnimations().map(c => [c.getName(), duration(c)]);
  const joints = sourceRoot.listSkins().map(s => s.listJoints().map(j => j.getName()));
  if (JSON.stringify(clips) !== JSON.stringify(sourceClips) || JSON.stringify(joints) !== JSON.stringify(sourceJoints)) throw new Error(`${spec.id}: native rig/clips changed`);
  if (bounds.min[1] < -.1) throw new Error(`${spec.id}: rest floor below -0.1 m`);
  const bytes = await io.writeBinary(sourceDoc);
  const filename = `models/${spec.id}.glb`;
  await writeFile(`${out}/${filename}`, bytes);
  const original = manifest.assets.find(a => a.id === spec.id);
  if (!original) throw new Error(`Missing manifest asset ${spec.id}`);
  const originalPack = manifest.packs.find(p => p.id === original.pack);
  if (!originalPack) throw new Error(`Missing original pack for ${spec.id}`);
  const generated = await readFile(spec.texture);
  const generatedFile = spec.id === 'creature_cairn_bighorn'
    ? 'textures/creature_cairn_bighorn-imagegen-fine.png'
    : `textures/${spec.id}-imagegen.png`;
  if (spec.texture !== `${out}/${generatedFile}`) await copyFile(spec.texture, `${out}/${generatedFile}`);
  let runtimeFile, runtimeSha256;
  if (spec.runtimeTexture) {
    runtimeFile = `textures/${spec.id}-runtime.jpg`;
    const runtime = await readFile(spec.runtimeTexture);
    runtimeSha256 = sha(runtime);
    if (spec.runtimeTexture !== `${out}/${runtimeFile}`) await copyFile(spec.runtimeTexture, `${out}/${runtimeFile}`);
  } else {
    const embedded = sourceRoot.listMaterials()[0]?.getBaseColorTexture()?.getImage();
    if (!embedded) throw new Error(`${spec.id}: missing embedded runtime map`);
    runtimeFile = spec.id === 'creature_cairn_bighorn'
      ? 'textures/creature_cairn_bighorn-fine-runtime.jpg'
      : `textures/${spec.id}-runtime.jpg`;
    runtimeSha256 = sha(embedded);
    await writeFile(`${out}/${runtimeFile}`, embedded);
  }
  const size = { x: bounds.max[0]-bounds.min[0], y: bounds.max[1]-bounds.min[1], z: bounds.max[2]-bounds.min[2] };
  const entry = {
    ...original, pack: 'corealm-audit-polish-harts-ram', bytes: bytes.length, sha256: sha(bytes),
    size, base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, groundY: bounds.min[1],
    animations: clips.map(c => c[0]), materials: sourceRoot.listMaterials().map(m => m.getName()),
    walkClipSeconds: motion.Walk.seconds, runClipSeconds: motion.Run.seconds,
    attackSeconds: motion.Attack.seconds, attackContactNormalized: spec.contactNormalized,
    candidateFile: filename,
    sourceProvenance: {
      productionFile: `game/public/assets/${original.file}`, productionSha256: original.sha256,
      stagedFile: spec.source, stagedSha256: sha(sourceBytes),
      upstreamPack: originalPack.id, upstreamAuthor: originalPack.author, upstreamSource: originalPack.source,
      upstreamLicense: originalPack.license, upstreamArchiveSha256: originalPack.archiveSha256,
      generatedMap: generatedFile, generatedMapSha256: sha(generated),
      ...(runtimeFile ? { runtimeMap: runtimeFile, runtimeMapSha256: runtimeSha256 } : {}),
      builder: `${out}/build-candidates.mjs`, builderSha256, change: spec.change,
    },
    acceptance: { exported: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  };
  assets.push(entry);
  files[spec.id] = filename;
  promotions.push({ id: spec.id, candidateFile: `${out}/${filename}`, sha256: entry.sha256, bytes: entry.bytes,
    bounds, size, materials: entry.materials, animations: entry.animations,
    attack: { seconds: motion.Attack.seconds, contactNormalized: spec.contactNormalized },
    tierRecommendation: spec.tier, sourceProvenance: entry.sourceProvenance,
    motionCpu: motion, status: 'awaiting-root-lab-review', accepted: false });
}
const pack = { id: 'corealm-audit-polish-harts-ram', name: 'Corealm hart and ram audit polish', author: 'Corealm',
  source: `${out}/build-candidates.mjs`, license: 'Mixed original provenance; see each asset sourceProvenance', generatorSha256: builderSha256 };
await writeFile(`${out}/lab-catalog.json`, JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', pack, assets, files }, null, 2) + '\n');
await writeFile(`${out}/promotion.json`, JSON.stringify({ schema: 'corealm-creature-polish-promotion/1', pack: 'corealm-audit-polish-harts-ram', builderSha256,
  status: 'awaiting-root-lab-review', accepted: false, assets: promotions }, null, 2) + '\n');
console.log(JSON.stringify(promotions.map(({id,candidateFile,sha256,bytes,size,attack}) => ({id,candidateFile,sha256,bytes,size,attack})), null, 2));
